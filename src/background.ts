import * as browser from "webextension-polyfill";
import { MessageTypes, type Entry, type PageData, Datacenter } from "./types";

import { parseCDNHeaders } from "./cdn_utils";
import { IPtoInt, isIpReserved, isIPv4 } from "./popup/ip_utils";

import psl from 'psl';

// Time for each request
const requestTimings: { [key: string]: number } = {};

const tabData: { [key: number]: PageData } = {};

const userData: { country_code?: string } = {};

let submitOnView: boolean = false;

export function getHostname(url: string) {
    try {
        // Need protocol for URL object to work
        if (!url.startsWith('http'))
            url = `http://${url}`;
        const urlObject = new URL(url);
        let hostname = urlObject.hostname;

        if (!isIPv4(hostname)) {
            const domain = psl.get(hostname);
            if (domain)
                hostname = domain;
        }
        return hostname;

    } catch {
        // Manual cleanup
        // remove whitespace
        url = url.trim();
        // remove protocol
        url = url.replace(/^https?:\/\//, '');
        // remove www.
        url = url.replace(/^www./, '');
        // remove path
        url = url.split('/')[0];
        return url;
    }
}


function handleMessage(msg: any, _sender: browser.Runtime.MessageSender, sendResponse: (res: any) => void): true {
    if (msg.type == MessageTypes.GET_TAB_DATA) {
        const { tabId } = msg;

        if (tabId == undefined || tabId < 0) {
            return true;
        }

        if (tabData[tabId] == undefined)
            initPageData(tabId);

        if (!tabData[tabId].pageUrl) {
            console.log('pageUrl not set, getting it');
            browser.tabs.get(tabId).then(tab => {
                if (!tabData[tabId]) return;

                if (tab.url)
                    tabData[tabId].pageUrl = getHostname(tab.url);

                console.log(`pageUrl: ${tabData[tabId].pageUrl}`);

                sendResponse(tabData[tabId]);
            }).catch(err => {
                console.error(err);
                sendResponse(null);
            });
        } else
            sendResponse(tabData[tabId]);

        return true;
    } else if (msg.type == MessageTypes.FETCH_ENTRY_DATA) {
        const { tabId, ip } = msg;

        if (tabId == undefined || !ip) {
            sendResponse({ ok: false });
            return true;
        }

        getEntryData(tabId, ip);
        sendResponse({ ok: true });
        return true;
    } else if (msg.type == MessageTypes.GET_SETTINGS) {
        sendResponse({ submitOnView });
    } else if (msg.type == MessageTypes.SET_SETTINGS) {
        submitOnView = msg['submitOnView'];
        browser.storage.local.set({ submitOnView });
        sendResponse({ ok: true });
    }

    return true;
}

function getEntryData(tabId: number, ip: string) {
    if (!process.env.API_ENDPOINT || !tabData[tabId]?.entries[ip])
        return;

    if (!isIPv4(ip) || isIpReserved(IPtoInt(ip)))
        return;

    const { clue } = tabData[tabId].entries[ip];

    let ip_url = `${process.env.API_ENDPOINT}/api/ip/${ip}`;
    if (clue && (clue.countryCode || clue.city)) {
        const clueParams = new URLSearchParams();

        if (clue?.countryCode)
            clueParams.append('country_code', clue.countryCode);

        if (clue?.city)
            clueParams.append('city', clue.city);

        ip_url += `?${clueParams.toString()}`;
    }
    else if (userData.country_code)
        ip_url += `?country_code=${userData.country_code}`;

    fetch(ip_url)
        .then(res => res.json())
        .then(data => {
            const { facilities, user, reserved, network } = data;
            if (reserved || !facilities || !network)
                return;

            // Re-check if tabData is still valid since
            if (!tabData[tabId]) return;

            if (!userData.country_code && user?.country_code)
                userData.country_code = user.country_code;

            for (const fac of facilities as Datacenter[]) {
                const fac_id = fac.id;
                if (!tabData[tabId].facilities[fac_id])
                    tabData[tabId].facilities[fac_id] = fac;

                if (!tabData[tabId].networksDatacenters[network.id])
                    tabData[tabId].networksDatacenters[network.id] = new Set();

                tabData[tabId].networksDatacenters[network.id].add(fac_id);
            }
            tabData[tabId].entries[ip].network_id = network.id;
            tabData[tabId].entries[ip].fetched = true;
            tabData[tabId].networks[network.id] = network;

            browser.runtime.sendMessage(
                {
                    type: MessageTypes.UPDATE_FACILITIES,
                    tabId,
                    data: {
                        facilities: tabData[tabId].facilities,
                        networks: tabData[tabId].networks,
                        networksDatacenters: tabData[tabId].networksDatacenters
                    }

                }
            ).catch(() => { });

            browser.runtime.sendMessage(
                {
                    type: MessageTypes.UPDATE_ENTRY,
                    tabId,
                    data: tabData[tabId].entries[ip]
                }
            ).catch(() => { });
        })
        .catch(err => {
            console.log(`Error fetching ip_url:`);
            console.log(err)
        });
}

function initPageData(tabId: number) {
    tabData[tabId] = { pageUrl: "", cachedCount: 0, requestsCount: 0, entries: {}, facilities: {}, networks: {}, networksDatacenters: {} };
}

browser.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url)
        return;

    const newUrl = getHostname(change.url);
    if (tabData[tabId] && tabData[tabId].pageUrl != newUrl) {
        // Reset
        initPageData(tabId);
        tabData[tabId].pageUrl = newUrl;
        browser.runtime.sendMessage({ type: MessageTypes.PAGE_UPDATE, tabId, data: tabData[tabId] }).catch(() => { });
    }
});

