window.addEventListener('error', (e) => console.log('uncaught error', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.log('unhandled rejection', e.reason));

import * as browser from "webextension-polyfill";
import { Datacenter, Entry, MessageTypes, PageData } from "../types";

import { LngLatBounds, Map, setWorkerUrl } from 'maplibre-gl';

import { MapRaseriser } from "./glyphRenderer";
import { padIp } from "./ip_utils";
import { DatacenterMarker, currentMarker } from "./marker";

let currentTabId: number;
let currentEntries: { [key: string]: Entry } = {};
let numFacilities: number = 0;
let numIps: number = 0;
let cities: string[] = [];

let map: maplibregl.Map;
let mapBuildingsLayer: maplibregl.Map;

let mapCanvas: HTMLCanvasElement;
let glyphOverlayCanvas: HTMLCanvasElement | null;

let offscreenCanvas: OffscreenCanvas;
let glyphPaletteCanvas: OffscreenCanvas;
let rasteriser: MapRaseriser;

let markers: { [key: number]: DatacenterMarker } = {};

let facilityIds: number[] = [];
let networkIds: number[] = [];
let networksDatacenters: { [key: number]: number[] };
const glyphSize = 6;

let pageUrl: string;

let bounds: LngLatBounds;

let submitOnView: boolean = false;


function syncMaps(...maps: Map[]) {
    // Create all the movement functions, because if they're created every time
    // they wouldn't be the same and couldn't be removed.
    let fns: Parameters<Map["on"]>[1][] = [];
    maps.forEach((map, index) => {
        // When one map moves, we turn off the movement listeners
        // on all the maps, move it, then turn the listeners on again
        fns[index] = () => {
            if (!map.getContainer().isConnected)
                return

            off();

            const center = map.getCenter();
            const zoom = map.getZoom();
            const bearing = map.getBearing();
            const pitch = map.getPitch();
            const padding = map.getPadding();

            const clones = maps.filter((_o, i) => i !== index);
            clones.forEach((clone) => {
                clone.jumpTo({
                    center: center,
                    zoom: zoom,
                    bearing: bearing,
                    pitch: pitch,
                    padding: padding
                });
            });

            on();
        };
    });

    const on = () => {
        maps.forEach((map, index) => {
            map.on("move", fns[index]);
        });
    };

    const off = () => {
        maps.forEach((map, index) => {
            map.off("move", fns[index]);
        });
    };

    on();

    return () => {
        off();
        fns = [];
        maps = [];
    };
}

async function handleMessage(message: any, _sender: browser.Runtime.MessageSender) {
    if (message.type == MessageTypes.PAGE_UPDATE) {
        currentTabId = message.tabId;
        loadPageData(message.data);
        return;
    }

    if (message.tabId != currentTabId)
        return;

    if (message.type == MessageTypes.NEW_ENTRY) {
        const entry: Entry = message.data;
        currentEntries[entry.ip] = entry;
        addEntry(entry);
    }
    else if (message.type == MessageTypes.UPDATE_ENTRY) {
        const entry: Entry = message.data;
        currentEntries[entry.ip] = entry;
        updateEntry(entry);
    }
    else if (message.type == MessageTypes.COUNTS) {
        const { cachedCount, requestsCount } = message.data;
        updateCounts(cachedCount, requestsCount);
    }
    else if (message.type == MessageTypes.UPDATE_FACILITIES) {
        networkIds = Object.keys(message.data.networks).map(k => parseInt(k));
        updateFacilities(message.data.facilities);
        updateNetworksDatacenters(message.data.networksDatacenters);
    }
}

browser.runtime.onMessage.addListener(handleMessage);

async function load() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabId = tab.id ? tab.id : 0;

    setWorkerUrl(browser.runtime.getURL('maplibre-gl-csp-worker.js'));

    mapBuildingsLayer = new Map({
        container: 'map-buildings',
        style: `${process.env.API_ENDPOINT}/osm_buildings.json`,
        interactive: true,
        attributionControl: false
    });

    map = new Map({
        container: 'map',
        style: `${process.env.API_ENDPOINT}/osm_surface.json`,
        interactive: true,
        attributionControl: false
    });

    mapCanvas = map.getCanvas();
    mapCanvas.style.opacity = "0";

    offscreenCanvas = new OffscreenCanvas(1, 1);
    glyphPaletteCanvas = new OffscreenCanvas(1, 1);
    glyphOverlayCanvas = document.getElementById('glyph-render') as HTMLCanvasElement;

    // Setup Rasteriser
    rasteriser = new MapRaseriser(
        glyphOverlayCanvas,
        mapCanvas,
        offscreenCanvas,
        glyphPaletteCanvas,
        glyphSize,
    );

    map.on('load', () => {
        new ResizeObserver(() =>
            rasteriser.resize(mapCanvas.width, mapCanvas.height),
        ).observe(mapCanvas);
    });

    map.on('render', () => {
        rasteriser.renderGlyphs();
    });

    map.on('click', () => {
        if (!currentMarker.opening)
            currentMarker.value?.close();

        currentMarker.opening = false;
    });

    map.on('zoomend', () => {
        if (map.getZoom() < 15)
            currentMarker.value?.close();
    });

    rasteriser.resize(mapCanvas.width, mapCanvas.height);

    syncMaps(map, mapBuildingsLayer);

    browser.runtime.sendMessage({ type: MessageTypes.GET_TAB_DATA, tabId: tab.id })
        .then((response: any) => {
            if (!response)
                return;

            const pageData: PageData = response;
            loadPageData(pageData);
        })
        .catch(() => { });

    browser.runtime.sendMessage({ type: MessageTypes.GET_SETTINGS })
        .then((response: any) => {
            const { submitOnView } = response

            setSubmitOnView(submitOnView);
        })
        .catch(() => { });

    document.getElementById('details-btn')?.addEventListener('click', () => {
        const data = {
            facility_ids: facilityIds,
            network_ids: networkIds,
            network_datacenters: networksDatacenters,
            entries: currentEntries,
            pageUrl,
        };
        const data64 = btoa(encodeURIComponent(JSON.stringify(data)));
        browser.tabs.create({ url: `${process.env.API_ENDPOINT}?data=${data64}&submit=${submitOnView}` });

        window.close();
    });

    document.getElementById('fit-btn')?.addEventListener('click', () => fitAll());

    const attribution = document.getElementById("attribution");
    document.getElementById("attribution-btn")?.addEventListener('click', () => {
        if (attribution)
            attribution.classList.toggle('attribution-open');
    });

    document.getElementById("submitOnView")?.addEventListener('change', (ev) => {
        const target = ev.target as HTMLInputElement;

        submitOnView = target.checked;

        browser.runtime.sendMessage({ type: MessageTypes.SET_SETTINGS, submitOnView }).catch(() => { });
    });
}

