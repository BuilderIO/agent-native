/**
 * A signed-out reader of a public page, as far as their Clip reads go: an
 * opaque key for their network, so each network has its own budget here and
 * at Clips, and Clips never learns the address behind it.
 */
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

// Never configured and never leaves this process, so not even Clips, which
// holds the peer secret, can hash addresses to find whose key it was. A
// reader whose reads reach two Content processes gets two keys and a budget
// under each, as with every in-memory limit here.
const VISITOR_KEY_SECRET = randomBytes(32);

const READ_WINDOW_MS = 60_000;
/** Across every Clip and page: a page of Clips loads a few reads each. */
export const PUBLIC_CLIP_READS_PER_MINUTE = 600;
const MAX_VISITORS = 10_000;

type ReadBucket = { count: number; reset: number };
const visitorReads = new Map<string, ReadBucket>();

export type PublicClipVisitor =
  | { key: string }
  /**
   * Content's edge sent no address it can read. Netlify always sets one, so
   * this is a local server or another host; the reader shares their Clip's
   * budget at Clips with every other reader without a key.
   */
  | { key: null; reason: "no_edge_address" | "unreadable_edge_address" };

/**
 * The address Content's edge saw, in the unit one reader holds: an IPv4
 * address, or an IPv6 /64, which one home or office network gets whole and
 * may rotate addresses within.
 */
function visitorNetwork(address: string): string | null {
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6 || address.includes("%")) return null;

  let ip = address.toLowerCase();
  const embedded = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1];
  if (embedded) {
    const [a, b, c, d] = embedded.split(".").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    ip = `${ip.slice(0, -embedded.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const hextets = [
    ...left,
    ...Array.from({ length: 8 - left.length - right.length }, () => "0"),
    ...right,
  ].map((hextet) => Number.parseInt(hextet, 16));
  if (hextets.length !== 8) return null;

  // An IPv4-mapped address is that IPv4 reader.
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return [
      hextets[6]! >> 8,
      hextets[6]! & 0xff,
      hextets[7]! >> 8,
      hextets[7]! & 0xff,
    ].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(":")}::/64`;
}

/**
 * The visitor key for a signed-out reader. Only Netlify's
 * `x-nf-client-connection-ip`, which its edge sets, is read: a forwarded-for
 * value is whatever the browser sent.
 */
export function publicClipVisitor(
  headers: Headers | undefined,
): PublicClipVisitor {
  const address = headers?.get("x-nf-client-connection-ip")?.trim();
  if (!address) return { key: null, reason: "no_edge_address" };
  const network = visitorNetwork(address);
  if (!network) return { key: null, reason: "unreadable_edge_address" };
  return {
    key: createHmac("sha256", VISITOR_KEY_SECRET)
      .update(network)
      .digest("base64url")
      .slice(0, 32),
  };
}

/**
 * Counts one signed-out read under `key`, or refuses it once the key has
 * used up this minute's. A full map drops its oldest key rather than refuse
 * anyone: that gives one reader a fresh window, where refusing would turn
 * away every new reader in this process.
 */
export function takePublicClipRead(key: string): boolean {
  const now = Date.now();
  const bucket = visitorReads.get(key);
  if (bucket && bucket.reset >= now) {
    if (bucket.count >= PUBLIC_CLIP_READS_PER_MINUTE) return false;
    bucket.count += 1;
    return true;
  }
  visitorReads.delete(key);
  if (visitorReads.size >= MAX_VISITORS) {
    for (const [stale, { reset }] of visitorReads) {
      if (reset < now) visitorReads.delete(stale);
    }
  }
  const oldest = visitorReads.keys().next();
  if (visitorReads.size >= MAX_VISITORS && !oldest.done) {
    visitorReads.delete(oldest.value);
  }
  visitorReads.set(key, { count: 1, reset: now + READ_WINDOW_MS });
  return true;
}

export function __resetPublicClipReadsForTests(): void {
  visitorReads.clear();
}
