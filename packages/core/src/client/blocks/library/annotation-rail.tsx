import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

/* ── Note card ─────────────────────────────────────────────────────────────── */

/**
 * One line-anchored note card: marker pip (when `showMarker`), the resolved line
 * span ("Line 8"), an optional label, and the markdown `note` (via
 * `ctx.renderMarkdown`). This is the single source of card markup, rendered both
 * by the visually-hidden a11y/test stack and by the on-hover portal popover.
 */
export function AnnotationCard<A extends RailAnnotation>({
  item,
  ctx,
  active = false,
  showMarker = false,
  className,
  onMouseEnter,
  onMouseLeave,
}: {
  item: ResolvedAnnotation<A>;
  ctx: BlockRenderContext;
  active?: boolean;
  showMarker?: boolean;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "rounded-lg border px-3.5 py-2.5 transition-colors",
        active
          ? "border-amber-400/70 bg-amber-50 dark:border-amber-300/40 dark:bg-amber-300/[0.08]"
          : "border-plan-line bg-plan-block/40 hover:border-amber-400/50",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap gap-x-2 gap-y-0.5",
          showMarker ? "items-center" : "items-baseline",
        )}
      >
        {showMarker && (
          <AnnotationGutterMarker marker={item.marker} active={active} />
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
}

/**
 * Visually-hidden stack of every resolved note. It is NOT a visible column — it
 * sits in the flow but clipped to a 1px box (the `sr-only` pattern) so the note
 * text and the per-card marker pips stay in the accessibility tree and in the
 * DOM (assistive tech can reach them, and tests that read `textContent`/count
 * pips still see them) WITHOUT painting a persistent rail beside the code. The
 * visible card appears only on hover via {@link AnnotationHoverCard}.
 */
export function AnnotationHiddenStack<A extends RailAnnotation>({
  items,
  ctx,
  showMarker = false,
}: {
  items: ResolvedAnnotation<A>[];
  ctx: BlockRenderContext;
  showMarker?: boolean;
}) {
  const resolved = useMemo(() => items.filter((item) => item.range), [items]);
  if (resolved.length === 0) return null;
  return (
    <div
      className="absolute size-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)] [clip-path:inset(50%)]"
      data-annotation-hidden-stack
    >
      {resolved.map((item) => (
        <AnnotationCard
          key={item.index}
          item={item}
          ctx={ctx}
          showMarker={showMarker}
        />
      ))}
    </div>
  );
}

export function AnnotationInlineOverlayStack<A extends RailAnnotation>({
  items,
  ctx,
  showMarker = false,
  containerRef,
  mode = "capture",
  side = "right",
  preferredSide = "right",
}: {
  items: ResolvedAnnotation<A>[];
  ctx: BlockRenderContext;
  showMarker?: boolean;
  containerRef?: RefObject<HTMLElement | null>;
  mode?: "capture" | "margin";
  side?: AnnotationMarginSide;
  preferredSide?: AnnotationSide;
}) {
  const resolved = items.filter((item) => item.range);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<
    | { kind: "capture"; top: number; right: number; visible: boolean }
    | {
        kind: "margin";
        top: number;
        left: number;
        visible: boolean;
        side: AnnotationSide;
      }
    | null
  >(null);
  const positionKey = resolved
    .map(
      (item) =>
        `${item.index}:${item.marker}:${item.annotation.lines}:${item.annotation.label ?? ""}:${item.annotation.note}`,
    )
    .join("|");

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    let frame: number | null = null;
    const updatePosition = () => {
      frame = null;
      const anchorRect = anchor.getBoundingClientRect();
      const portalRect = portalRef.current?.getBoundingClientRect();
      const viewportWidth = Math.max(
        window.innerWidth || 0,
        INLINE_OVERLAY_WIDTH + VIEWPORT_MARGIN * 2,
      );
      const viewportHeight = Math.max(
        window.innerHeight || 0,
        VIEWPORT_MARGIN * 2,
      );
      const width =
        portalRect && portalRect.width > 0
          ? portalRect.width
          : Math.min(INLINE_OVERLAY_WIDTH, viewportWidth * 0.45);
      const height =
        portalRect && portalRect.height > 0 ? portalRect.height : 0;
      if (mode === "margin") {
        const containerRect =
          containerRef?.current?.getBoundingClientRect() ?? anchorRect;
        const next = resolveAnnotationMarginOverlayPosition(
          {
            left: containerRect.left,
            right: containerRect.right,
            top: anchorRect.top,
            height: anchorRect.height,
          },
          { width, height },
          { width: viewportWidth, height: viewportHeight },
          { side, preferredSide },
        );
        setPosition({ kind: "margin", ...next });
        return;
      }
      setPosition({
        kind: "capture",
        visible: true,
        ...resolveAnnotationInlineOverlayPosition(
          {
            right: anchorRect.right,
            top: anchorRect.top,
            height: anchorRect.height,
          },
          { width, height },
          { width: viewportWidth, height: viewportHeight },
        ),
      });
    };
    const scheduleUpdatePosition = () => {
      if (frame != null) return;
      if (typeof window.requestAnimationFrame === "function") {
        frame = window.requestAnimationFrame(updatePosition);
        return;
      }
      updatePosition();
    };

    updatePosition();
    scheduleUpdatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", scheduleUpdatePosition, {
      capture: true,
      passive: true,
    });
    return () => {
      if (frame != null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", scheduleUpdatePosition, {
        capture: true,
      });
    };
  }, [containerRef, mode, positionKey, preferredSide, side]);

  if (resolved.length === 0) return null;

  const portalStyle: CSSProperties =
    position?.kind === "margin"
      ? {
          top: position.top,
          left: position.left,
          visibility:
            position.visible && position
              ? ("visible" as const)
              : ("hidden" as const),
        }
      : {
          top: position?.top ?? VIEWPORT_MARGIN,
          right:
            position && position.kind === "capture"
              ? position.right
              : VIEWPORT_MARGIN,
          visibility:
            position?.kind === "capture" && position.visible
              ? ("visible" as const)
              : ("hidden" as const),
        };

  const portal =
    typeof document === "undefined"
      ? null
      : createPortal(
          <div
            aria-hidden
            ref={portalRef}
            data-annotation-inline-overlay
            data-annotation-inline-overlay-mode={mode}
            data-annotation-inline-overlay-side={
              position?.kind === "margin" ? position.side : "right"
            }
            className="pointer-events-none fixed z-50 flex w-[min(20rem,45vw)] flex-col gap-2"
            style={portalStyle}
          >
            {resolved.map((item) => (
              <AnnotationCard
                key={item.index}
                item={item}
                ctx={ctx}
                active
                showMarker={showMarker}
                className="border-amber-400/80 bg-amber-50/95 shadow-lg shadow-black/10 dark:border-amber-300/45 dark:bg-amber-300/[0.09] dark:shadow-black/40"
              />
            ))}
          </div>,
          document.body,
        );

  return (
    <>
      <div
        aria-hidden
        ref={anchorRef}
        data-annotation-inline-overlay-anchor
        className="pointer-events-none absolute right-3 top-0 z-20 h-0 w-0 overflow-visible"
      />
      {portal}
    </>
  );
}