// ----------------- UI Update functions -----------------
let entryElements: { [key: string]: HTMLDivElement } = {};

function updateUrl(url: string) {
    const pageUrl = document.getElementById("page-url");
    if (pageUrl)
        pageUrl.textContent = url;
}

function addEntry(entry: Entry) {
    const entriesList = document.getElementById('ip-info');

    if (!entriesList)
        return;

    entriesList.style.display = 'block';

    const numRows = Object.keys(entryElements).length;
    if (numRows == 0)
        document.getElementById('hint-text')?.remove();

    const table = entriesList.querySelector('#ip-body');
    if (!table)
        return;

    const row = document.createElement('tr');
    row.className = 'entry';
    if (numRows >= 6) {
        const opacity = Math.max(0, 1 - (numRows - 6) / 4);
        row.style.opacity = opacity.toFixed(2);
    }

    const ip_el = document.createElement('td');
    ip_el.classList.add('entry-ip');
    ip_el.innerText = padIp(entry.ip);

    const host_el = document.createElement('td');
    host_el.classList.add('entry-host');
    host_el.innerText = entry.hostname;

    const count_el = document.createElement('td');
    count_el.classList.add('entry-count');
    count_el.innerText = entry.count.toString();

    const time_el = document.createElement('td');
    time_el.classList.add('entry-time');
    time_el.innerText = entry.durationMs ? `${Math.round(entry.durationMs)}ms` : "-";

    const clue_el = document.createElement('td');
    if (entry.clue) {
        clue_el.innerText = `* ${entry.clue.city}`;
    }

    row.appendChild(ip_el);
    row.appendChild(host_el);
    row.appendChild(count_el);
    row.appendChild(time_el);

    table.appendChild(row);

    entryElements[entry.ip] = row;

    if (!entry.fetched) {
        browser.runtime.sendMessage({ type: MessageTypes.FETCH_ENTRY_DATA, tabId: currentTabId, ip: entry.ip }).catch(() => { });
    }

    showCTA();
}

function loadPageData(pageData: PageData) {
    const { cachedCount, requestsCount, networks } = pageData;
    currentEntries = pageData.entries;
    pageUrl = pageData.pageUrl;

    for (const entryIP of Object.keys(entryElements))
        entryElements[entryIP].remove();
    entryElements = {};

    for (const marker of Object.values(markers))
        try {
            marker.remove();
        } catch {
            continue;
        }
    markers = {};
    facilityIds = [];

    for (const ip of Object.keys(currentEntries))
        addEntry(currentEntries[ip]);

    updateCounts(cachedCount, requestsCount);
    updateUrl(pageData.pageUrl);
    updateFacilities(pageData.facilities);
    updateSummary(pageData);

    networkIds = Object.keys(networks).map(k => parseInt(k));
    updateNetworksDatacenters(pageData.networksDatacenters);
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

    showCTA();
}

