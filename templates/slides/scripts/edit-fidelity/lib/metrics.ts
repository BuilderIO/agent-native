/**
 * Node-side scoring for the edit-fidelity harness: pixel diffs, computed-style
 * deltas, saved-HTML checks and the baseline ratchet. Pure functions except
 * the lazily-loaded pixelmatch/pngjs, so the spec can cover the logic.
 */
import { parse, type DefaultTreeAdapterTypes as P5 } from "parse5";

import { resolvePnpmEntry } from "../../export-fidelity/resolve-pkg.ts";
import type { KeepaliveWrite, Rect, SnapRecord, Snapshot } from "./in-page.ts";

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

const baseOf = (key: string) => key.replace(/#\d+$/, "");

/**
 * Pairs the unchanged head and tail of the record sequence by position, the
 * middle by key, then leftover text records whose text only grew or shrank at
 * the end (append / enter3 change the edited run's own key).
 */
export function diffSnapshots(a: Snapshot, b: Snapshot): StyleDiff {
  const A = a.records;
  const B = b.records;
  // An edit changes one contiguous stretch of the document, so the head and
  // tail pair by position. Per-text ordinals cannot: when the edited copy of a
  // repeated text changes, later copies renumber onto their neighbours. Never
  // pair on `inside`; each snapshot locates the edited element differently.
  const same = (i: number, j: number) => baseOf(A[i].key) === baseOf(B[j].key);
  let head = 0;
  while (head < A.length && head < B.length && same(head, head)) head++;
  let tail = 0;
  while (
    head + tail < A.length &&
    head + tail < B.length &&
    same(A.length - 1 - tail, B.length - 1 - tail)
  ) {
    tail++;
  }
  const pairs: Array<[SnapRecord, SnapRecord]> = [];
  for (let i = 0; i < head; i++) pairs.push([A[i], B[i]]);
  for (let i = 1; i <= tail; i++)
    pairs.push([A[A.length - i], B[B.length - i]]);
  const bByKey = new Map(B.slice(head, B.length - tail).map((r) => [r.key, r]));
  const leftA: SnapRecord[] = [];
  for (const r of A.slice(head, A.length - tail)) {
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

// ---------------------------------------------------------------- writes ---

export const stripSpace = (s: string) => s.replace(/[\s\u200b\ufeff]+/g, "");

const UNRENDERED = new Set(["style", "script", "svg", "template", "math"]);

/** A parse5 node's text, skipping elements the renderer drops. */
export const visibleTextOf = (node: P5.Node): string =>
  node.nodeName === "#text"
    ? (node as P5.TextNode).value
    : "childNodes" in node &&
        !UNRENDERED.has((node as P5.Element).tagName ?? "")
      ? (node as P5.ParentNode).childNodes.map(visibleTextOf).join("")
      : "";

/**
 * The slide's content in a write's JSON body, once per operation naming the
 * slide; null where one names it without setting content (a delete, a
 * fields-only patch) or a full save leaves the slide out.
 */
export function slideContentsOf(
  action: string,
  body: any,
  slideId: string,
): Array<string | null> {
  const entries: Array<[unknown, unknown]> =
    action === "patch-deck"
      ? (body.operations ?? []).map((op: any) => [
          op.slideId,
          op.fields?.content,
        ])
      : action === "update-slide"
        ? [[body.slideId, body.content]]
        : (body.deck?.slides ?? []).map((s: any) => [s.id, s.content]);
  const named = entries.filter(([id]) => String(id) === slideId);
  if (action === "save-deck" && !named.length) return [null];
  return named.map(([, content]) =>
    typeof content === "string" ? content : null,
  );
}

/** The slide content a write sets when that is all it changes; else null. */
function contentOnlyPatch(
  action: string,
  body: any,
  slideId: string,
): string | null {
  const ops = action === "patch-deck" ? (body.operations ?? []) : [];
  const [op] = ops;
  return ops.length === 1 &&
    op.op === "patch-slide" &&
    String(op.slideId) === slideId &&
    Object.keys(op.fields ?? {}).join() === "content" &&
    typeof op.fields.content === "string"
    ? op.fields.content
    : null;
}

/**
 * Whether one phase's writes are the editor's draft then revert: keys far
 * enough apart that the typed state saved before the delete saved the stored
 * bytes back. Both writes may set only the edited slide's content, and the
 * draft is held to append's rule: bytes outside the edited element (`element`,
 * its range in `stored`) are unchanged, and inside it only `typed` was added
 * to its text.
 */
export function isDraftRevert(
  stored: string,
  element: { start: number; end: number },
  typed: string,
  writes: Array<{ action: string; body: any }>,
  slideId: string,
): boolean {
  if (writes.length !== 2) return false;
  const [draft, revert] = writes.map((w) =>
    contentOnlyPatch(w.action, w.body, slideId),
  );
  if (draft === null || revert !== stored) return false;
  const before = stored.slice(0, element.start);
  const after = stored.slice(element.end);
  if (
    draft.length < before.length + after.length ||
    !draft.startsWith(before) ||
    !draft.endsWith(after)
  ) {
    return false;
  }
  const textOf = (html: string) => stripSpace(visibleTextOf(parse(html)));
  const want = textOf(stored.slice(element.start, element.end));
  const have = textOf(draft.slice(element.start, draft.length - after.length));
  for (let i = 0; i < have.length; i++) {
    if (
      have.startsWith(typed, i) &&
      have.slice(0, i) + have.slice(i + typed.length) === want
    )
      return true;
  }
  return false;
}

/**
 * The slide contents unload keepalive writes carried that differ from what
 * the edit saved; null for a body that could not be read, and for a write
 * that deletes or replaces the slide without content to compare.
 */
export function keepaliveMismatches(
  writes: KeepaliveWrite[],
  slideId: string,
  saved: string,
): Array<string | null> {
  return writes.flatMap((w) =>
    w.body === null
      ? [null]
      : slideContentsOf(w.action, JSON.parse(w.body), slideId).filter(
          (c) => c !== saved,
        ),
  );
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

const collapse = (s: string) =>
  s
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * `after` is `before` with `token` inserted exactly once, at any point: End
 * lands mid-text in a wrapped paragraph. Beside the token, the insertion may
 * only hold spaces and marker glyphs, since Enter in a custom bullet row
 * clones its marker; any letter or digit there, or any text of `before`
 * missing, fails. Whitespace runs compare as one space, so a line break reads
 * as a space and a token's leading space may merge with one already there,
 * but a lost space fails.
 */
export function isSplicedOnce(
  before: string,
  token: string,
  after: string,
): boolean {
  const b = collapse(before);
  const t = collapse(token);
  const a = collapse(after);
  const spaced = /^\s/.test(token);
  for (let i = 0; i <= b.length; i++) {
    const tail = b.length - i;
    if (a.length - tail < i + t.length) break;
    if (!a.startsWith(b.slice(0, i)) || !a.endsWith(b.slice(i))) continue;
    const inserted = a.slice(i, a.length - tail).split(t);
    if (inserted.length !== 2 || /[\p{L}\p{N}]/u.test(inserted.join("")))
      continue;
    const lead = a.slice(0, i) + inserted[0];
    if (!spaced || lead === "" || lead.endsWith(" ")) return true;
  }
  return false;
}

/**
 * Keys of text records `b` adds inside the edited element whose style no
 * text of that element had in `a`: typing that lands in a new node outside
 * the run it continued, so it loses the run's color or weight. `diffSnapshots`
 * lists such records as added, which alone is no violation.
 */
export function restyledAddedText(a: Snapshot, b: Snapshot): string[] {
  const added = new Set(diffSnapshots(a, b).added.map((r) => r.key));
  const known = new Set(
    a.records
      .filter((r) => r.kind === "text" && r.inside)
      .map((r) => JSON.stringify(r.props)),
  );
  return b.records
    .filter(
      (r) =>
        r.kind === "text" &&
        r.inside &&
        added.has(r.key) &&
        !known.has(JSON.stringify(r.props)),
    )
    .map((r) => r.key);
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
  /** Typed, still editing -> after exit, whole slide. */
  typedPct: number;
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
  "typedPct",
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

/** An entry recorded before a field existed holds it to the invariant. */
function pctCeiling(entry: BaselineEntry, f: (typeof PCT_FIELDS)[number]) {
  return entry[f] ?? ceilingFor(0);
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
  for (const f of PCT_FIELDS)
    next[f] = Math.min(pctCeiling(existing, f), next[f]);
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
      const ceiling = pctCeiling(b, f);
      if (m[f] > ceiling)
        problems.push(`${key}: ${f} ${m[f]}% exceeds ceiling ${ceiling}%`);
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

/** Baseline keys whose case, or slide within it, the corpus no longer has. */
export function orphanedBaselineKeys(
  keys: string[],
  slideCounts: Map<string, number>,
): string[] {
  return keys.filter((key) => {
    const [caseId, slide] = key.split("/");
    const count = slideCounts.get(caseId);
    return count === undefined || Number(slide.slice(1)) > count;
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
