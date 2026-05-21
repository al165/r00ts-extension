export type Entry = {
  ip: string,
  url: string,
  count: number,
  type: string,
  statusCode: number,
  timestamp: string,
  hostname: string,
  durationMs: number | null,
  network: string | null
};

export type PageData = {
  pageUrl: string,
  cachedCount: number,
  requestsCount: number,
  entries: { [key: string]: Entry }
};