function updateNetworksDatacenters(nd: { [key: number]: Set<number> }) {
    networksDatacenters = {};
    for (const net_id of Object.keys(nd))
        networksDatacenters[parseInt(net_id)] = Array.from(nd[parseInt(net_id)]);
    showCTA();
}

function updateCounts(cachedCount: number, requestsCount: number) {
    const requestsCounter = document.getElementById("req-count");
    const cachedCounter = document.getElementById("cached-count");

    if (requestsCounter)
        requestsCounter.innerHTML = requestsCount.toString();

    if (cachedCounter)
        cachedCounter.innerHTML = cachedCount.toString();

    numIps = Object.keys(currentEntries).length;
    showCTA()
}

function updateFacilities(datacenters: { [key: number]: Datacenter }) {
    if (!map)
        return;

    numFacilities = Object.keys(datacenters).length;
    numIps = Object.keys(currentEntries).length;

    if (numFacilities) {
        const detailsBtn = document.getElementById('details-btn') as HTMLButtonElement;
        if (detailsBtn)
            detailsBtn.disabled = false;
    }

    const citiesSet = new Set<string>();

    for (const fac_id of Object.keys(datacenters)) {
        const id = parseInt(fac_id);
        if (datacenters[id].city)
            citiesSet.add(datacenters[id].city);
        if (!markers[id]) {
            const facility = datacenters[id];

            const marker = new DatacenterMarker(map, facility, Object.keys(markers).length == 0);
            markers[id] = marker;

            facilityIds.push(id);
        }
    }

    cities = Array.from(citiesSet);

    showCTA()
}

function updateSummary(data: PageData) {
    const hostname = document.getElementById('hostname');
    if (hostname)
        hostname.innerText = data.pageUrl;


    showCTA();
}

function showCTA() {
    const cta = document.getElementById('cta');
    if (!cta)
        return;

    if (numIps == 0) {
        cta.style.display = 'none';
        return;
    }

    const summary = document.getElementById("summary");
    if (!summary) return;

    let ipSummary = ''
    let facilitySummary = '';
    let citySummary = '';

    if (numIps == 0) {
        // Shouldn't ever be here, but just in case...
        ipSummary = "No IP addresses captured for this website yet. Refresh the page to see the results!";
    } else {
        if (numIps == 1)
            ipSummary = "Rooted on <em>1 IP address</em>"
        else
            ipSummary = `Rooted on <em>${numIps} IP addresses</em>`;

        if (numFacilities == 0) {
            facilitySummary = "served by an unknown number of datacenters — larger platforms may operate their own networks that are not in public registeries!";
        } else {
            if (numFacilities == 1)
                facilitySummary = "served by <em>1 datacenter</em>"
            else if (numIps == 1)
                facilitySummary = `served by one of <em>${numFacilities} datacenters</em>`;
            else
                facilitySummary = `served by up to <em>${numFacilities} datacenters</em>`;
        }

        if (cities.length) {
            if (cities.length == 1)
                citySummary = `in <em>${cities[0]}</em>`;
            else if (cities.length < 5)
                citySummary = "in " + cities.slice(0, -1).join(', ') + " and " + cities.at(-1) + "</em>";
            else
                citySummary = "in " + cities.slice(0, 4).join(', ') + " and " + (cities.length - 4) + " more</em>";
        } else {
            if (numFacilities == 1) {
                citySummary = 'in an <em>unknown location</em>';
            } else if (numFacilities > 1) {
                citySummary = 'in <em>unknown locations</em>';
            }
        }
    }

    summary.innerHTML = [ipSummary, facilitySummary, citySummary].join(' ');
    cta.style.display = 'block';
}

function fitAll(animate: boolean = true) {
    currentMarker.value?.close();

    bounds = Object.values(markers).reduce((bounds, marker) => {
        return bounds.extend(marker.marker.getLngLat());
    }, new LngLatBounds());

    if (!bounds.isEmpty()) {
        map.setPadding({ bottom: 80, top: 80, left: 80, right: 80 });
        map.fitBounds(bounds, { padding: { left: 200 }, animate, maxZoom: 14 });
    }
}

function setSubmitOnView(value: boolean) {
    submitOnView = value;
    const checkbox = document.getElementById("submitOnView") as HTMLInputElement;

    if (!checkbox)
        return;

    checkbox.checked = value;
}

window.addEventListener('load', async () => {
    await load();
});

window.addEventListener('unload', () => {
    map?.remove(); // releases the WebGL context
    mapBuildingsLayer?.remove();

    browser.runtime.onMessage.removeListener(handleMessage);
});
