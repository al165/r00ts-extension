import * as browser from "webextension-polyfill";
import { MessageTypes, type Entry, type PageData, Datacenter } from "./types";

import { parseCDNHeaders } from "./cdn_utils";
import { IPtoInt, isIpReserved, isIPv4 } from "./popup/ip_utils";

// Time for each request
const requestTimings: { [key: string]: number } = {};

const tabData: { [key: number]: PageData } = {};

const userData: { country_code?: string } = {};

export function getHostname(url: string) {
    try {
        // Need protocol for URL object to work
        if (!url.startsWith('http'))
            url = `http://${url}`;
        const urlObject = new URL(url);
        let hostname = urlObject.hostname;
        hostname = hostname.replace(/^www./, '');
        return hostname;
    } catch {
        // Manual cleanup
        url = url.trim();
        url = url.replace(/^https?:\/\//, '');
        url = url.replace(/^www./, '');
        url = url.split('/')[0];
        return url;
    }
}


function handleMessage(msg: any, _sender: browser.Runtime.MessageSender, sendResponse: (res: any) => void): true {
    // console.log("handleMessage", MessageTypes[msg.type]);
    if (msg.type == MessageTypes.GET_TAB_DATA) {
        const { tabId } = msg;

        if (tabId == undefined) {
            return true;
        }

        if (tabData[tabId] == undefined)
            initPageData(tabId);

        if (!tabData[tabId].pageUrl) {
            console.log('pageUrl not set, getting it');
            browser.tabs.get(tabId).then(tab => {
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
    console.log('initPageData');
    tabData[tabId] = { pageUrl: "", cachedCount: 0, requestsCount: 0, entries: {}, facilities: {}, networks: {}, networksDatacenters: {} };
}

browser.tabs.onUpdated.addListener((tabId, change) => {
    console.log('browser.tabs.onUpdated');
    if (change.url) {
        const newUrl = getHostname(change.url);
        if (tabData[tabId] && tabData[tabId].pageUrl != newUrl) {
            // Reset
            initPageData(tabId);
            tabData[tabId].pageUrl = newUrl;
            browser.runtime.sendMessage({ type: MessageTypes.PAGE_UPDATE, tabId, data: tabData[tabId] }).catch(() => { });
        }
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
            tabData[tabId].cachedCount += 1;
        }

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

    },
    { urls: ["<all_urls>"] },
    ['responseHeaders']
);

browser.tabs.onRemoved.addListener((tabId) => {
    delete tabData[tabId];
});

browser.tabs.onActivated.addListener((activeTab) => {
    console.log('browser.tabs.onActivated');
    const { tabId } = activeTab;

    if (tabData[tabId] == undefined)
        initPageData(tabId);

    browser.runtime.sendMessage({ type: MessageTypes.PAGE_UPDATE, tabId, data: tabData[tabId] }).catch(() => { });
});

browser.webNavigation?.onBeforeNavigate?.addListener((details) => {
    console.log('browser.webNavigation.onBeforeNavigate');
    if (details.frameId == 0) {
        const { tabId, url } = details;
        initPageData(tabId);
        tabData[tabId].pageUrl = url;
    }
});
