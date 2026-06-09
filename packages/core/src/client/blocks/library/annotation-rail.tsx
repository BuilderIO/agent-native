import { useMemo, type ReactNode } from "react";
import { cn } from "../../utils.js";
import type { BlockRenderContext } from "../types.js";

/**
 * Shared line-anchored annotation UI for the `annotated-code` and `diff` blocks.
 *
 * Both blocks render a numbered code surface plus a side "rail" of notes, where
 * each note targets a 1-based `lines` ref (`"3"` or `"3-5"`) and hovering a code
 * line ↔ its note cross-highlights. This module owns the pure pieces that were
 * identical between them so neither block forks the behavior:
 *
 *  - `parseLineRange` — the forgiving 1-based `lines` range parser.
 *  - `resolveAnnotations` / `buildLineMarkerMap` — turn a raw annotation list
 *    into stable, marker-numbered, range-resolved records and a line→markers map.
 *  - `rangeLabel` — the human "Line 8" / "Lines 3–6" label.
 *  - `AnnotationGutterMarker` — the numbered amber pip placed on an annotated row
 *    (used by the diff grid; the annotated-code surface uses its own rail bar).
 *  - `AnnotationNoteRail` — the responsive list of note cards with two-way hover.
 *    `showMarker` opts the diff block into a leading numbered pip on each card so
 *    a note can be matched to its `①`/`②` row marker; annotated-code omits it to
 *    keep its original card chrome.
 *
 * `AnnotatedCodeBlock` annotates a single code surface; `DiffBlock` annotates a
 * before/after grid (each annotation also carries a `side`). The shared types
 * here are intentionally minimal — callers pass their own `side` handling and
 * decide which rows a marker lands on; this module only owns the parsing, the
 * resolved-record shape, and the rendered marker + rail chrome.
 */

/* ── Line-ref parsing ──────────────────────────────────────────────────────── */

/**
 * Parse a 1-based `lines` ref (`"3"` or `"3-5"`) into an inclusive `[start,end]`
 * pair, clamped to `[1, lineCount]`. Returns `null` for malformed or fully
 * out-of-range refs so callers can ignore them gracefully. A reversed range
 * (`"5-3"`) is normalized; a partially out-of-range range is clamped.
 */
export function parseLineRange(
  ref: string,
  lineCount: number,
): { start: number; end: number } | null {
  const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(ref);
  if (!match) return null;
  let start = Number.parseInt(match[1], 10);
  let end = match[2] != null ? Number.parseInt(match[2], 10) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end) [start, end] = [end, start];
  // Fully outside the file → ignore.
  if (end < 1 || start > lineCount) return null;
  return { start: Math.max(1, start), end: Math.min(lineCount, end) };
}

/** The minimal annotation shape the rail needs (a superset works too). */
export interface RailAnnotation {
  lines: string;
  label?: string;
  note: string;
}

export interface ResolvedAnnotation<A extends RailAnnotation = RailAnnotation> {
  /** Index in the original `annotations` array (stable hover key). */
  index: number;
  /** 1-based marker number (authoring order). */
  marker: number;
  annotation: A;
  range: { start: number; end: number } | null;
}

/**
 * Resolve a raw annotation list into stable, marker-numbered records, parsing
 * each `lines` ref against `lineCount`. `lineCountFor` lets the diff block pick a
 * per-annotation line count (before-side vs after-side); annotated-code passes a
 * single constant. Markers are authoring-order, 1-based, and assigned to ALL
 * annotations (even unresolved ones) so numbering is stable regardless of which
 * refs happen to match.
 */
export function resolveAnnotations<A extends RailAnnotation>(
  annotations: A[] | undefined,
  lineCountFor: (annotation: A) => number,
): ResolvedAnnotation<A>[] {
  return (annotations ?? []).map((annotation, index) => ({
    index,
    marker: index + 1,
    annotation,
    range: parseLineRange(annotation.lines, lineCountFor(annotation)),
  }));
}

