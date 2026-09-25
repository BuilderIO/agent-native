/**
 * Node-side scoring for the edit-fidelity harness: pixel diffs, computed-style
 * deltas, saved-HTML checks and the baseline ratchet. Pure functions except
 * the lazily-loaded pixelmatch/pngjs, so the spec can cover the logic.
 */
import { resolvePnpmEntry } from "../../export-fidelity/resolve-pkg.ts";
import type { Rect, SnapRecord, Snapshot } from "./in-page.ts";

// ---------------------------------------------------------------- pixels ---

let codecs: { pixelmatch: any; PNG: any } | null = null;
async function loadCodecs() {
  if (!codecs) {
    const pm: any = await import(resolvePnpmEntry("pixelmatch", "7.2"));
    const png: any = await import(resolvePnpmEntry("pngjs", "7."));
    codecs = {
      pixelmatch: pm.default ?? pm,
      PNG: png.PNG ?? png.default?.PNG,
    };
  }
  return codecs;
}

export interface PixelDiff {
  /** Percent of compared pixels that differ. */
  pct: number;
  diffPixels: number;
  comparedPixels: number;
  sizeMismatch: boolean;
}

/**
 * pixelmatch at threshold 0.1 over the overlap of two PNGs. Excluded rects are
 * blanked in both images and left out of the denominator, so a larger
 * exclusion can never read as a better score. A size mismatch is reported,
 * never resized away.
 */
export async function diffPngs(
  a: Buffer,
  b: Buffer,
  exclude: Rect[] = [],
): Promise<PixelDiff & { png: Buffer }> {
  const { pixelmatch, PNG } = await loadCodecs();
  const ia = PNG.sync.read(a);
  const ib = PNG.sync.read(b);
  const width = Math.min(ia.width, ib.width);
  const height = Math.min(ia.height, ib.height);
  const crop = (img: any) => {
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      img.data.copy(
        out,
        y * width * 4,
        y * img.width * 4,
        (y * img.width + width) * 4,
      );
    }
    return out;
  };
  const da = crop(ia);
  const db = crop(ib);
  let excluded = 0;
  const mask = new Uint8Array(width * height);
  for (const r of exclude) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.width));
    const y1 = Math.min(height, Math.ceil(r.y + r.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
    }
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    excluded++;
    da.fill(0, i * 4, i * 4 + 4);
    db.fill(0, i * 4, i * 4 + 4);
  }
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(da, db, out.data, width, height, {
    threshold: 0.1,
  });
  const comparedPixels = Math.max(1, width * height - excluded);
  return {
    pct: round3((diffPixels / comparedPixels) * 100),
    diffPixels,
    comparedPixels,
    sizeMismatch: ia.width !== ib.width || ia.height !== ib.height,
    png: PNG.sync.write(out),
  };
}