browser.runtime.onMessage.addListener(handleMessage);

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        requestTimings[details.requestId] = details.timeStamp;
    },
    { urls: ["<all_urls>"] }
);

browser.webRequest.onResponseStarted.addListener(
    async (details) => {
        const { requestId, fromCache, tabId, ip, url, type, timeStamp, responseHeaders } = details;

        if (tabId < 0)
            return;

        if (!ip) {
            delete requestTimings[requestId];
            return;
        }

        if (!tabData[tabId])
            initPageData(tabId);

        let durationMs;
        if (!fromCache) {
            const startTime = requestTimings[requestId];
            durationMs = startTime ? Math.round(timeStamp - startTime) : undefined;
        } else
            tabData[tabId].cachedCount += 1;


        let clue = parseCDNHeaders(responseHeaders);

        if (type === "main_frame") {
            // Top level page
            tabData[tabId].pageUrl = getHostname(url);
            tabData[tabId].entries = {};
        }

        if (!tabData[tabId].entries[ip]) {
            // Add new entry
            const hostname = getHostname(url);

            const entry: Entry = {
                ip,
                hostname,
                count: 1,
                durationMs,
                clue,
                fetched: false
            };

            tabData[tabId].entries[ip] = entry;
            tabData[tabId].requestsCount += 1;

            browser.runtime.sendMessage({ type: MessageTypes.NEW_ENTRY, tabId, data: entry }).catch(() => { });
        } else {
            // Update entry
            tabData[tabId].entries[ip].count += 1;
            tabData[tabId].requestsCount += 1;

            if (durationMs) {
                const current_duration = tabData[tabId].entries[ip].durationMs;

                if (current_duration)
                    tabData[tabId].entries[ip].durationMs = Math.min(current_duration, durationMs);
                else
                    tabData[tabId].entries[ip].durationMs = durationMs;
            }

            if (clue)
                tabData[tabId].entries[ip].clue = clue;

            browser.runtime.sendMessage({ type: MessageTypes.UPDATE_ENTRY, tabId, data: tabData[tabId].entries[ip] }).catch(() => { });
        }

        browser.runtime.sendMessage(
            {
                type: MessageTypes.COUNTS,
                tabId,
                data: { cachedCount: tabData[tabId].cachedCount, requestsCount: tabData[tabId].requestsCount }
            }
        ).catch(() => { });


        delete requestTimings[requestId];

    },
    { urls: ["<all_urls>"] },
    ['responseHeaders']
);

browser.tabs.onRemoved.addListener((tabId) => {
    delete tabData[tabId];
});

browser.tabs.onActivated.addListener((activeTab) => {
    const { tabId } = activeTab;

    if (tabData[tabId] == undefined)
        initPageData(tabId);

    browser.runtime.sendMessage({ type: MessageTypes.PAGE_UPDATE, tabId, data: tabData[tabId] }).catch(() => { });
});

// browser.webNavigation?.onBeforeNavigate?.addListener((details) => {
//     if (details.frameId == 0) {
//         const { tabId, url } = details;
//         initPageData(tabId);
//         tabData[tabId].pageUrl = url;
//     }
// });

browser.storage.local.get('submitOnView')
    .then(val => {
        if (val['submitOnView'] === undefined || val['submitOnView'] == null)
            browser.storage.local.set({ 'submitOnView': false });
        else
            submitOnView = val['submitOnView'] as boolean;
    });
