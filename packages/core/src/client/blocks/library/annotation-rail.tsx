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
import { ltrCodeBlockProps } from "../code-block-direction.js";
import type { BlockRenderContext } from "../types.js";



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
  if (end < 1 || start > lineCount) return null;
  return { start: Math.max(1, start), end: Math.min(lineCount, end) };
}

export interface RailAnnotation {
  lines: string;
  label?: string;
  note: string;
}

export interface ResolvedAnnotation<A extends RailAnnotation = RailAnnotation> {
  index: number;
  marker: number;
  annotation: A;
  range: { start: number; end: number } | null;
}

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

export function rangeLabel(item: ResolvedAnnotation): string {
  if (!item.range) return `Lines ${item.annotation.lines}`;
  return item.range.start === item.range.end
    ? `Line ${item.range.start}`
    : `Lines ${item.range.start}–${item.range.end}`;
}


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
          ? "bg-yellow-400 text-yellow-950 dark:bg-yellow-300 dark:text-yellow-950"
          : "bg-yellow-300/25 text-yellow-800 dark:bg-yellow-300/16 dark:text-yellow-200",
        className,
      )}
    >
      {marker}
    </span>
  );
}


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
      {...ltrCodeBlockProps}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "rounded-lg border px-3.5 py-2.5 shadow-lg shadow-black/10 backdrop-blur-xl transition-colors dark:shadow-black/40",
        active
          ? "border-yellow-300/55 bg-yellow-50/80 dark:border-yellow-200/25 dark:bg-yellow-300/[0.10]"
          : "border-plan-line bg-plan-block hover:border-yellow-300/45",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-wrap gap-x-2 gap-y-1",
          showMarker ? "items-center" : "items-baseline",
        )}
      >
        {showMarker && (
          <AnnotationGutterMarker marker={item.marker} active={active} />
        )}
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-plan-muted">
          {rangeLabel(item)}
        </span>
        {item.annotation.label && (
          <span className="min-w-0 max-w-full flex-1 break-words text-[13px] font-semibold leading-snug text-plan-text [overflow-wrap:anywhere]">
            {item.annotation.label}
          </span>
        )}
      </div>
      <div className="plan-annotation-note mt-1 break-words text-[13px] leading-relaxed text-plan-text/85 [overflow-wrap:anywhere]">
        {ctx.renderMarkdown ? (
          ctx.renderMarkdown(item.annotation.note)
        ) : (
          <p>{item.annotation.note}</p>
        )}
      </div>
    </div>
  );
}

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
    | { kind: "capture"; top: number; left: number; visible: boolean }
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
      const scroll = {
        x: window.scrollX || window.pageXOffset || 0,
        y: window.scrollY || window.pageYOffset || 0,
      };
      setPosition({
        kind: "capture",
        visible: Boolean(portalRect && portalRect.height > 0),
        ...resolveAnnotationCaptureOverlayPosition(
          {
            right: anchorRect.right,
            top: anchorRect.top,
            height: anchorRect.height,
          },
          { width, height },
          { width: viewportWidth, height: viewportHeight },
          scroll,
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
          left:
            position && position.kind === "capture"
              ? position.left
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
            className={cn(
              "pointer-events-none z-50 flex w-[min(20rem,45vw)] flex-col gap-2",
              mode === "capture" ? "absolute" : "fixed",
            )}
            style={portalStyle}
          >
            {resolved.map((item) => (
              <AnnotationCard
                key={item.index}
                item={item}
                ctx={ctx}
                active
                showMarker={showMarker}
                className="border-yellow-300/55 bg-yellow-50/80 shadow-lg shadow-black/10 backdrop-blur-xl dark:border-yellow-200/25 dark:bg-yellow-300/[0.10] dark:shadow-black/50"
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


export interface AnnotationAnchor {
  codeRight: number;
  codeLeft: number;
  lineCenter: number;
  lineBottom: number;
}

export type AnnotationSide = "left" | "right";
export type AnnotationMarginSide = AnnotationSide | "auto";

const HOVER_CARD_WIDTH = 280;
const INLINE_OVERLAY_WIDTH = 320;
const HOVER_CARD_GAP = 12;
const HOVER_CARD_OVERHANG = 40;
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

function hoverCardOverlapLeftForSide(
  side: AnnotationSide,
  anchor: AnnotationAnchor,
  cardWidth: number,
): number {
  return side === "right"
    ? anchor.codeRight - cardWidth + HOVER_CARD_OVERHANG
    : anchor.codeLeft - HOVER_CARD_OVERHANG;
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

export function resolveAnnotationCaptureOverlayPosition(
  anchor: { right: number; top: number; height: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  scroll: { x: number; y: number } = { x: 0, y: 0 },
): { top: number; left: number } {
  const { right } = resolveAnnotationInlineOverlayPosition(
    anchor,
    card,
    viewport,
  );
  const left = scroll.x + viewport.width - right - card.width;
  const rawTop = anchor.top + anchor.height / 2 - card.height / 2;
  return {
    top: Math.max(scroll.y + VIEWPORT_MARGIN, scroll.y + rawTop),
    left,
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
  const hoverFallbackSide = options.hoverFallbackSide ?? "right";
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
    left = hoverCardOverlapLeftForSide(hoverFallbackSide, anchor, card.width);
    top = anchor.lineCenter - card.height / 2;
  } else {
    left = anchor.codeLeft;
    top = anchor.lineBottom + HOVER_CARD_GAP;
  }

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
  onInteractOutside,
}: {
  item: ResolvedAnnotation<A>;
  anchor: AnnotationAnchor;
  ctx: BlockRenderContext;
  showMarker?: boolean;
  preferredSide?: AnnotationSide;
  hoverFallbackSide?: AnnotationSide | "below";
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClose?: () => void;
  onInteractOutside?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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
    window.addEventListener("resize", handler, { passive: true });
    return () => {
      window.removeEventListener("scroll", handler, { capture: true });
      window.removeEventListener("resize", handler);
    };
  }, [onClose]);

  useEffect(() => {
    const closeOutside = onInteractOutside ?? onClose;
    if (!closeOutside || typeof window === "undefined") return;
    const handler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest("[data-code-line],[data-annotated-code-marker]")
      ) {
        return;
      }
      closeOutside();
    };
    window.addEventListener("pointerdown", handler, { capture: true });
    window.addEventListener("focusin", handler, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", handler, { capture: true });
      window.removeEventListener("focusin", handler, { capture: true });
    };
  }, [onClose, onInteractOutside]);

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
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <AnnotationCard
        item={item}
        ctx={ctx}
        active
        showMarker={showMarker}
        className="shadow-lg shadow-black/10 backdrop-blur-md dark:shadow-black/40"
      />
    </div>,
    document.body,
  );
}

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

export function hasRailAnnotations(items: ResolvedAnnotation[]): boolean {
  return items.some((item) => item.range);
}

export type AnnotationRailChildren = ReactNode;
