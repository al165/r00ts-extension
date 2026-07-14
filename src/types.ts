export type Datacenter = {
    id: number,
    name: string,
    lat: number,
    lon: number,
    precise: boolean,
    city: string,
    filename?: string,
};

export type Network = {
    id: number,
    net_id: number,
    network_name: string,
    organisation_name: string,
    description: string,
    asn: number,
}

export type Entry = {
    ip: string,
    hostname: string,
    count: number,
    durationMs?: number,
    network_id?: number,
    clue?: Clue,
    fetched: boolean
};

export type PageData = {
    pageUrl: string,
    cachedCount: number,
    requestsCount: number,
    facilities: { [key: number]: Datacenter },
    networks: { [key: number]: Network },
    networksDatacenters: { [key: number]: Set<number> },
    entries: { [key: string]: Entry }
};

export enum ClueType {
    CLOUDFARE,
    AMAZON_CLOUDFRONT,
    VERCEL,
    AKAMAI
};

export type Clue = {
    type: ClueType,
    name: string,
    code?: string
    regionCode?: string
    countryCode?: string
    city?: string
}

export enum MessageTypes {
    GET_TAB_DATA,
    FETCH_ENTRY_DATA,
    NEW_ENTRY,
    UPDATE_ENTRY,
    COUNTS,
    UPDATE_FACILITIES,
    PAGE_UPDATE,
    GET_SETTINGS,
    SET_SETTINGS,
};
