import * as browser from "webextension-polyfill";
import type { Entry, PageData } from "./types";

// Time for each request
const requestTimings: { [key: string]: number } = {};

const tabData: { [key: number]: PageData } = {};

function handleMessage(msg: any, _sender: browser.Runtime.MessageSender, sendResponse: (res: any) => void): true {
    console.log("handleMessage", msg.type);
    if (msg.type === "get_tab_data") {
        const { tabId } = msg;
        if (tabId)
            sendResponse(tabData[tabId]);
        return true;
    }

    return true;
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
            tabData[tabId] = { pageUrl: "", cachedCount: 0, requestsCount: 0, entries: {} };

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
                network: null
            };
            tabData[tabId].entries[ip] = entry;
            tabData[tabId].requestsCount += 1;

            browser.runtime.sendMessage({ type: 'new_entry', tabId, data: entry }).catch(() => { });

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

            browser.runtime.sendMessage({ type: 'update_entry', tabId, data: tabData[tabId].entries[ip] }).catch(() => { });
        }

        browser.runtime.sendMessage(
            {
                type: 'counts',
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
        tabData[details.tabId] = { pageUrl: details.url, cachedCount: 0, requestsCount: 0, entries: {} };
    }
});
