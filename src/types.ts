export type Datacenter = {
  id: number,
  name: string,
  lat: number,
  lon: number
};

export type Entry = {
  ip: string,
  url: string,
  count: number,
  type: string,
  statusCode: number,
  timestamp: string,
  hostname: string,
  durationMs: number | null,
  network: string | null,
};

export type PageData = {
  pageUrl: string,
  cachedCount: number,
  requestsCount: number,
  facilities: { [key: number]: Datacenter },
  entries: { [key: string]: Entry }
};

export enum MessageTypes {
  GET_TAB_DATA,
  NEW_ENTRY,
  UPDATE_ENTRY,
  COUNTS,
  UPDATE_FACILITIES
};
