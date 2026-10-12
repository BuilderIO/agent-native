/**
 * Node-side scoring for the edit-fidelity harness: pixel diffs, computed-style
 * deltas, saved-HTML checks and the baseline ratchet. Pure functions except
 * the lazily-loaded pixelmatch/pngjs, so the spec can cover the logic.
 */
import { parse, type DefaultTreeAdapterTypes as P5 } from "parse5";

import { resolvePnpmEntry } from "../../export-fidelity/resolve-pkg.ts";
import type {
  KeepaliveWrite,
  OutsideSnapshot,
  Rect,
  SnapRecord,
  Snapshot,
} from "./in-page.ts";

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

const GEOMETRY_TOLERANCE = 1;

/** Unknown rects and subpixel noise cannot waive the outside-pixel check. */
export const resized = (a: Rect | null, b: Rect | null) =>
  !!a &&
  !!b &&
  (Math.abs(a.width - b.width) >= GEOMETRY_TOLERANCE ||
    Math.abs(a.height - b.height) >= GEOMETRY_TOLERANCE);

/** Event Timing omits entries below its configured duration threshold. */
export function p95IndexFromThresholdedSamples(
  totalCount: number,
  observedCount: number,
  threshold: number,
):
  | { kind: "observed"; index: number }
  | { kind: "below-threshold"; bound: number } {
  if (
    !Number.isSafeInteger(totalCount) ||
    totalCount < 1 ||
    !Number.isSafeInteger(observedCount) ||
    observedCount < 0 ||
    observedCount > totalCount ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    throw new RangeError("invalid thresholded percentile sample counts");
  }
  const rank = Math.ceil(totalCount * 0.95) - 1;
  const belowThresholdCount = totalCount - observedCount;
  return rank < belowThresholdCount
    ? { kind: "below-threshold", bound: threshold }
    : { kind: "observed", index: rank - belowThresholdCount };
}

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

export const followsCenteredFlexReflow = (
  before: SnapRecord | undefined,
  after: SnapRecord | undefined,
  prop: string,
  actualShift: number,
) => {
  const a = before?.flexCrossAlignment;
  const b = after?.flexCrossAlignment;
  if (
    !a ||
    !b ||
    prop !== a.axis ||
    a.axis !== b.axis ||
    a.context !== b.context
  )
    return false;
  const containerShift = b.containerPosition - a.containerPosition;
  const containerSizeShift = b.containerSize - a.containerSize;
  const editedItemSizeShift = b.editedItemSize - a.editedItemSize;
  const expectedShift =
    containerShift + (containerSizeShift - (b.itemSize - a.itemSize)) / 2;
  // Only edit-caused line growth with a stationary parent and unchanged item-local offset is natural reflow.
  const lineFollowsEdit =
    Math.abs(containerSizeShift) <= 1 ||
    (Math.sign(containerSizeShift) === Math.sign(editedItemSizeShift) &&
      Math.abs(containerSizeShift) <= Math.abs(editedItemSizeShift) + 1);
  return (
    lineFollowsEdit &&
    Math.abs(containerShift) <= 1 &&
    Math.abs(actualShift - expectedShift) <= 1
  );
};