/** Padding around exclusion rects: anti-aliasing and focus rings bleed. */
export function padRect(r: Rect, pad = 4): Rect {
  return {
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

// ---------------------------------------------------------------- styles ---

export interface StyleDelta {
  key: string;
  prop: string;
  a: string;
  b: string;
  inside: boolean;
}

export interface StyleDiff {
  /** Non-geometry property changes on records present on both sides. */
  deltas: StyleDelta[];
  /** Position/size changes beyond 1px. */
  geometry: StyleDelta[];
  missing: Array<{ key: string; inside: boolean }>;
  added: Array<{ key: string; inside: boolean }>;
}

const GEOMETRY_TOLERANCE = 1;

function textOf(key: string): string | null {
  const m = key.match(/^text:(.*)#\d+$/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/**
 * Pairs records by key, then pairs leftover text records whose text only grew
 * or shrank at the end (append / enter3 change the edited run's own key).
 */
export function diffSnapshots(a: Snapshot, b: Snapshot): StyleDiff {
  const bByKey = new Map(b.records.map((r) => [r.key, r]));
  const pairs: Array<[SnapRecord, SnapRecord]> = [];
  const leftA: SnapRecord[] = [];
  for (const r of a.records) {
    const other = bByKey.get(r.key);
    if (other) {
      pairs.push([r, other]);
      bByKey.delete(r.key);
    } else {
      leftA.push(r);
    }
  }
  const leftB = [...bByKey.values()];
  const missing: StyleDiff["missing"] = [];
  for (const r of leftA) {
    const t = textOf(r.key);
    const idx =
      t === null
        ? -1
        : leftB.findIndex((o) => {
            const u = textOf(o.key);
            return !!u && !!t && (u.startsWith(t) || t.startsWith(u));
          });
    if (idx >= 0) {
      pairs.push([r, leftB[idx]]);
      leftB.splice(idx, 1);
    } else {
      missing.push({ key: r.key, inside: r.inside });
    }
  }
  const deltas: StyleDelta[] = [];
  const geometry: StyleDelta[] = [];
  for (const [ra, rb] of pairs) {
    const inside = ra.inside || rb.inside;
    for (const prop of Object.keys(ra.props)) {
      if (ra.props[prop] !== rb.props[prop]) {
        deltas.push({
          key: ra.key,
          prop,
          a: ra.props[prop],
          b: rb.props[prop] ?? "(absent)",
          inside,
        });
      }
    }
    for (const prop of ["x", "y", "width", "height"] as const) {
      if (Math.abs(ra.rect[prop] - rb.rect[prop]) > GEOMETRY_TOLERANCE) {
        geometry.push({
          key: ra.key,
          prop,
          a: String(ra.rect[prop]),
          b: String(rb.rect[prop]),
          inside,
        });
      }
    }
  }
  return {
    deltas,
    geometry,
    missing,
    added: leftB.map((r) => ({ key: r.key, inside: r.inside })),
  };
}

// ------------------------------------------------------------------ html ---

export const HARD_FAIL_PATTERNS: Record<string, RegExp> = {
  "data-slide-content-scope": /data-slide-content-scope/g,
  "visibility:hidden": /visibility\s*:\s*hidden/gi,
  "data-editing-block": /data-editing-block/g,
  contenteditable: /contenteditable/gi,
  "data-builder-id": /data-builder-id/g,
  ProseMirror: /ProseMirror/g,
  "data-src-i": /data-src-i/g,
};

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const styleTexts = (s: string) =>
  [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) =>
    m[1].replace(/\s+/g, " ").trim(),
  );

/** Markers of editor/renderer state leaking into the stored source. */
export function hardFailures(stored: string, saved: string): string[] {
  const out: string[] = [];
  for (const [name, re] of Object.entries(HARD_FAIL_PATTERNS)) {
    const before = count(stored, re);
    const after = count(saved, re);
    if (after > before) out.push(`${name} ${before}->${after}`);
  }
  if (styleTexts(stored).join("\n") !== styleTexts(saved).join("\n")) {
    out.push("<style> text changed");
  }
  for (const tag of ["svg", "img"]) {
    const re = new RegExp(`<${tag}\\b`, "gi");
    const before = count(stored, re);
    const after = count(saved, re);
    if (after < before) out.push(`<${tag}> ${before}->${after}`);
  }
  return out;
}

/** Minimal line diff (LCS) for canonical HTML; `-` stored, `+` saved. */
export function lineDiff(a: string[], b: string[], max = 120): string[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  // ponytail: O(n*m) LCS on the differing middle only; fine for slide-sized HTML.
  const lcs: number[][] = Array.from({ length: ma.length + 1 }, () =>
    new Array(mb.length + 1).fill(0),
  );
  for (let i = ma.length - 1; i >= 0; i--) {
    for (let j = mb.length - 1; j >= 0; j--) {
      lcs[i][j] =
        ma[i] === mb[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < ma.length || j < mb.length) {
    if (i < ma.length && j < mb.length && ma[i] === mb[j]) {
      i++;
      j++;
    } else if (
      i < ma.length &&
      (j >= mb.length || lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      out.push(`- ${ma[i++]}`);
    } else {
      out.push(`+ ${mb[j++]}`);
    }
  }
  return out.length > max
    ? [...out.slice(0, max), `… ${out.length - max} more changed lines`]
    : out;
}

// -------------------------------------------------------------- baseline ---

export type Status = "pass" | "fail" | "no-edit" | "error";
const STATUS_RANK: Record<Status, number> = {
  pass: 0,
  fail: 1,
  "no-edit": 2,
  error: 3,
};

/** Ratcheted numbers per case/slide/target/scenario. */
export interface ScenarioMetrics {
  status: Status;
  editingPct: number;
  afterPct: number;
  reloadPct: number;
  outsideEditingPct: number;
  outsideAfterPct: number;
  styleDeltasEditing: number;
  styleDeltasAfter: number;
  missingAfter: number;
  htmlDiffLines: number;
  hardFailures: number;
  violations: number;
}

const PCT_FIELDS = [
  "editingPct",
  "afterPct",
  "reloadPct",
  "outsideEditingPct",
  "outsideAfterPct",
] as const;
const COUNT_FIELDS = [
  "styleDeltasEditing",
  "styleDeltasAfter",
  "missingAfter",
  "htmlDiffLines",
  "hardFailures",
  "violations",
] as const;

export type BaselineEntry = ScenarioMetrics;

/** Same slack as the Design harness: d + max(0.1, 15% of d). */
export function ceilingFor(pct: number): number {
  return Number((pct + Math.max(0.1, pct * 0.15)).toFixed(3));
}

export function toBaselineEntry(m: ScenarioMetrics): BaselineEntry {
  const entry = { ...m };
  for (const f of PCT_FIELDS) entry[f] = ceilingFor(m[f]);
  return entry;
}

/**
 * The entry `--update` writes: a fresh measurement for a new key, and for an
 * existing one the stricter of the two per field, so an update never loosens
 * the ratchet. Loosening an entry is a deliberate edit, not a re-measure.
 */
export function ratchetBaselineEntry(
  existing: BaselineEntry | undefined,
  m: ScenarioMetrics,
): BaselineEntry {
  const next = toBaselineEntry(m);
  if (!existing) return next;
  if (STATUS_RANK[existing.status] < STATUS_RANK[next.status]) {
    next.status = existing.status;
  }
  for (const f of PCT_FIELDS) next[f] = Math.min(existing[f], next[f]);
  for (const f of COUNT_FIELDS) next[f] = Math.min(existing[f], next[f]);
  return next;
}

/**
 * Regressions against the ratchet. `expected` lists keys that should have run
 * this time (within the run's filters and limits); a baselined key among them
 * that produced no result is a problem, because a harness that silently runs
 * less can never fail.
 */
export function findBaselineProblems(
  results: Map<string, ScenarioMetrics>,
  baseline: Record<string, BaselineEntry>,
  isExpected: (key: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const [key, m] of results) {
    // An error measured nothing, so no baseline can make it a pass.
    if (m.status === "error") {
      problems.push(`${key}: errored`);
      continue;
    }
    const b = baseline[key];
    if (!b) {
      problems.push(
        `${key}: no baseline entry (status ${m.status}) - run with --update to record one`,
      );
      continue;
    }
    if (STATUS_RANK[m.status] > STATUS_RANK[b.status]) {
      problems.push(`${key}: status ${b.status} -> ${m.status}`);
    }
    for (const f of PCT_FIELDS) {
      if (m[f] > b[f])
        problems.push(`${key}: ${f} ${m[f]}% exceeds ceiling ${b[f]}%`);
    }
    for (const f of COUNT_FIELDS) {
      if (m[f] > b[f])
        problems.push(`${key}: ${f} ${m[f]} exceeds baseline ${b[f]}`);
    }
  }
  for (const key of Object.keys(baseline)) {
    if (!results.has(key) && isExpected(key)) {
      problems.push(`${key}: baselined scenario did not run`);
    }
  }
  return problems;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
