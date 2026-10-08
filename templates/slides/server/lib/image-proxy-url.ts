import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

export const MAX_PROXIED_IMAGE_BYTES = 15 * 1024 * 1024;

export const MAX_PROXY_REDIRECTS = 3;

export function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);

  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    const hextets = expandIpv6(address);
    if (!hextets) return true;

    const embedsIpv4 =
      hextets.slice(0, 5).every((part) => part === 0) &&
      (hextets[5] === 0xffff || hextets[5] === 0);
    if (embedsIpv4 && (hextets[6] !== 0 || hextets[7] !== 0)) {
      const ipv4 = [
        hextets[6] >> 8,
        hextets[6] & 0xff,
        hextets[7] >> 8,
        hextets[7] & 0xff,
      ].join(".");
      return isPrivateAddress(ipv4);
    }

    if (hextets.every((part) => part === 0)) return true;
    if (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) {
      return true;
    }
    if ((hextets[0] & 0xfe00) === 0xfc00) return true;
    if ((hextets[0] & 0xffc0) === 0xfe80) return true;
    if ((hextets[0] & 0xff00) === 0xff00) return true;
    if (hextets[0] === 0x0064 && hextets[1] === 0xff9b) {
      const ipv4 = [
        hextets[6] >> 8,
        hextets[6] & 0xff,
        hextets[7] >> 8,
        hextets[7] & 0xff,
      ].join(".");
      return isPrivateAddress(ipv4);
    }
    return false;
  }

  return true;
}

export function expandIpv6(address: string): number[] | null {
  const bare = address.toLowerCase().split("%")[0];
  if (!bare) return null;

  let head = bare;
  let tail = "";
  const elision = bare.indexOf("::");
  if (elision !== -1) {
    head = bare.slice(0, elision);
    tail = bare.slice(elision + 2);
  }

  const parseGroups = (segment: string): string[] =>
    segment.length === 0 ? [] : segment.split(":");

  const headGroups = parseGroups(head);
  const tailGroups = parseGroups(tail);
  const all = [...headGroups, ...tailGroups];

  const last = all[all.length - 1];
  let ipv4Tail: number[] | null = null;
  if (last?.includes(".")) {
    if (net.isIP(last) !== 4) return null;
    const octets = last.split(".").map((part) => Number(part));
    if (
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return null;
    ipv4Tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    if (tailGroups.length > 0) tailGroups.pop();
    else headGroups.pop();
  }

  const toHextets = (groups: string[]): number[] | null => {
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const headParts = toHextets(headGroups);
  const tailParts = toHextets(tailGroups);
  if (!headParts || !tailParts) return null;

  const explicit = [...headParts, ...tailParts, ...(ipv4Tail ? ipv4Tail : [])]
    .length;
  if (explicit > 8) return null;

  if (elision === -1) {
    if (explicit !== 8) return null;
    return [...headParts, ...(ipv4Tail ?? [])];
  }

  const fill = new Array(8 - explicit).fill(0) as number[];
  return [...headParts, ...fill, ...tailParts, ...(ipv4Tail ?? [])];
}

export function parseProxyableImageUrl(raw: string): URL | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // coercion-ok: null is this function's documented "refused" result and
    // the caller answers 400; an unparseable URL carries no other detail.
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (BLOCKED_HOSTNAMES.has(host)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;

  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (net.isIP(literal) && isPrivateAddress(literal)) return null;

  return url;
}