function textOf(key: string): string | null {
  const m = key.match(/^text:(.*)#\d+$/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

const baseOf = (key: string) => key.replace(/#\d+$/, "");

const CSS_PIXEL_QUANTIZATION = 1 / 64;
// Computed CSS pixels are serialized to thousandths, so two rounded samples
// can differ by one layout quantum plus at most a thousandth.
const CSS_PIXEL_SERIALIZATION_TOLERANCE = 0.001;
const PX_VALUE = /^(-?\d+(?:\.\d+)?)px$/u;

function sameComputedPosition(prop: string, before: string, after: string) {
  const closePixels = (a: string, b: string) => {
    const left = PX_VALUE.exec(a);
    const right = PX_VALUE.exec(b);
    return Boolean(
      left &&
      right &&
      Math.abs(Number(left[1]) - Number(right[1])) <=
        CSS_PIXEL_QUANTIZATION + CSS_PIXEL_SERIALIZATION_TOLERANCE,
    );
  };
  if (["top", "right", "bottom", "left"].includes(prop)) {
    return closePixels(before, after);
  }
  if (prop === "transform-origin") {
    const left = before.split(/\s+/u);
    const right = after.split(/\s+/u);
    return (
      left.length === right.length &&
      left.every(
        (value, index) =>
          value === right[index] || closePixels(value, right[index]!),
      )
    );
  }
  if (prop === "transform") {
    const matrix = (value: string) => {
      const match = /^matrix\(([^)]+)\)$/u.exec(value);
      return match ? match[1]!.split(/,\s*/u).map(Number) : null;
    };
    const left = matrix(before);
    const right = matrix(after);
    return Boolean(
      left &&
      right &&
      left.length === 6 &&
      right.length === 6 &&
      left.slice(0, 4).every((value, index) => value === right[index]) &&
      Math.abs(left[4]! - right[4]!) <=
        CSS_PIXEL_QUANTIZATION + CSS_PIXEL_SERIALIZATION_TOLERANCE &&
      Math.abs(left[5]! - right[5]!) <=
        CSS_PIXEL_QUANTIZATION + CSS_PIXEL_SERIALIZATION_TOLERANCE,
    );
  }
  return false;
}

/**
 * Pairs the unchanged head and tail of the record sequence by position, the
 * middle by key, then leftover text records whose text only grew or shrank at
 * the end (append / enter3 change the edited run's own key).
 */
export function diffSnapshots(
  a: Pick<Snapshot, "records">,
  b: Pick<Snapshot, "records">,
): StyleDiff {
  const allA = a.records;
  const allB = b.records;
  const stableB = new Map(
    allB.flatMap((record) =>
      record.stableKey ? [[record.stableKey, record] as const] : [],
    ),
  );
  const pairs: Array<[SnapRecord, SnapRecord]> = [];
  const pairedB = new Set<SnapRecord>();
  const unmatchedA = allA.filter((record) => {
    const other = record.stableKey ? stableB.get(record.stableKey) : undefined;
    if (
      other &&
      (!record.pptxRecordKey ||
        !other.pptxRecordKey ||
        record.pptxRecordKey === other.pptxRecordKey)
    ) {
      pairs.push([record, other]);
      pairedB.add(other);
      return false;
    }
    return true;
  });
  const B = allB.filter((record) => !pairedB.has(record));
  const pptxB = new Map<string, SnapRecord[]>();
  for (const record of B) {
    if (!record.pptxRecordKey) continue;
    const records = pptxB.get(record.pptxRecordKey) ?? [];
    records.push(record);
    pptxB.set(record.pptxRecordKey, records);
  }
  const A = unmatchedA.filter((record) => {
    const matches = record.pptxRecordKey
      ? pptxB.get(record.pptxRecordKey)
      : undefined;
    if (matches?.length !== 1 || pairedB.has(matches[0]!)) return true;
    pairs.push([record, matches[0]!]);
    pairedB.add(matches[0]!);
    return false;
  });
  const unmatchedB = B.filter((record) => !pairedB.has(record));
  // An edit changes one contiguous stretch of the document, so the head and
  // tail pair by position. Per-text ordinals cannot: when the edited copy of a
  // repeated text changes, later copies renumber onto their neighbours. Never
  // pair on `inside`; each snapshot locates the edited element differently.
  const same = (i: number, j: number) =>
    baseOf(A[i].key) === baseOf(unmatchedB[j].key);
  let head = 0;
  while (head < A.length && head < unmatchedB.length && same(head, head))
    head++;
  let tail = 0;
  while (
    head + tail < A.length &&
    head + tail < unmatchedB.length &&
    same(A.length - 1 - tail, unmatchedB.length - 1 - tail)
  ) {
    tail++;
  }
  for (let i = 0; i < head; i++) pairs.push([A[i], unmatchedB[i]]);
  for (let i = 1; i <= tail; i++)
    pairs.push([A[A.length - i], unmatchedB[unmatchedB.length - i]]);
  const bByKey = new Map(
    unmatchedB.slice(head, unmatchedB.length - tail).map((r) => [r.key, r]),
  );
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
      missing.push({
        key: r.key,
        inside: r.inside && !r.protectedStructure,
      });
    }
  }
  const deltas: StyleDelta[] = [];
  const geometry: StyleDelta[] = [];
  for (const [ra, rb] of pairs) {
    const inside = ra.inside || rb.inside;
    const protectedInside = inside && !(ra.protectedStyle || rb.protectedStyle);
    const protectedRectStable = Boolean(
      ra.protectedStyle &&
      rb.protectedStyle &&
      ra.protectedRect &&
      rb.protectedRect &&
      (["x", "y", "width", "height"] as const).every(
        (prop) =>
          Math.abs(ra.protectedRect![prop] - rb.protectedRect![prop]) <=
          GEOMETRY_TOLERANCE,
      ),
    );
    // Computed values can change with intrinsic layout; authored attrs cannot.
    for (const [prop, before, after] of [
      ["class", ra.className, rb.className],
      ["style", ra.inlineStyle, rb.inlineStyle],
    ] as const) {
      if (before !== undefined && after !== undefined && before !== after) {
        deltas.push({
          key: ra.key,
          prop,
          a: "changed",
          b: "changed",
          inside: protectedInside,
        });
      }
    }
    for (const prop of new Set([
      ...Object.keys(ra.props),
      ...Object.keys(rb.props),
    ])) {
      const beforeValue =
        ra.props[prop] ?? (prop.startsWith("--") ? "" : undefined);
      const afterValue =
        rb.props[prop] ?? (prop.startsWith("--") ? "" : undefined);
      if (
        beforeValue !== afterValue &&
        !(
          beforeValue &&
          afterValue &&
          sameComputedPosition(prop, beforeValue, afterValue)
        )
      ) {
        deltas.push({
          key: ra.key,
          prop,
          a: beforeValue ?? "(absent)",
          b: afterValue ?? "(absent)",
          inside: protectedInside,
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
          inside: protectedInside || protectedRectStable,
        });
      }
    }
  }
  return {
    deltas,
    geometry,
    missing,
    added: leftB.map((r) => ({
      key: r.key,
      inside: r.inside && !r.protectedStructure,
    })),
  };
}