/** Map a 1-based line number → the resolved annotations covering it. */
export function buildLineMarkerMap<A extends RailAnnotation>(
  resolved: ResolvedAnnotation<A>[],
): Map<number, ResolvedAnnotation<A>[]> {
  const map = new Map<number, ResolvedAnnotation<A>[]>();
  for (const item of resolved) {
    if (!item.range) continue;
    for (let n = item.range.start; n <= item.range.end; n += 1) {
      const list = map.get(n) ?? [];
      list.push(item);
      map.set(n, list);
    }
  }
  return map;
}

/** Human label for a resolved annotation's line span ("Line 8" / "Lines 3–6"). */
export function rangeLabel(item: ResolvedAnnotation): string {
  if (!item.range) return `Lines ${item.annotation.lines}`;
  return item.range.start === item.range.end
    ? `Line ${item.range.start}`
    : `Lines ${item.range.start}–${item.range.end}`;
}

/* ── Marker ────────────────────────────────────────────────────────────────── */

/**
 * The numbered amber pip rendered on an annotated code row's gutter. `active`
 * brightens it when its note (or a co-located row) is hovered.
 */
export function AnnotationGutterMarker({
  marker,
  active,
  className,
}: {
  marker: number;
  active: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-[15px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none tabular-nums transition-colors",
        active
          ? "bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950"
          : "bg-amber-400/25 text-amber-700 dark:bg-amber-300/20 dark:text-amber-300",
        className,
      )}
    >
      {marker}
    </span>
  );
}

/* ── Note rail ─────────────────────────────────────────────────────────────── */

/**
 * The responsive list of line-anchored note cards. Each card shows its marker
 * pip, the resolved line span ("Line 8"), an optional label, and the markdown
 * `note` (via `ctx.renderMarkdown`). Hovering a card sets the active index;
 * `activeIndex` driven from outside lets a hovered code row light its card and
 * vice-versa. Only annotations whose `range` resolved are listed.
 */
export function AnnotationNoteRail<A extends RailAnnotation>({
  items,
  activeIndex,
  onActiveChange,
  ctx,
  className,
  showMarker = false,
}: {
  items: ResolvedAnnotation<A>[];
  activeIndex: number | null;
  onActiveChange: (index: number | null) => void;
  ctx: BlockRenderContext;
  className?: string;
  /** Show a leading numbered pip on each card (diff block). */
  showMarker?: boolean;
}) {
  const sideAnnotations = useMemo(
    () => items.filter((item) => item.range),
    [items],
  );
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {sideAnnotations.map((item) => {
        const isActive = activeIndex === item.index;
        return (
          <div
            key={item.index}
            onMouseEnter={() => onActiveChange(item.index)}
            onMouseLeave={() => onActiveChange(null)}
            className={cn(
              "rounded-lg border px-3.5 py-2.5 transition-colors",
              isActive
                ? "border-amber-400/70 bg-amber-50 dark:border-amber-300/40 dark:bg-amber-300/[0.08]"
                : "border-plan-line bg-plan-block/40 hover:border-amber-400/50",
            )}
          >
            <div
              className={cn(
                "flex flex-wrap gap-x-2 gap-y-0.5",
                showMarker ? "items-center" : "items-baseline",
              )}
            >
              {showMarker && (
                <AnnotationGutterMarker
                  marker={item.marker}
                  active={isActive}
                />
              )}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-plan-muted">
                {rangeLabel(item)}
              </span>
              {item.annotation.label && (
                <span className="text-[13px] font-semibold text-plan-text">
                  {item.annotation.label}
                </span>
              )}
            </div>
            <div className="plan-annotation-note mt-1 text-[13px] leading-relaxed text-plan-text/85">
              {ctx.renderMarkdown ? (
                ctx.renderMarkdown(item.annotation.note)
              ) : (
                <p>{item.annotation.note}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Whether a resolved list has at least one note worth rendering a rail for. */
export function hasRailAnnotations(items: ResolvedAnnotation[]): boolean {
  return items.some((item) => item.range);
}

export type AnnotationRailChildren = ReactNode;
