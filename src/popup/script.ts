window.addEventListener('error', (e) => console.log('uncaught error', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.log('unhandled rejection', e.reason));

import * as browser from "webextension-polyfill";
import { Datacenter, Entry, MessageTypes, PageData } from "../types";

import { LngLatBounds, Map, Marker, setWorkerUrl } from 'maplibre-gl';

import { MapRaseriser } from "./glyphRenderer";
import mapBuildingsStyle from "./osm_buildings.json";
import mapStyle from "./osm_surface.json";

let currentTabId: number;
let currentEntries: { [key: string]: Entry } = {};

let map: maplibregl.Map;
let mapBuildingsLayer: maplibregl.Map;

let mapCanvas: HTMLCanvasElement;
let glyphOverlayCanvas: HTMLCanvasElement | null;

let offscreenCanvas: OffscreenCanvas;
let glyphPaletteCanvas: OffscreenCanvas;
let rasteriser: MapRaseriser;

let markers: { [key: number]: DatacenterMarker } = {};
let currentMarker: DatacenterMarker | null = null;
let openingMarker = false;

let facility_ids: number[] = [];
let network_ids: number[] = [];
let network_datacenters: { [key: number]: number[] };
const glyphSize = 6;

let pageUrl: string;

let bounds: LngLatBounds;

class DatacenterMarker {
    focused = false;
    marker: Marker;

    facility: Datacenter;
    markerRoot: HTMLDivElement;
    title: HTMLSpanElement;
    markerImg: HTMLDivElement;

    constructor(facility: Datacenter, open_on_load = false) {
        this.facility = facility;

        const element = document.createElement('div');
        element.classList.add('datacenter-marker');

        this.markerRoot = document.createElement('div');
        this.markerRoot.className = "marker-root";

        this.title = document.createElement('span');
        this.title.className = "datacenter-title";
        this.title.innerText = facility.name;

        element.appendChild(this.markerRoot);

        this.markerImg = document.createElement('div');
        this.markerRoot.appendChild(this.markerImg);

        if (!facility.filename && facility.precise && process.env.API_ENDPOINT) {
            fetch(`${process.env.API_ENDPOINT}/api/aerial/${facility.id}`)
                .then(res => res.json())
                .then(data => {
                    if (!data.filename)
                        return;

                    facility.filename = data.filename;

                    this.markerImg.className = "marker marker-small";
                    this.markerImg.innerHTML = `
                        <img 
                            class="aerial" 
                            src="${process.env.API_ENDPOINT}/images/aerial/${facility.filename}"
                            alt="Aerial view of ${facility.name}">
                        </img>
                    `;

                    if (open_on_load)
                        this.open();

                }).catch(err => {
                    console.error(err);
                })
        }

        this.marker = new Marker({ element })
            .setLngLat([facility.lon, facility.lat])
            .addTo(map);

        this.marker.on('click', () => {
            if (this.focused) {
                this.close();
            } else {
                this.open();
            }
        });
    }

    open() {
        if (currentMarker != null)
            currentMarker.close();

        openingMarker = true;

        this.markerRoot.appendChild(this.title);
        this.markerRoot.classList.add('front');
        this.markerImg.classList.remove("marker-small");

        map.flyTo({
            zoom: 16,
            center: [
                this.facility.lon,
                this.facility.lat,
            ],
            padding: { left: 350 },
            duration: 1000,
        })

        currentMarker = this;
    }

    close() {
        currentMarker = null;
        this.markerRoot.removeChild(this.title);
        this.markerRoot.classList.remove('front');
        this.markerImg.classList.add("marker-small");
    }
};

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
        network_ids = Object.keys(message.data.networks).map(k => parseInt(k));
        updateFacilities(message.data.facilities);
        network_datacenters = {};
        for (const net_id of Object.keys(message.data.networkDatacenters)) {
            network_datacenters[parseInt(net_id)] = Array.from(message.data.networkDatacenters[parseInt(net_id)]);
        }
    }
    else if (message.type == MessageTypes.PAGE_UPDATE) {
        // new host name etc
        updateSummary(message.data as PageData);
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
        style: mapBuildingsStyle as maplibregl.StyleSpecification,
        interactive: true,
        attributionControl: false
    });

    map = new Map({
        container: 'map',
        style: mapStyle as maplibregl.StyleSpecification,
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
        //fitAll(false);

        new ResizeObserver(() =>
            rasteriser.resize(mapCanvas.width, mapCanvas.height),
        ).observe(mapCanvas);
    });

    map.on('render', () => {
        rasteriser.renderGlyphs();
    });

    map.on('click', () => {
        if (!openingMarker)
            currentMarker?.close();

        openingMarker = false;
    });

    map.on('zoomend', () => {
        if (map.getZoom() < 15)
            currentMarker?.close();
    });

    rasteriser.resize(mapCanvas.width, mapCanvas.height);

    syncMaps(map, mapBuildingsLayer);

    browser.runtime.sendMessage({ type: MessageTypes.GET_TAB_DATA, tabId: tab.id }).then((response: any) => {
        if (!response)
            return;

        const pageData: PageData = response;
        const { cachedCount, requestsCount, networks, networksDatacenters } = pageData;
        currentEntries = pageData.entries;
        pageUrl = pageData.pageUrl;

        for (const ip of Object.keys(currentEntries))
            addEntry(currentEntries[ip]);

        updateCounts(cachedCount, requestsCount);
        updateUrl(pageData.pageUrl);
        updateFacilities(pageData.facilities);
        updateSummary(pageData);

        network_ids = Object.keys(networks).map(k => parseInt(k));
        network_datacenters = {};
        for (const net_id of Object.keys(networksDatacenters)) {
            network_datacenters[parseInt(net_id)] = Array.from(networksDatacenters[parseInt(net_id)]);
        }
    });

    document.getElementById('details-btn')?.addEventListener('click', () => {
        const data = {
            facility_ids,
            network_ids,
            network_datacenters,
            entries: currentEntries,
            pageUrl,
        };
        console.log(JSON.stringify(data, null, 2));
        const data64 = btoa(JSON.stringify(data));
        browser.tabs.create({ url: `${process.env.API_ENDPOINT}?data=${data64}` });
    });

    document.getElementById('fit-btn')?.addEventListener('click', () => fitAll());


    const expandTableBtn = document.getElementById('expand-ip-table');
    if (expandTableBtn)
        expandTableBtn.addEventListener('click', () => {
            const tableContainer = document.getElementById('ip-table-container');


            if (tableContainer)
                if (tableContainer.classList.toggle('ip-table-closed'))
                    expandTableBtn.innerText = ">";
                else
                    expandTableBtn.innerText = "<";
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
    const entriesList = document.getElementById('ip-info');

    if (!entriesList)
        return;

    entriesList.style.display = 'block';

    if (Object.keys(entryElements).length == 0) {
        entriesList.querySelector('#hint-text')?.remove();
        const details_btn = entriesList.querySelector('#details-btn') as HTMLElement;
        if (details_btn)
            details_btn.style.display = 'block';
    }

    const table = entriesList.querySelector('#ip-body');
    if (!table)
        return;

    const row = document.createElement('tr');
    row.className = 'entry';

    const ipv6 = isIPv6(entry.ip);
    const ip_el = document.createElement('td');
    ip_el.classList.add("entry-ip");
    if (ipv6)
        ip_el.classList.add("ipv6");
    ip_el.innerText = entry.ip;

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
    // row.appendChild(network_btn);
    row.appendChild(count_el);
    row.appendChild(time_el);

    table.appendChild(row);

    entryElements[entry.ip] = row;

    if (!entry.fetched) {
        browser.runtime.sendMessage({ type: MessageTypes.FETCH_ENTRY_DATA, tabId: currentTabId, ip: entry.ip }).then(res => {
            console.log(res);
        });
    }
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
    const numFacilities = Array.from(Object.keys(datacenters)).length.toString();
    if (facilityCounter)
        facilityCounter.innerHTML = numFacilities;

    if (!map)
        return;

    if (numFacilities) {
        const detailsBtn = document.getElementById('details-btn') as HTMLButtonElement;
        if (detailsBtn)
            detailsBtn.disabled = false;
    }

    const cities = new Set<string>();
    for (const fac_id of Object.keys(datacenters)) {
        const id = parseInt(fac_id);
        cities.add(datacenters[id].city);
        if (!markers[id]) {
            const facility = datacenters[id];

            const marker = new DatacenterMarker(facility, Object.keys(markers).length == 0);
            markers[id] = marker;

            facility_ids.push(id);
        }
    }

    const cityNames = Array.from(cities);
    const cityInfo = document.getElementById('cities');
    if (cityInfo) {
        if (cityNames.length == 0)
            cityInfo.innerHTML = `unknown location`;
        else if (cityNames.length == 1)
            cityInfo.innerHTML = cityNames[0];
        else {
            if (Object.keys(currentEntries).length == 1)
                cityInfo.innerHTML = `one of ${cityNames.length} cities`;
            else
                cityInfo.innerHTML = `up to ${cityNames.length} cities`;
        }
    }
}

function updateSummary(data: PageData) {
    const hostname = document.getElementById('hostname');
    if (hostname)
        hostname.innerText = data.pageUrl;

    const cta = document.getElementById('cta');
    if (cta)
        cta.style.display = 'block';
}

function fitAll(animate: boolean = true) {
    currentMarker?.close();

    bounds = Object.values(markers).reduce((bounds, marker) => {
        return bounds.extend(marker.marker.getLngLat());
    }, new LngLatBounds());

    if (bounds._ne) {
        map.setPadding({ bottom: 80, top: 80, left: 80, right: 80 });
        map.fitBounds(bounds, { padding: { left: 200 }, animate, maxZoom: 14 });
    }
}

window.addEventListener('load', async () => {
    console.log('load');
    await load();
});

window.addEventListener('unload', () => {
    console.log('unload');
    map?.remove(); // releases the WebGL context
    mapBuildingsLayer?.remove();

    browser.runtime.onMessage.removeListener(handleMessage);
});