/* ── Hover popover (portal, anchored beside the code) ──────────────────────── */

/** The geometry the hover card anchors to (in viewport coordinates). */
export interface AnnotationAnchor {
  /** Right edge of the code block (where the card should start). */
  codeRight: number;
  /** Left edge of the code block (for the below-fallback alignment). */
  codeLeft: number;
  /** Vertical center of the hovered line. */
  lineCenter: number;
  /** Bottom of the hovered line (for the below-fallback placement). */
  lineBottom: number;
}

export type AnnotationSide = "left" | "right";
export type AnnotationMarginSide = AnnotationSide | "auto";

const HOVER_CARD_WIDTH = 280;
const INLINE_OVERLAY_WIDTH = 320;
const HOVER_CARD_GAP = 12;
const VIEWPORT_MARGIN = 8;
const SCROLL_HOVER_SUPPRESS_MS = 260;

function oppositeSide(side: AnnotationSide): AnnotationSide {
  return side === "left" ? "right" : "left";
}

function clampWithinViewport(
  value: number,
  size: number,
  viewportSize: number,
): number {
  return Math.max(
    VIEWPORT_MARGIN,
    Math.min(value, viewportSize - size - VIEWPORT_MARGIN),
  );
}

function centeredTop(
  anchor: { top: number; height: number },
  cardHeight: number,
  viewportHeight: number,
): number {
  const maxTop = Math.max(
    VIEWPORT_MARGIN,
    viewportHeight - cardHeight - VIEWPORT_MARGIN,
  );
  const raw = anchor.top + anchor.height / 2 - cardHeight / 2;
  return Math.max(VIEWPORT_MARGIN, Math.min(raw, maxTop));
}