export function outsideChangesFor(
  before: OutsideSnapshot,
  after: OutsideSnapshot,
) {
  const outside = diffSnapshots(before, after);
  const targetResized =
    before.editedRect !== null &&
    after.editedRect !== null &&
    (Math.abs(before.editedRect.width - after.editedRect.width) > 1 ||
      Math.abs(before.editedRect.height - after.editedRect.height) > 1);
  const naturalReflow =
    targetResized && before.editedInFlow && after.editedInFlow;
  const beforeRecords = new Map(
    before.records.map((record) => [record.key, record]),
  );
  const afterRecordsByKey = new Map(
    after.records.map((record) => [record.key, record]),
  );
  const afterRecordsByStableKey = new Map(
    after.records.flatMap((record) =>
      record.stableKey ? [[record.stableKey, record] as const] : [],
    ),
  );
  const afterRecordsByPptxKey = new Map(
    after.records.flatMap((record) =>
      record.pptxRecordKey ? [[record.pptxRecordKey, record] as const] : [],
    ),
  );
  const copiedMarkerRecords = () => {
    const fragments = after.editedAuthoringFragmentRects ?? [];
    const beforeObject = before.editedObjectRect;
    const afterObject = after.editedObjectRect;
    const objectUnchanged =
      !!beforeObject &&
      !!afterObject &&
      (["x", "y", "width", "height"] as const).every(
        (prop) => Math.abs(beforeObject[prop] - afterObject[prop]) <= 1,
      );
    if (
      !before.editedObjectId ||
      before.editedObjectId !== after.editedObjectId ||
      before.editedParagraphId !== after.editedParagraphId ||
      !objectUnchanged ||
      fragments.length !== 1 ||
      !after.editedTargetRect ||
      !fragments.some((fragment) =>
        (["x", "y", "width", "height"] as const).every(
          (prop) =>
            Math.abs(fragment[prop] - after.editedTargetRect![prop]) <= 1,
        ),
      )
    ) {
      return { missing: new Set<string>(), added: new Set<string>() };
    }
    const fragment = fragments[0]!;
    const markerFitsFragment = (record: SnapRecord) =>
      record.rect.x >= fragment.x - 1 &&
      record.rect.y >= fragment.y - 1 &&
      record.rect.x + record.rect.width <= fragment.x + fragment.width + 1 &&
      record.rect.y + record.rect.height <= fragment.y + fragment.height + 1;
    const beforeMarkers = before.records.filter(
      (record) =>
        record.slideObjectId === before.editedObjectId &&
        record.styledBulletMarker,
    );
    const afterMarkers = after.records.filter(
      (record) =>
        record.slideObjectId === before.editedObjectId &&
        record.styledBulletMarker,
    );
    const beforeTargetMarkers = beforeMarkers.filter(
      (record) => record.pptxParagraph === before.editedParagraphId,
    );
    const afterTargetMarkers = afterMarkers.filter(
      (record) => record.pptxParagraph === before.editedParagraphId,
    );
    const markersByParagraph = (records: SnapRecord[]) => {
      const grouped = new Map<string, SnapRecord[]>();
      for (const record of records) {
        const paragraph = record.pptxParagraph;
        if (!paragraph) return null;
        const group = grouped.get(paragraph) ?? [];
        group.push(record);
        grouped.set(paragraph, group);
      }
      return grouped;
    };
    const beforeByParagraph = markersByParagraph(beforeMarkers);
    const afterByParagraph = markersByParagraph(afterMarkers);
    if (
      !beforeByParagraph ||
      !afterByParagraph ||
      beforeTargetMarkers.length !== 1 ||
      afterTargetMarkers.length !== 2 ||
      afterMarkers.length !== beforeMarkers.length + 1
    ) {
      return { missing: new Set<string>(), added: new Set<string>() };
    }
    const sameMarkerAppearance = (previous: SnapRecord, current: SnapRecord) =>
      previous.styledBulletMarker &&
      current.styledBulletMarker &&
      previous.slideObjectId === current.slideObjectId &&
      previous.slideObjectId === before.editedObjectId &&
      previous.tag === current.tag &&
      previous.className === current.className &&
      previous.inlineStyle === current.inlineStyle &&
      previous.styledBulletMarkerText === current.styledBulletMarkerText &&
      JSON.stringify(previous.props) === JSON.stringify(current.props);
    const retainedMarkers = new Set<string>();
    const retainedBeforeMarkers = new Set<string>();
    for (const [paragraph, previousMarkers] of beforeByParagraph) {
      const currentMarkers = afterByParagraph.get(paragraph) ?? [];
      if (paragraph === before.editedParagraphId) {
        if (
          previousMarkers.length !== 1 ||
          currentMarkers.length !== previousMarkers.length + 1
        ) {
          return { missing: new Set<string>(), added: new Set<string>() };
        }
        const previous = previousMarkers[0]!;
        const retained = currentMarkers.filter(
          (current) =>
            sameMarkerAppearance(previous, current) &&
            (["x", "y", "width", "height"] as const).every(
              (prop) => Math.abs(previous.rect[prop] - current.rect[prop]) <= 1,
            ),
        );
        if (retained.length !== 1) {
          return { missing: new Set<string>(), added: new Set<string>() };
        }
        retainedMarkers.add(retained[0]!.key);
        retainedBeforeMarkers.add(previous.key);
        continue;
      }
      if (currentMarkers.length !== previousMarkers.length) {
        return { missing: new Set<string>(), added: new Set<string>() };
      }
      for (const previous of previousMarkers) {
        const matches = currentMarkers.filter(
          (current) =>
            sameMarkerAppearance(previous, current) &&
            previous.pptxRecordKey &&
            current.pptxRecordKey === previous.pptxRecordKey,
        );
        if (matches.length !== 1) {
          return { missing: new Set<string>(), added: new Set<string>() };
        }
        retainedMarkers.add(matches[0]!.key);
        retainedBeforeMarkers.add(previous.key);
      }
    }
    const insertedMarkers = afterTargetMarkers.filter(
      (record) => !retainedMarkers.has(record.key),
    );
    const sourceMarker = beforeTargetMarkers[0]!;
    if (
      insertedMarkers.length !== 1 ||
      !markerFitsFragment(insertedMarkers[0]!) ||
      !sameMarkerAppearance(sourceMarker, insertedMarkers[0]!)
    ) {
      return { missing: new Set<string>(), added: new Set<string>() };
    }
    const addedMarkers = outside.added.filter((change) => {
      const record = afterRecordsByKey.get(change.key);
      return (
        !!record &&
        record.slideObjectId === before.editedObjectId &&
        record.styledBulletMarker
      );
    });
    if (
      addedMarkers.some(
        (change) =>
          !retainedMarkers.has(change.key) &&
          change.key !== insertedMarkers[0]!.key,
      )
    ) {
      return { missing: new Set<string>(), added: new Set<string>() };
    }
    const missingMarkers = outside.missing.filter((change) => {
      const record = beforeRecords.get(change.key);
      return (
        !change.inside &&
        !!record &&
        record.slideObjectId === before.editedObjectId &&
        record.styledBulletMarker
      );
    });
    if (
      missingMarkers.some((change) => !retainedBeforeMarkers.has(change.key))
    ) {
      return { missing: new Set<string>(), added: new Set<string>() };
    }
    return {
      missing: new Set(missingMarkers.map((change) => change.key)),
      added: new Set(addedMarkers.map((change) => change.key)),
    };
  };
  const followsNaturalReflow = (change: StyleDelta) => {
    const beforeRecord = beforeRecords.get(change.key);
    const afterRecord = beforeRecord?.stableKey
      ? (afterRecordsByStableKey.get(beforeRecord.stableKey) ??
        afterRecordsByKey.get(change.key))
      : afterRecordsByKey.get(change.key);
    if (
      !naturalReflow ||
      (change.prop !== "x" && change.prop !== "y") ||
      !beforeRecord?.downstreamFlow ||
      !afterRecord?.downstreamFlow ||
      !before.editedRect ||
      !after.editedRect
    ) {
      return false;
    }
    const position = change.prop === "x" ? "x" : "y";
    const extent = change.prop === "x" ? "width" : "height";
    const expectedShift =
      after.editedRect[position] +
      after.editedRect[extent] -
      before.editedRect[position] -
      before.editedRect[extent];
    const actualShift = Number(change.b) - Number(change.a);
    return (
      Math.abs(actualShift - expectedShift) <= 1 ||
      followsCenteredFlexReflow(
        beforeRecord,
        afterRecord,
        change.prop,
        actualShift,
      )
    );
  };
  const followsImportedTextObjectReflow = (change: StyleDelta) => {
    const beforeRecord = beforeRecords.get(change.key);
    const stableAfter = beforeRecord?.stableKey
      ? afterRecordsByStableKey.get(beforeRecord.stableKey)
      : undefined;
    const stableAfterMatchesParagraph =
      !beforeRecord?.pptxRecordKey ||
      !stableAfter?.pptxRecordKey ||
      beforeRecord.pptxRecordKey === stableAfter.pptxRecordKey;
    const afterRecord = beforeRecord?.pptxRecordKey
      ? (afterRecordsByPptxKey.get(beforeRecord.pptxRecordKey) ??
        (stableAfterMatchesParagraph ? stableAfter : undefined) ??
        afterRecordsByKey.get(change.key))
      : (stableAfter ?? afterRecordsByKey.get(change.key));
    const beforeObject = before.editedObjectRect;
    const afterObject = after.editedObjectRect;
    const beforeTarget = before.editedFlowAnchorRect ?? before.editedTargetRect;
    const afterTarget = after.editedFlowAnchorRect ?? after.editedTargetRect;
    const targetParagraph = Number(before.editedParagraphId);
    const siblingParagraph = Number(beforeRecord?.pptxParagraph);
    const targetShift =
      beforeTarget && afterTarget ? afterTarget.y - beforeTarget.y : 0;
    const targetGrowth =
      beforeTarget && afterTarget
        ? afterTarget.height - beforeTarget.height
        : 0;
    const targetTextShift =
      before.editedTargetRect && after.editedTargetRect
        ? after.editedTargetRect.y - before.editedTargetRect.y
        : null;
    const insertedBeforeTarget =
      targetShift > GEOMETRY_TOLERANCE &&
      Math.abs(targetGrowth) <= GEOMETRY_TOLERANCE;
    const siblingYShifts = outside.geometry.flatMap((geometry) => {
      if (geometry.prop !== "y") return [];
      const previous = beforeRecords.get(geometry.key);
      const stable = previous?.stableKey
        ? afterRecordsByStableKey.get(previous.stableKey)
        : undefined;
      const current = previous?.pptxRecordKey
        ? (afterRecordsByPptxKey.get(previous.pptxRecordKey) ??
          (stable?.pptxRecordKey === previous.pptxRecordKey
            ? stable
            : undefined))
        : stable;
      const paragraph = Number(previous?.pptxParagraph);
      if (
        !previous ||
        !current ||
        previous.slideObjectId !== before.editedObjectId ||
        current.slideObjectId !== before.editedObjectId ||
        !Number.isSafeInteger(paragraph) ||
        paragraph <= targetParagraph
      ) {
        return [];
      }
      return [Number(geometry.b) - Number(geometry.a)];
    });
    const insertedFragments = after.editedAuthoringFragmentRects ?? [];
    const insertedFragmentBounds = insertedFragments.reduce(
      (bounds, fragment) => ({
        top: Math.min(bounds.top, fragment.y),
        bottom: Math.max(bounds.bottom, fragment.y + fragment.height),
      }),
      { top: Infinity, bottom: -Infinity },
    );
    const insertedFlowExtent =
      insertedFragments.length > 0
        ? insertedFragmentBounds.bottom - insertedFragmentBounds.top
        : null;
    const editedTargetIsInsertedFragment =
      !!after.editedTargetRect &&
      insertedFragments.some((fragment) =>
        (["x", "y", "width", "height"] as const).every(
          (prop) =>
            Math.abs(fragment[prop] - after.editedTargetRect![prop]) <=
            GEOMETRY_TOLERANCE,
        ),
      );
    // A multi-block paste pushes the original text by the first block's offset
    // plus the complete inserted run. A single split row uses its final edge.
    const insertedAfterTargetShift =
      targetTextShift !== null &&
      insertedFlowExtent !== null &&
      targetTextShift >= -GEOMETRY_TOLERANCE &&
      targetTextShift <= insertedFlowExtent + GEOMETRY_TOLERANCE
        ? insertedFragments.length > 1
          ? targetTextShift + insertedFlowExtent
          : editedTargetIsInsertedFragment && beforeTarget
            ? insertedFragmentBounds.bottom -
              (beforeTarget.y + beforeTarget.height)
            : targetTextShift + insertedFlowExtent
        : null;
    const downstreamAfterY = after.records
      .filter(
        (record) =>
          record.slideObjectId === before.editedObjectId &&
          Number.isSafeInteger(Number(record.pptxParagraph)) &&
          Number(record.pptxParagraph) > targetParagraph,
      )
      .reduce((nearest, record) => Math.min(nearest, record.rect.y), Infinity);
    const growsTarget =
      targetGrowth > GEOMETRY_TOLERANCE &&
      Math.abs(targetShift) <= GEOMETRY_TOLERANCE;
    const insertedAfterTargetBase =
      !!beforeTarget &&
      !!afterTarget &&
      Math.abs(targetShift) <= GEOMETRY_TOLERANCE &&
      Math.abs(targetGrowth) <= GEOMETRY_TOLERANCE &&
      insertedFragments.length > 0 &&
      insertedFragments.every(
        (fragment) =>
          fragment.y >=
            beforeTarget.y + beforeTarget.height - GEOMETRY_TOLERANCE &&
          fragment.y + fragment.height <= downstreamAfterY + GEOMETRY_TOLERANCE,
      ) &&
      insertedAfterTargetShift !== null &&
      siblingYShifts.length > 0 &&
      siblingYShifts.every(
        (shift) => Math.abs(shift - siblingYShifts[0]!) <= GEOMETRY_TOLERANCE,
      );
    const expectedFlowShift = growsTarget
      ? targetGrowth
      : insertedBeforeTarget
        ? targetShift
        : insertedAfterTargetBase
          ? insertedAfterTargetShift
          : null;
    const flowMarkers = before.records.filter((record) => {
      const paragraph = Number(record.pptxParagraph);
      return (
        record.slideObjectId === before.editedObjectId &&
        record.styledBulletMarker &&
        Number.isSafeInteger(paragraph) &&
        (paragraph > targetParagraph ||
          (insertedBeforeTarget && paragraph === targetParagraph))
      );
    });
    const flowMarkersMatch =
      expectedFlowShift === null ||
      flowMarkers.every((previous) => {
        if (!previous.pptxRecordKey || !previous.pptxParagraph) return false;
        const matches = after.records.filter(
          (current) =>
            current.slideObjectId === before.editedObjectId &&
            current.styledBulletMarker &&
            current.pptxParagraph === previous.pptxParagraph &&
            current.pptxRecordKey === previous.pptxRecordKey,
        );
        if (matches.length !== 1) return false;
        const current = matches[0]!;
        return (
          previous.tag === current.tag &&
          previous.className === current.className &&
          previous.inlineStyle === current.inlineStyle &&
          previous.styledBulletMarkerText === current.styledBulletMarkerText &&
          JSON.stringify(previous.props) === JSON.stringify(current.props) &&
          (["x", "width", "height"] as const).every(
            (prop) =>
              Math.abs(previous.rect[prop] - current.rect[prop]) <=
              GEOMETRY_TOLERANCE,
          ) &&
          Math.abs(current.rect.y - previous.rect.y - expectedFlowShift) <=
            GEOMETRY_TOLERANCE
        );
      });
    const insertedAfterTarget = insertedAfterTargetBase && flowMarkersMatch;
    if (
      change.prop !== "y" ||
      !before.editedObjectId ||
      before.editedObjectId !== after.editedObjectId ||
      !before.editedParagraphId ||
      before.editedParagraphId !== after.editedParagraphId ||
      before.editedObjectPosition !== "absolute" ||
      after.editedObjectPosition !== "absolute" ||
      !beforeObject ||
      !afterObject ||
      !beforeTarget ||
      !afterTarget ||
      !beforeRecord ||
      !afterRecord ||
      beforeRecord.slideObjectId !== before.editedObjectId ||
      afterRecord.slideObjectId !== before.editedObjectId ||
      !beforeRecord.pptxParagraph ||
      !afterRecord.pptxParagraph ||
      !Number.isSafeInteger(targetParagraph) ||
      !Number.isSafeInteger(siblingParagraph) ||
      !Number.isSafeInteger(Number(afterRecord.pptxParagraph)) ||
      siblingParagraph < targetParagraph ||
      (siblingParagraph === targetParagraph &&
        !insertedBeforeTarget &&
        !editedTargetIsInsertedFragment) ||
      (["x", "y", "width", "height"] as const).some(
        (prop) => Math.abs(beforeObject[prop] - afterObject[prop]) > 1,
      ) ||
      (["x", "width"] as const).some(
        (prop) => Math.abs(beforeTarget[prop] - afterTarget[prop]) > 1,
      )
    ) {
      return false;
    }
    const siblingShift = Number(change.b) - Number(change.a);
    const editedFragmentShift =
      insertedAfterTarget &&
      siblingParagraph === targetParagraph &&
      editedTargetIsInsertedFragment
        ? targetTextShift
        : null;
    const expectedShift = growsTarget
      ? targetGrowth
      : insertedBeforeTarget
        ? targetShift
        : insertedAfterTarget
          ? (editedFragmentShift ?? insertedAfterTargetShift)
          : null;
    const afterParagraph = Number(afterRecord.pptxParagraph);
    if (
      expectedShift === null ||
      !flowMarkersMatch ||
      afterParagraph < targetParagraph ||
      (siblingParagraph === targetParagraph &&
        !insertedBeforeTarget &&
        editedFragmentShift === null)
    ) {
      return false;
    }
    return Math.abs(siblingShift - expectedShift) <= GEOMETRY_TOLERANCE;
  };
  const copiedMarkers = copiedMarkerRecords();
  const normalizedOutside = {
    ...outside,
    missing: outside.missing.filter(
      (change) => !copiedMarkers.missing.has(change.key),
    ),
    added: outside.added.filter(
      (change) => !copiedMarkers.added.has(change.key),
    ),
  };
  const changes = [
    ...outside.deltas,
    ...outside.geometry.filter(
      (change) =>
        !followsNaturalReflow(change) &&
        !followsImportedTextObjectReflow(change),
    ),
    ...normalizedOutside.missing,
    ...normalizedOutside.added,
  ].filter((change) => !change.inside);
  return { outside: normalizedOutside, changes };
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
 * slide; null where an operation deletes the slide or a full save leaves it
 * out.
 */
export function slideContentsOf(
  action: string,
  body: any,
  slideId: string,
): Array<string | null> {
  const entries: Array<[unknown, unknown]> =
    action === "patch-deck"
      ? (body.operations ?? []).flatMap((op: any) => {
          if (String(op.slideId) !== slideId) return [];
          if (op.op === "delete-slide") return [[op.slideId, null]];
          if (op.op !== "patch-slide" && op.op !== "add-slide") return [];
          return Object.hasOwn(op.fields ?? {}, "content")
            ? [[op.slideId, op.fields.content]]
            : [];
        })
      : action === "update-slide"
        ? Object.hasOwn(body, "content")
          ? [[body.slideId, body.content]]
          : []
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
  if (!typed) return false;
  const beforeTree = parse(stored.slice(element.start, element.end));
  const afterTree = parse(
    draft.slice(element.start, draft.length - after.length),
  );
  let changedTextNodes = 0;
  const attrsOf = (node: P5.Node) =>
    "attrs" in node
      ? node.attrs
          .map((attr) =>
            JSON.stringify([
              attr.namespace,
              attr.prefix,
              attr.name,
              attr.value,
            ]),
          )
          .sort()
      : [];
  const childrenOf = (node: P5.Node): P5.Node[] => [
    ...("childNodes" in node ? node.childNodes : []),
    ...("content" in node ? node.content.childNodes : []),
  ];
  const sameTree = (a: P5.Node, b: P5.Node): boolean => {
    if (a.nodeName !== b.nodeName) return false;
    for (const prop of [
      "tagName",
      "namespaceURI",
      "prefix",
      "data",
      "name",
      "publicId",
      "systemId",
    ]) {
      if ((a as any)[prop] !== (b as any)[prop]) return false;
    }
    if (JSON.stringify(attrsOf(a)) !== JSON.stringify(attrsOf(b))) return false;
    if (a.nodeName === "#text") {
      if (
        collapse((a as P5.TextNode).value) !==
        collapse((b as P5.TextNode).value)
      ) {
        changedTextNodes++;
      }
    }
    const aChildren = childrenOf(a);
    const bChildren = childrenOf(b);
    return (
      aChildren.length === bChildren.length &&
      aChildren.every((child, i) => sameTree(child, bChildren[i]))
    );
  };
  if (!sameTree(beforeTree, afterTree) || changedTextNodes !== 1) return false;
  const textOf = (node: P5.Node) => collapse(visibleTextOf(node));
  const want = textOf(beforeTree);
  const have = textOf(afterTree);
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
export function restyledAddedText(
  a: Snapshot,
  b: Snapshot,
  startingBlockTag: string | null = null,
): string[] {
  const added = new Set(diffSnapshots(a, b).added.map((r) => r.key));
  const startsInConvertibleBlock =
    /^h[1-6]$/i.test(startingBlockTag ?? "") ||
    startingBlockTag?.toLowerCase() === "li";
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
        !(
          startsInConvertibleBlock &&
          r.tag === "p" &&
          !r.inlineStyle?.trim()
        ) &&
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
