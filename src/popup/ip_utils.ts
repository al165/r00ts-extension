export function isIPv4(ip: string) {
    // Probably misses some edge cases!

    if (ip.includes(':'))
        return false;

    const octets = ip.split('.');
    if (octets.length != 4)
        return false;

    for (const octet of octets) {
        if (!/^\d{1,3}$/.test(octet)) return false;
        const octValue = parseInt(octet);

        if (isNaN(octValue))
            return false;

        if (octValue < 0 || octValue > 255)
            return false;
    }

    return true;
}

export function IPtoInt(ip: string) {
    if (!ip || !isIPv4(ip))
        return -1;

    const [octet1, octet2, octet3, octet4] = ip.split('.');
    return (((parseInt(octet1) << 24) >>> 0) | (parseInt(octet2) << 16) | (parseInt(octet3) << 8) | parseInt(octet4)) >>> 0;
}

export function intToIP(integer: number) {
    if (integer > 2 ** 32)
        return '';

    const octet1 = (integer >> 24) & 255;
    const octet2 = (integer >> 16) & 255;
    const octet3 = (integer >> 8) & 255;
    const octet4 = (integer >> 0) & 255;

    return `${octet1}.${octet2}.${octet3}.${octet4}`;
}

export function cidrToRange(cidr: string) {
    const [ip, prefixLen] = cidr.split('/');
    const prefix = parseInt(prefixLen, 10);

    if (IPtoInt(ip) < 0 || prefix < 0 || prefix > 32)
        return null

    // Convert IP to integer
    const ipInt = ip.split('.')
        .reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
    // >>> 0 converts to unsigned 32-bit, important for IPs starting with 128+

    // Build the network mask, e.g. prefix=24 -> 0xFFFFFF00
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

    const start = (ipInt & mask) >>> 0;
    const end = (start | ~mask) >>> 0;

    return { start, end };
}

export function ipInCIDR(ip_int: number, cidr: string) {
    const cidrResult = cidrToRange(cidr);
    if (!cidrResult)
        return false;

    const { start, end } = cidrResult;
    return (ip_int >= start && ip_int <= end);
}

const RESERVED_CIDR = [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
    "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4",
    "233.252.0.0/24", "240.0.0.0/4", "255.255.255.255/32"
];

const RESERVED_RANGES = RESERVED_CIDR.map(cidrToRange)

export function isIpReserved(ip_int: number) {
    // From: https://en.wikipedia.org/wiki/List_of_reserved_IP_addresses

    if (ip_int < 0)
        return true;

    for (const range of RESERVED_RANGES) {
        if (!range) continue

        if (ip_int >= range.start && ip_int <= range.end)
            return true;
    }

    return false;
}

export function sortIps(ips: string[]) {
    return ips.sort(ipCompareFn);
}

export function ipCompareFn(a: string, b: string) {
    return IPtoInt(a) < IPtoInt(b) ? -1 : 1;
}

export function padIp(ip: string) {
    const [octet1, octet2, octet3, octet4] = ip.split('.');
    return `${octet1.padStart(3, ' ')}.${octet2.padStart(3, ' ')}.${octet3.padStart(3, ' ')}.${octet4.padStart(3, ' ')}`;
}

