import { Marker } from "maplibre-gl";
import { Datacenter } from "../types";


export let currentMarker: { value: DatacenterMarker | null, opening: boolean } = { value: null, opening: false };

export class DatacenterMarker {
    map: maplibregl.Map;

    focused = false;
    marker: Marker;
    removed = false;

    facility: Datacenter;
    markerRoot: HTMLDivElement;
    title: HTMLSpanElement;
    markerImg: HTMLImageElement;

    constructor(map: maplibregl.Map, facility: Datacenter, open_on_load = false) {
        this.map = map;
        this.facility = facility;

        const element = document.createElement('div');
        element.classList.add('datacenter-marker');

        this.markerRoot = document.createElement('div');
        this.markerRoot.className = "marker-root";

        this.title = document.createElement('span');
        this.title.className = "datacenter-title";
        this.title.innerText = facility.name;

        element.appendChild(this.markerRoot);

        this.markerImg = document.createElement('img');
        this.markerRoot.appendChild(this.markerImg);

        if (!facility.filename && facility.precise && process.env.API_ENDPOINT) {
            fetch(`${process.env.API_ENDPOINT}/api/aerial/${facility.id}`)
                .then(res => res.json())
                .then(data => {
                    if (!data.filename || this.removed)
                        return;

                    facility.filename = data.filename;

                    this.markerImg.className = "marker marker-small aerial";
                    this.markerImg.src = `${process.env.API_ENDPOINT}/images/aerial/${facility.filename}`;
                    this.markerImg.setAttribute('alt', `Aerial view of ${facility.name}`);

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
            console.log('marker clicked');
            if (this.focused) {
                this.close();
            } else {
                this.open();
            }
        });
    }

    open() {
        this.markerRoot.appendChild(this.title);
        this.markerRoot.classList.add('front');
        this.markerImg.classList.remove("marker-small");

        this.map.flyTo({
            zoom: 16,
            center: [
                this.facility.lon,
                this.facility.lat,
            ],
            padding: { left: 350 },
            duration: 1000,
        })

        currentMarker.value = this;
        currentMarker.opening = true;

        this.focused = true;
    }

    close() {
        currentMarker.value = null;
        this.markerRoot.removeChild(this.title);
        this.markerRoot.classList.remove('front');
        this.markerImg.classList.add("marker-small");
        this.focused = false;
    }

    remove() {
        this.close();
        this.marker.remove();
        this.removed = true;
    }
};