function inlineOverlayWidthForViewport(viewportWidth: number): number {
  return Math.min(INLINE_OVERLAY_WIDTH, Math.max(0, viewportWidth * 0.45));
}

function hoverCardLeftForSide(
  side: AnnotationSide,
  anchor: AnnotationAnchor,
  cardWidth: number,
): number {
  return side === "right"
    ? anchor.codeRight + HOVER_CARD_GAP
    : anchor.codeLeft - HOVER_CARD_GAP - cardWidth;
}

function hoverCardFitsSide(
  side: AnnotationSide,
  anchor: AnnotationAnchor,
  cardWidth: number,
  viewportWidth: number,
): boolean {
  const left = hoverCardLeftForSide(side, anchor, cardWidth);
  return (
    left >= VIEWPORT_MARGIN &&
    left + cardWidth + VIEWPORT_MARGIN <= viewportWidth
  );
}

export function resolveAnnotationInlineOverlayPosition(
  anchor: { right: number; top: number; height: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; right: number } {
  const maxRight = Math.max(
    VIEWPORT_MARGIN,
    viewport.width - card.width - VIEWPORT_MARGIN,
  );

  return {
    top: centeredTop(anchor, card.height, viewport.height),
    right: Math.max(
      VIEWPORT_MARGIN,
      Math.min(viewport.width - anchor.right, maxRight),
    ),
  };
}

export function resolveAnnotationMarginOverlayPosition(
  anchor: { left: number; right: number; top: number; height: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  options: {
    side?: AnnotationMarginSide;
    preferredSide?: AnnotationSide;
  } = {},
): { top: number; left: number; visible: boolean; side: AnnotationSide } {
  const preferredSide = options.preferredSide ?? "left";
  const requestedSide = options.side ?? preferredSide;
  const sides: AnnotationSide[] =
    requestedSide === "auto"
      ? [preferredSide, oppositeSide(preferredSide)]
      : [requestedSide];
  const top = centeredTop(anchor, card.height, viewport.height);

  for (const candidate of sides) {
    const left =
      candidate === "left"
        ? anchor.left - HOVER_CARD_GAP - card.width
        : anchor.right + HOVER_CARD_GAP;
    const fits =
      left >= VIEWPORT_MARGIN &&
      left + card.width + VIEWPORT_MARGIN <= viewport.width;
    if (fits) return { top, left, visible: true, side: candidate };
  }

  const fallbackSide = requestedSide === "auto" ? preferredSide : requestedSide;
  const fallbackLeft =
    fallbackSide === "left"
      ? anchor.left - HOVER_CARD_GAP - card.width
      : anchor.right + HOVER_CARD_GAP;
  return {
    top,
    left: clampWithinViewport(fallbackLeft, card.width, viewport.width),
    visible: false,
    side: fallbackSide,
  };
}

export function resolveAnnotationHoverCardPosition(
  anchor: AnnotationAnchor,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  options: {
    preferredSide?: AnnotationSide;
    hoverFallbackSide?: AnnotationSide | "below";
    allowOppositeSideFallback?: boolean;
  } = {},
): { top: number; left: number } {
  const preferredSide = options.preferredSide ?? "right";
  const hoverFallbackSide = options.hoverFallbackSide ?? "below";
  const allowOppositeSideFallback = options.allowOppositeSideFallback ?? true;
  const opposite = oppositeSide(preferredSide);

  let left: number;
  let top: number;
  if (hoverCardFitsSide(preferredSide, anchor, card.width, viewport.width)) {
    left = hoverCardLeftForSide(preferredSide, anchor, card.width);
    top = anchor.lineCenter - card.height / 2;
  } else if (
    allowOppositeSideFallback &&
    hoverCardFitsSide(opposite, anchor, card.width, viewport.width)
  ) {
    left = hoverCardLeftForSide(opposite, anchor, card.width);
    top = anchor.lineCenter - card.height / 2;
  } else if (hoverFallbackSide === "left" || hoverFallbackSide === "right") {
    left = hoverCardLeftForSide(hoverFallbackSide, anchor, card.width);
    top = anchor.lineCenter - card.height / 2;
  } else {
    // No clean side gutter → drop below the line, aligned to the code's left.
    left = anchor.codeLeft;
    top = anchor.lineBottom + HOVER_CARD_GAP;
  }

  // Clamp within the viewport so the card is never cut off.
  left = clampWithinViewport(left, card.width, viewport.width);
  top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(top, viewport.height - card.height - VIEWPORT_MARGIN),
  );

  return { top, left };
}

export function useAnnotationMarginNotesAvailable({
  containerRef,
  enabled,
  side = "auto",
  preferredSide = "left",
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  side?: AnnotationMarginSide;
  preferredSide?: AnnotationSide;
}) {
  const [available, setAvailable] = useState(false);

  useLayoutEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setAvailable(false);
      return;
    }

    const update = () => {
      const element = containerRef.current;
      if (!element) {
        setAvailable(false);
        return;
      }
      const rect = element.getBoundingClientRect();
      const viewportWidth = Math.max(window.innerWidth || 0, 0);
      const cardWidth = inlineOverlayWidthForViewport(viewportWidth);
      const leftFits =
        rect.left - HOVER_CARD_GAP - cardWidth >= VIEWPORT_MARGIN;
      const rightFits =
        rect.right + HOVER_CARD_GAP + cardWidth + VIEWPORT_MARGIN <=
        viewportWidth;
      const next =
        side === "left"
          ? leftFits
          : side === "right"
            ? rightFits
            : preferredSide === "left"
              ? leftFits || rightFits
              : rightFits || leftFits;
      setAvailable(next);
    };

    update();
    const frame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(update)
        : null;
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (containerRef.current && observer)
      observer.observe(containerRef.current);
    window.addEventListener("resize", update);
    return () => {
      if (frame != null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [containerRef, enabled, preferredSide, side]);

  return available;
}

/**
 * The single on-hover note card, portaled to `document.body` and positioned
 * `fixed` so it escapes the code block's `overflow` and never reflows the code.
 *
 * Placement: by default it sits to the RIGHT of the code block's right edge,
 * vertically centered on the hovered line — so it never overlaps the code text.
 * If there isn't room to the right, it uses the LEFT of the code block when the
 * card can fit there without covering code. Only when neither side fits does it
 * fall back to BELOW the hovered line (left-aligned to the code block). The card
 * keeps itself open while hovered (`onMouseEnter`/`onMouseLeave` forwarded) so
 * it stays readable; the caller adds the small hover-intent close delay.
 */
export function AnnotationHoverCard<A extends RailAnnotation>({
  item,
  anchor,
  ctx,
  showMarker = false,
  preferredSide,
  hoverFallbackSide,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: {
  item: ResolvedAnnotation<A>;
  anchor: AnnotationAnchor;
  ctx: BlockRenderContext;
  showMarker?: boolean;
  preferredSide?: AnnotationSide;
  hoverFallbackSide?: AnnotationSide | "below";
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Called when the card should be dismissed (e.g. on scroll). */
  onClose?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure the rendered card, then resolve a non-overlapping position: right of
  // the code if it fits, then left if that side has a clean gutter, otherwise
  // below the line.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const el = cardRef.current;
    const rect = el?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : HOVER_CARD_WIDTH;
    const height = rect && rect.height > 0 ? rect.height : 0;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    setPos(
      resolveAnnotationHoverCardPosition(
        anchor,
        { width, height },
        { width: vw, height: vh },
        { preferredSide, hoverFallbackSide },
      ),
    );
  }, [
    anchor.codeRight,
    anchor.codeLeft,
    anchor.lineCenter,
    anchor.lineBottom,
    hoverFallbackSide,
    item.index,
    preferredSide,
  ]);

  // Close the card when the user scrolls so it doesn't float detached. Scrolls
  // inside a long hover card are local to the card and should not dismiss it.
  useEffect(() => {
    if (!onClose || typeof window === "undefined") return;
    const handler = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        cardRef.current &&
        cardRef.current.contains(target)
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("scroll", handler, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", handler, { capture: true });
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      data-annotation-hover-card
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto fixed z-50 overflow-y-auto overscroll-contain"
      style={{
        top: pos?.top ?? anchor.lineCenter,
        left: pos?.left ?? anchor.codeRight + HOVER_CARD_GAP,
        width: HOVER_CARD_WIDTH,
        maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
        // Hide until measured to avoid a one-frame jump from the fallback spot.
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <AnnotationCard
        item={item}
        ctx={ctx}
        active
        showMarker={showMarker}
        className="shadow-lg shadow-black/10 dark:shadow-black/40"
      />
    </div>,
    document.body,
  );
}

/**
 * Hover-intent + tap controller for the on-hover note card. Exposes
 * `activeIndex` + the captured `anchor`, plus `open`/`toggle`/`close`/
 * `scheduleClose`/`cancelClose` handlers.
 *
 *  - `open(index, anchor)` shows a card immediately (cancels any pending close).
 *  - `toggle(index, anchor)` opens a card if it isn't already the active one,
 *    or closes it if it is — used for click/tap on annotated rows so touch users
 *    can access notes without hover.
 *  - `close()` hides the card immediately (used on scroll to avoid stale cards).
 *  - `scheduleClose()` hides after a short delay, so moving the pointer from the
 *    code line across the gap into the card itself keeps it open.
 *  - `cancelClose()` (call on card mouse-enter) keeps it open while reading.
 */
export function useAnnotationHover(delay = 130) {
  const [active, setActive] = useState<{
    index: number;
    anchor: AnnotationAnchor;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressHoverUntil = useRef(0);

  const cancelClose = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const open = (index: number, anchor: AnnotationAnchor) => {
    if (Date.now() < suppressHoverUntil.current) return;
    cancelClose();
    setActive({ index, anchor });
  };
  const toggle = (index: number, anchor: AnnotationAnchor) => {
    cancelClose();
    setActive((prev) => (prev?.index === index ? null : { index, anchor }));
  };
  const close = () => {
    cancelClose();
    setActive(null);
  };
  const closeForScroll = () => {
    suppressHoverUntil.current = Date.now() + SCROLL_HOVER_SUPPRESS_MS;
    close();
  };
  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => setActive(null), delay);
  };

  useEffect(() => () => cancelClose(), []);

  return {
    activeIndex: active?.index ?? null,
    anchor: active?.anchor ?? null,
    open,
    toggle,
    close,
    closeForScroll,
    scheduleClose,
    cancelClose,
  } as const;
}

/**
 * Build an {@link AnnotationAnchor} from the code block element and the hovered
 * row element. The card anchors to the code block's RIGHT edge and the row's
 * vertical center, both in viewport coordinates (so a `fixed` portal lines up).
 */
export function anchorFromElements(
  codeEl: HTMLElement | null,
  rowEl: HTMLElement | null,
): AnnotationAnchor | null {
  if (!codeEl || !rowEl) return null;
  const code = codeEl.getBoundingClientRect();
  const row = rowEl.getBoundingClientRect();
  return {
    codeRight: code.right,
    codeLeft: code.left,
    lineCenter: row.top + row.height / 2,
    lineBottom: row.bottom,
  };
}

/**
 * The responsive list of line-anchored note cards. Each card shows its marker
 * pip, the resolved line span ("Line 8"), an optional label, and the markdown
 * `note` (via `ctx.renderMarkdown`). Hovering a card sets the active index;
 * `activeIndex` driven from outside lets a hovered code row light its card and
 * vice-versa. Only annotations whose `range` resolved are listed.
 *
 * @deprecated Superseded by the on-hover {@link AnnotationHoverCard}; kept for
 * back-compat with any external importer. Both block read renderers now use the
 * hover popover anchored to the right of the code instead of a persistent rail.
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
      {sideAnnotations.map((item) => (
        <AnnotationCard
          key={item.index}
          item={item}
          ctx={ctx}
          active={activeIndex === item.index}
          showMarker={showMarker}
          onMouseEnter={() => onActiveChange(item.index)}
          onMouseLeave={() => onActiveChange(null)}
        />
      ))}
    </div>
  );
}

/** Whether a resolved list has at least one note worth rendering a rail for. */
export function hasRailAnnotations(items: ResolvedAnnotation[]): boolean {
  return items.some((item) => item.range);
}

export type AnnotationRailChildren = ReactNode;
