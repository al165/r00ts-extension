import * as browser from "webextension-polyfill";
import { Datacenter, Entry, MessageTypes, PageData } from "../types";

let currentTabId: number;
let currentEntries: { [key: string]: Entry } = {};

browser.runtime.onMessage.addListener(async (message: any, _sender: browser.Runtime.MessageSender) => {
    if (message.tabId != currentTabId)
        return;

    if (message.type == MessageTypes.NEW_ENTRY) {
        const entry: Entry = message.data;
        currentEntries[entry.ip] = entry;
        addEntry(entry);
    } else if (message.type == MessageTypes.UPDATE_ENTRY) {
        const entry: Entry = message.data;
        currentEntries[entry.ip] = entry;
        updateEntry(entry);
    } else if (message.type == MessageTypes.COUNTS) {
        const { cachedCount, requestsCount } = message.data;
        updateCounts(cachedCount, requestsCount);
    } else if (message.type == MessageTypes.UPDATE_FACILITIES) {
        updateFacilities(message.data);
    }
});

async function load() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabId = tab.id ? tab.id : 0;

    browser.runtime.sendMessage({ type: MessageTypes.GET_TAB_DATA, tabId: tab.id }).then((response: any) => {
        if (!response)
            return;

        const pageData: PageData = response;

        const { cachedCount, requestsCount } = pageData;
        currentEntries = pageData.entries;

        for (const ip of Object.keys(currentEntries))
            addEntry(currentEntries[ip]);

        updateCounts(cachedCount, requestsCount);
        updateUrl(pageData.pageUrl);
        updateFacilities(pageData.facilities);
    });
}

function isIPv6(ip: string) {
    return ip.includes(':');
}

// ----------------- UI Update functions -----------------
let entryElements: { [key: string]: HTMLDivElement } = {};

function updateUrl(url: string) {
    const pageUrl = document.getElementById("page-url");
    if (pageUrl)
        pageUrl.innerHTML = url;
}

function addEntry(entry: Entry) {
    const entriesList = document.getElementById('entries-list');
    const emptyState = document.getElementById('empty-state');

    if (!entriesList)
        return;

    if (emptyState)
        emptyState.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'entry';
    row.title = entry.url;

    const ipv6 = isIPv6(entry.ip);
    const ip_el = document.createElement('span');
    ip_el.classList.add("entry-ip");
    if (ipv6)
        ip_el.classList.add("ipv6");
    ip_el.innerText = entry.ip;

    const host_el = document.createElement('span');
    host_el.classList.add('entry-host');
    host_el.innerText = entry.hostname;

    const network = entry.network;
    const network_name = network ? network : '??';

    const network_btn = document.createElement('button');
    network_btn.classList.add("entry-type");
    network_btn.innerText = network_name;

    const count_el = document.createElement('span');
    count_el.classList.add('entry-count');
    count_el.innerText = entry.count.toString();

    const time_el = document.createElement('span');
    time_el.classList.add('entry-time');
    time_el.innerText = entry.durationMs ? `${Math.round(entry.durationMs)}ms` : "-";

    row.appendChild(ip_el);
    row.appendChild(host_el);
    row.appendChild(network_btn);
    row.appendChild(count_el);
    row.appendChild(time_el);

    entriesList.appendChild(row);

    entryElements[entry.ip] = row;
}

function updateEntry(entry: Entry) {
    const row = entryElements[entry.ip];
    if (!row) {
        addEntry(entry);
        return;
    }

    const count_el = row.querySelector(".entry-count");
    if (count_el)
        count_el.innerHTML = entry.count.toString();

    const time_el = row.querySelector(".entry-time");
    if (time_el)
        time_el.innerHTML = entry.durationMs ? `${Math.round(entry.durationMs)}ms` : "-";

}

function updateCounts(cachedCount: number, requestsCount: number) {
    const requestsCounter = document.getElementById("req-count");
    const cachedCounter = document.getElementById("cached-count");
    const ipCounter = document.getElementById("ip-count");

    if (requestsCounter)
        requestsCounter.innerHTML = requestsCount.toString();

    if (cachedCounter)
        cachedCounter.innerHTML = cachedCount.toString();

    if (ipCounter)
        ipCounter.innerHTML = Object.keys(entryElements).length.toString();
}

function updateFacilities(datacenters: { [key: number]: Datacenter }) {
    const facilityCounter = document.getElementById("facility-count");
    if (facilityCounter)
        facilityCounter.innerHTML = Array.from(Object.keys(datacenters)).length.toString();
}

load();
