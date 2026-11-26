import crypto from "node:crypto";
import net from "node:net";

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export interface SourceSlice {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface SliceResult {
  hits: number;
  matchedTerms: string[];
  slices: SourceSlice[];
  truncated: boolean;
}

const MIN_TERM_LENGTH = 3;

function usableTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.filter((t) => t.length >= MIN_TERM_LENGTH))];
}

const IDENT_CHAR = /[\w$-]/;

/** Next occurrence of term not embedded in a longer identifier (so "orb" skips "absorb"). */
function findTerm(text: string, term: string, from: number): number {
  let at = text.indexOf(term, from);
  while (at !== -1) {
    const before = at > 0 ? (text[at - 1] ?? "") : "";
    const after = text[at + term.length] ?? "";
    if (!IDENT_CHAR.test(before) && !IDENT_CHAR.test(after)) return at;
    at = text.indexOf(term, at + 1);
  }
  return -1;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function toSlice(text: string, start: number, end: number): SourceSlice {
  return {
    start,
    end,
    startLine: lineOf(text, start),
    endLine: lineOf(text, end),
    text: text.slice(start, end),
  };
}

function takeWithinBudget(
  text: string,
  ranges: Array<[number, number]>,
  maxBytes: number,
): { slices: SourceSlice[]; truncated: boolean } {
  const slices: SourceSlice[] = [];
  let used = 0;
  let truncated = false;
  for (const [start, end] of ranges) {
    const length = end - start;
    if (used + length > maxBytes) {
      truncated = true;
      const room = maxBytes - used;
      if (room > 0) slices.push(toSlice(text, start, start + room));
      break;
    }
    slices.push(toSlice(text, start, end));
    used += length;
  }
  return { slices, truncated };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

interface CssBlock {
  start: number;
  end: number;
  prelude: string;
  body: string;
}

function topLevelCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let blockStart = 0;
  let preludeEnd = -1;
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close === -1 ? css.length : close + 1;
    } else if (ch === "{") {
      if (depth === 0) preludeEnd = i;
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && preludeEnd !== -1) {
        blocks.push({
          start: blockStart,
          end: i + 1,
          prelude: css.slice(blockStart, preludeEnd),
          body: css.slice(preludeEnd, i + 1),
        });
        blockStart = i + 1;
        preludeEnd = -1;
      }
    } else if (ch === ";" && depth === 0) {
      blockStart = i + 1;
    }
  }
  return blocks;
}

/** Keep the top-level CSS rules (and @media/@keyframes wrappers) that mention a term. */
export function sliceStylesheet(
  css: string,
  terms: readonly string[],
  maxBytes: number,
): SliceResult {
  const wanted = usableTerms(terms);
  const matched = new Set<string>();
  const ranges: Array<[number, number]> = [];
  let hits = 0;
  for (const block of topLevelCssBlocks(css)) {
    const haystack = `${block.prelude}${block.body}`;
    let blockHit = false;
    for (const term of wanted) {
      if (findTerm(haystack, term, 0) !== -1) {
        matched.add(term);
        blockHit = true;
        hits++;
      }
    }
    if (blockHit) ranges.push([block.start, block.end]);
  }
  const { slices, truncated } = takeWithinBudget(
    css,
    mergeRanges(ranges),
    maxBytes,
  );
  return { hits, matchedTerms: [...matched], slices, truncated };
}

/** Keep fixed windows around each term occurrence in script or data text. */
export function sliceScript(
  text: string,
  terms: readonly string[],
  windowChars: number,
  maxBytes: number,
): SliceResult {
  const wanted = usableTerms(terms);
  const matched = new Set<string>();
  const ranges: Array<[number, number]> = [];
  let hits = 0;
  const maxHitsPerTerm = 20;
  for (const term of wanted) {
    let from = 0;
    let count = 0;
    while (count < maxHitsPerTerm) {
      const at = findTerm(text, term, from);
      if (at === -1) break;
      matched.add(term);
      hits++;
      count++;
      ranges.push([
        Math.max(0, at - windowChars),
        Math.min(text.length, at + term.length + windowChars),
      ]);
      from = at + term.length;
    }
  }
  const { slices, truncated } = takeWithinBudget(
    text,
    mergeRanges(ranges),
    maxBytes,
  );
  return { hits, matchedTerms: [...matched], slices, truncated };
}

/** True for loopback, private, link-local, unique-local and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  const family = net.isIP(ip);
  if (family === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower)
    );
  }
  return false;
}
