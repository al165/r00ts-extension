import * as browser from "webextension-polyfill";
import { MessageTypes, type Entry, type PageData } from "./types";

// Time for each request
const requestTimings: { [key: string]: number } = {};

const tabData: { [key: number]: PageData } = {};

const userData: { country_code?: string } = {};

function handleMessage(msg: any, _sender: browser.Runtime.MessageSender, sendResponse: (res: any) => void): true {
    console.log("handleMessage", msg.type);
    if (msg.type == MessageTypes.GET_TAB_DATA) {
        const { tabId } = msg;
        if (tabId)
            sendResponse(tabData[tabId]);
        return true;
    }

    return true;
}

function handleStartup() {
    console.log('onStartup');
}

browser.runtime.onMessage.addListener(handleMessage);

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        requestTimings[details.requestId] = details.timeStamp;
    },
    { urls: ["<all_urls>"] }
);

browser.webRequest.onResponseStarted.addListener(
    async (details) => {
        const { requestId, fromCache, tabId, ip, url, type, statusCode, timeStamp } = details;

        if (tabId < 0)
            return;

        if (!ip) {
            delete requestTimings[requestId];
            return;
        }

        if (!tabData[tabId])
            tabData[tabId] = { pageUrl: "", cachedCount: 0, requestsCount: 0, entries: {}, facilities: {} };

        let durationMs = null;
        if (!fromCache) {
            const startTime = requestTimings[requestId];
            durationMs = startTime ? Math.round(timeStamp - startTime) : null;
            tabData[tabId].cachedCount += 1;
        }

        if (type == "main_frame") {
            // Top level page
            tabData[tabId].pageUrl = url;
            tabData[tabId].entries = {};
        }

        if (!tabData[tabId].entries[ip]) {
            // Add new entry
            let hostname: string;
            try {
                hostname = (new URL(url)).hostname;
            } catch {
                hostname = url;
            }

            const entry: Entry = {
                ip,
                url,
                hostname,
                count: 1,
                type,
                statusCode,
                timestamp: new Date(timeStamp).toISOString(),
                durationMs,
                network: null,
            };

            tabData[tabId].entries[ip] = entry;
            tabData[tabId].requestsCount += 1;

            browser.runtime.sendMessage({ type: MessageTypes.NEW_ENTRY, tabId, data: entry }).catch(() => { });

            if (process.env.API_ENDPOINT) {
                let ip_url = process.env.API_ENDPOINT + ip;
                if (userData.country_code)
                    ip_url += `?country_code=${userData.country_code}`;

                console.log(ip_url);
                fetch(ip_url)
                    .then(res => res.json())
                    .then(data => {
                        const { facilities, user, reserved } = data;
                        if (reserved)
                            return;

                        if (!userData.country_code)
                            userData.country_code = user.country_code;

                        for (const fac of facilities) {
                            const fac_id = fac.id;
                            if (!tabData[tabId].facilities[fac_id])
                                tabData[tabId].facilities[fac_id] = fac;
                        }
                        browser.runtime.sendMessage(
                            { type: MessageTypes.UPDATE_FACILITIES, tabId, data: tabData[tabId].facilities }
                        ).catch(() => { });
                    })
                    .catch(err => {
                        console.log(err)
                    });
            }

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
    { urls: ["<all_urls>"] }
);

browser.tabs.onRemoved.addListener((tabId) => {
    delete tabData[tabId];
});

browser.webNavigation?.onBeforeNavigate?.addListener((details) => {
    if (details.frameId === 0) {
        tabData[details.tabId] = { pageUrl: details.url, cachedCount: 0, requestsCount: 0, entries: {}, facilities: {} };
    }
});

handleStartup();
