import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import type {
  CSSProperties,
  FocusEvent,
  MouseEventHandler,
  PointerEvent,
  ReactNode,
  TransitionEvent,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import "./recording-playhead.css";

const SEGMENT_MS = 180;
const HOVER_INTENT_MS = 150;

export type RecordingPlayheadIntent = "delete" | "restart";

export type RecordingPlayheadConfirmChange =
  | {
      type: "open";
      intent: RecordingPlayheadIntent;
      enteredPaused: boolean;
    }
  | {
      type: "close";
      intent: RecordingPlayheadIntent;
      enteredPaused: boolean;
      resume: boolean;
    };

export type RecordingPlayheadLayout = {
  width: number;
  height: number;
};

export interface RecordingPlayheadLabels {
  controls: string;
  stop: string;
  pause: string;
  resume: string;
  pauseShortcut: string;
  resumeShortcut: string;
  restart: string;
  restartShortcut: string;
  delete: string;
  deleteShortcut: string;
  restartQuestion: string;
  deleteQuestion: (elapsedMs: number) => string;
  restartConfirm: string;
  deleteConfirm: string;
  resumeConfirm: string;
}

export interface RecordingPlayheadProps {
  elapsedMs: number;
  paused: boolean;
  enabled?: boolean;
  pendingAction?: RecordingPlayheadIntent | "cancel" | null;
  /** Capture-specific level transport; the visual slot remains shared. */
  meter: ReactNode;
  labels: RecordingPlayheadLabels;
  confirmRequest?: {
    intent: RecordingPlayheadIntent;
    token: number;
  } | null;
  onStop: () => void;
  onTogglePause: () => void;
  onConfirmAction: (intent: RecordingPlayheadIntent) => void;
  onDeleteRequest?: () => void;
  onConfirmChange?: (change: RecordingPlayheadConfirmChange) => void;
  onLayoutChange?: (layout: RecordingPlayheadLayout) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
}

type Segment = "mid" | "q" | "del" | "res" | "extras";

const SEGMENTS: Segment[] = ["mid", "q", "del", "res", "extras"];

function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const totalMinutes = Math.floor(total / 60);
  if (totalMinutes >= 100) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${minutes.toString().padStart(2, "0")}h`;
  }
  return `${totalMinutes}:${(total % 60).toString().padStart(2, "0")}`;
}

export function RecordingPlayhead({
  elapsedMs,
  paused,
  enabled = true,
  pendingAction = null,
  meter,
  labels,
  confirmRequest = null,
  onStop,
  onTogglePause,
  onConfirmAction,
  onDeleteRequest,
  onConfirmChange,
  onLayoutChange,
  onExpandedChange,
  onMouseDown,
  className,
  style,
}: RecordingPlayheadProps) {
  const [confirmIntent, setConfirmIntent] =
    useState<RecordingPlayheadIntent | null>(null);
  const [expanded, setExpanded] = useState(false);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Record<Segment, HTMLSpanElement | null>>({
    mid: null,
    q: null,
    del: null,
    res: null,
    extras: null,
  });
  const pausedRef = useRef(paused);
  const confirmFromPausedRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(false);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const onExpandedChangeRef = useRef(onExpandedChange);
  const settleBatchRef = useRef(0);
  const layoutTransitionPendingRef = useRef(false);
  const pendingSegmentsRef = useRef<Set<Segment>>(new Set());
  const finishSettleRef = useRef<(() => void) | null>(null);
  const transitionSegmentsRef = useRef<
    (changes: Array<[Segment, boolean, number]>) => void
  >(() => {});
  const lastConfirmRequestRef = useRef(0);
  const openSegmentsRef = useRef<Record<Segment, boolean>>({
    mid: true,
    q: false,
    del: false,
    res: false,
    extras: false,
  });

  pausedRef.current = paused;
  onLayoutChangeRef.current = onLayoutChange;
  onExpandedChangeRef.current = onExpandedChange;

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  const reportLayout = useCallback(() => {
    if (layoutTransitionPendingRef.current) return;
    const el = playheadRef.current;
    if (!el) return;
    onLayoutChangeRef.current?.({
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
  }, []);

  useLayoutEffect(() => {
    reportLayout();
    const el = playheadRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reportLayout);
    observer.observe(el);
    return () => observer.disconnect();
  }, [reportLayout]);

  function segmentInnerWidth(segment: Segment): number {
    const el = segmentRefs.current[segment];
    const inner = el?.firstElementChild as HTMLElement | null;
    return inner ? Math.ceil(inner.getBoundingClientRect().width) : 0;
  }

  function segmentCurrentWidth(segment: Segment): number {
    return segmentRefs.current[segment]?.getBoundingClientRect().width ?? 0;
  }

  function setSegment(segment: Segment, open: boolean, delayMs = 0) {
    const el = segmentRefs.current[segment];
    if (!el) return;
    // A segment that starts at `auto` cannot animate from a number. Snap it to
    // its measured width first, just as the desktop overlay does.
    if (!open && (!el.style.width || el.style.width === "auto")) {
      el.style.transition = "none";
      el.style.width = `${segmentCurrentWidth(segment)}px`;
      void el.offsetWidth;
    }
    const reduced = reducedMotionRef.current;
    el.style.transition = reduced
      ? "none"
      : `width ${SEGMENT_MS}ms var(--playhead-ease), opacity ${SEGMENT_MS}ms ease`;
    el.style.transitionDelay = reduced ? "0ms" : `${delayMs}ms`;
    el.style.width = open ? `${segmentInnerWidth(segment)}px` : "0px";
    el.style.opacity = open ? "1" : "0";
  }

  function transitionSegments(changes: Array<[Segment, boolean, number]>) {
    const playhead = playheadRef.current;
    if (!playhead) return;
    for (const [segment, open] of changes) {
      openSegmentsRef.current[segment] = open;
    }

    const playheadWidth = playhead.getBoundingClientRect().width;
    const currentSegmentsWidth = SEGMENTS.reduce(
      (sum, segment) => sum + segmentCurrentWidth(segment),
      0,
    );
    const staticWidth = playheadWidth - currentSegmentsWidth;
    const targetWidth = SEGMENTS.reduce(
      (sum, segment) =>
        sum +
        (openSegmentsRef.current[segment] ? segmentInnerWidth(segment) : 0),
      staticWidth,
    );
    const maxDelay = changes.reduce(
      (max, [, , delay]) => Math.max(max, delay),
      0,
    );
    const settleMs = reducedMotionRef.current ? 16 : SEGMENT_MS + maxDelay + 40;
    const batch = ++settleBatchRef.current;
    layoutTransitionPendingRef.current = true;

    onLayoutChangeRef.current?.({
      // Give native desktop windows room before the animation starts. The
      // browser ignores this callback and lets the document reflow normally.
      width: Math.ceil(Math.max(playheadWidth, targetWidth)) + 12,
      height: Math.ceil(playhead.getBoundingClientRect().height),
    });

    if (shrinkTimerRef.current) clearTimeout(shrinkTimerRef.current);
    pendingSegmentsRef.current.clear();

    for (const [segment, open, delay] of changes) {
      const before = segmentCurrentWidth(segment);
      setSegment(segment, open, delay);
      const el = segmentRefs.current[segment];
      const after = el ? Number.parseFloat(el.style.width) : before;
      if (!reducedMotionRef.current && Math.abs(after - before) > 0.5) {
        pendingSegmentsRef.current.add(segment);
      }
    }

    const finishSettle = () => {
      if (settleBatchRef.current !== batch) return;
      pendingSegmentsRef.current.clear();
      layoutTransitionPendingRef.current = false;
      reportLayout();
    };
    finishSettleRef.current = finishSettle;
    if (pendingSegmentsRef.current.size === 0) {
      finishSettle();
      return;
    }

    // Transitionend is the normal path. This fallback handles throttled or
    // background browser clocks so the native window cannot remain oversized.
    shrinkTimerRef.current = setTimeout(
      () => {
        if (settleBatchRef.current !== batch) return;
        for (const segment of SEGMENTS) {
          const el = segmentRefs.current[segment];
          if (!el) continue;
          el.style.transition = "none";
          el.style.width = openSegmentsRef.current[segment]
            ? `${segmentInnerWidth(segment)}px`
            : "0px";
          el.style.opacity = openSegmentsRef.current[segment] ? "1" : "0";
        }
        finishSettle();
      },
      Math.max(1_000, settleMs * 3),
    );
  }

  transitionSegmentsRef.current = transitionSegments;

  function handleSegmentTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.propertyName !== "width") return;
    const segment = (Object.keys(segmentRefs.current) as Segment[]).find(
      (key) => segmentRefs.current[key] === event.target,
    );
    if (!segment) return;
    pendingSegmentsRef.current.delete(segment);
    if (pendingSegmentsRef.current.size === 0) {
      if (shrinkTimerRef.current) clearTimeout(shrinkTimerRef.current);
      finishSettleRef.current?.();
    }
  }

  const updateExpanded = useCallback(
    (next: boolean) => {
      if (next === expanded) return;
      setExpanded(next);
      onExpandedChangeRef.current?.(next);
    },
    [expanded],
  );

  const openConfirm = useCallback(
    (intent: RecordingPlayheadIntent) => {
      if (!enabled || confirmIntent) return;
      const enteredPaused = pausedRef.current;
      confirmFromPausedRef.current = enteredPaused;
      updateExpanded(false);
      setConfirmIntent(intent);
      onConfirmChange?.({ type: "open", intent, enteredPaused });
    },
    [confirmIntent, enabled, onConfirmChange, updateExpanded],
  );

  const closeConfirm = useCallback(
    (resume: boolean) => {
      if (!confirmIntent) return;
      const intent = confirmIntent;
      const enteredPaused = confirmFromPausedRef.current;
      setConfirmIntent(null);
      onConfirmChange?.({
        type: "close",
        intent,
        enteredPaused,
        resume,
      });
    },
    [confirmIntent, onConfirmChange],
  );

  function confirmAction() {
    if (!confirmIntent || pendingAction) return;
    const intent = confirmIntent;
    setConfirmIntent(null);
    updateExpanded(false);
    onConfirmAction(intent);
  }

  useLayoutEffect(() => {
    if (confirmIntent) {
      transitionSegmentsRef.current([
        ["extras", false, 0],
        ["mid", false, 0],
        ["q", true, 0],
        ["del", true, 20],
        ["res", true, 40],
      ]);
      return;
    }
    transitionSegmentsRef.current([
      ["res", false, 0],
      ["del", false, 20],
      ["q", false, 40],
      ["mid", true, 40],
      ["extras", expanded, 0],
    ]);
  }, [confirmIntent, expanded]);

  useEffect(() => {
    if (
      !confirmRequest ||
      confirmRequest.token === lastConfirmRequestRef.current
    ) {
      return;
    }
    lastConfirmRequestRef.current = confirmRequest.token;
    openConfirm(confirmRequest.intent);
  }, [confirmRequest, openConfirm]);

  useEffect(() => {
    if (enabled) return;
    updateExpanded(false);
    if (confirmIntent) closeConfirm(false);
  }, [closeConfirm, confirmIntent, enabled, updateExpanded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !confirmIntent) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeConfirm(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeConfirm, confirmIntent]);

  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (shrinkTimerRef.current) clearTimeout(shrinkTimerRef.current);
    },
    [],
  );

  function handleMouseEnter() {
    if ((!enabled && !onDeleteRequest) || confirmIntent) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(
      () => updateExpanded(true),
      HOVER_INTENT_MS,
    );
  }

  function handleMouseLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (!confirmIntent) updateExpanded(false);
  }

  function handleFocusCapture() {
    if ((enabled || onDeleteRequest) && !confirmIntent) updateExpanded(true);
  }

  function handleBlurCapture(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    if (!confirmIntent) updateExpanded(false);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      (event.pointerType !== "touch" && event.pointerType !== "pen") ||
      confirmIntent ||
      expanded
    ) {
      return;
    }
    // Touch and pen have no reliable hover state. Use the first tap to reveal
    // the actions and keep it from becoming a drag on the recorder shell.
    event.preventDefault();
    event.stopPropagation();
    updateExpanded(true);
  }

  const timer = formatTimer(elapsedMs);
  const isConfirming = confirmIntent !== null;
  const classNames = ["recording-playhead", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={playheadRef}
      role="toolbar"
      aria-label={labels.controls}
      onMouseDown={onMouseDown}
      onTransitionEnd={handleSegmentTransitionEnd}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onPointerDown={handlePointerDown}
      className={classNames}
      style={style}
    >
      <button
        type="button"
        data-recording-playhead-button
        className="recording-playhead__button recording-playhead__stop"
        onClick={onStop}
        disabled={!enabled || isConfirming}
        aria-label={labels.stop}
        style={{
          color: paused ? "var(--playhead-ghost-ink)" : "var(--playhead-rec)",
        }}
      >
        <span aria-hidden className="recording-playhead__stop-icon" />
      </button>
      <span
        aria-live="off"
        className="recording-playhead__timer"
        style={{
          color: paused ? "var(--playhead-on-chrome)" : "var(--playhead-rec)",
        }}
      >
        {timer}
      </span>
      <span
        ref={(el) => {
          segmentRefs.current.mid = el;
        }}
        className="recording-playhead__segment recording-playhead__segment--mid"
        style={{ width: "auto", opacity: 1 }}
      >
        <span className="recording-playhead__inline">
          <span className="recording-playhead__meter-wrap">{meter}</span>
          <button
            type="button"
            data-recording-playhead-button
            onClick={onTogglePause}
            disabled={!enabled || isConfirming}
            aria-label={paused ? labels.resume : labels.pause}
            title={paused ? labels.resumeShortcut : labels.pauseShortcut}
            className="recording-playhead__button recording-playhead__pause"
          >
            {paused ? (
              <IconPlayerPlayFilled size={14} aria-hidden />
            ) : (
              <IconPlayerPauseFilled size={14} aria-hidden />
            )}
          </button>
        </span>
      </span>
      <span
        ref={(el) => {
          segmentRefs.current.q = el;
        }}
        className="recording-playhead__segment"
      >
        <span className="recording-playhead__inline">
          <span className="recording-playhead__confirm-question">
            {confirmIntent === "restart"
              ? labels.restartQuestion
              : labels.deleteQuestion(elapsedMs)}
          </span>
        </span>
      </span>
      <span
        ref={(el) => {
          segmentRefs.current.del = el;
        }}
        className="recording-playhead__segment"
      >
        <span className="recording-playhead__inline">
          <button
            type="button"
            data-recording-playhead-button
            onClick={confirmAction}
            disabled={pendingAction !== null}
            tabIndex={isConfirming ? 0 : -1}
            data-intent={confirmIntent ?? "delete"}
            className="recording-playhead__confirm-action"
          >
            {confirmIntent === "restart"
              ? labels.restartConfirm
              : labels.deleteConfirm}
          </button>
        </span>
      </span>
      <span
        ref={(el) => {
          segmentRefs.current.res = el;
        }}
        className="recording-playhead__segment"
      >
        <span className="recording-playhead__inline">
          <button
            type="button"
            data-recording-playhead-button
            onClick={() => closeConfirm(true)}
            tabIndex={isConfirming ? 0 : -1}
            className="recording-playhead__resume-action"
          >
            {labels.resumeConfirm}
          </button>
        </span>
      </span>
      <span
        ref={(el) => {
          segmentRefs.current.extras = el;
        }}
        className="recording-playhead__segment"
      >
        <span className="recording-playhead__inline">
          <span aria-hidden className="recording-playhead__divider" />
          <button
            type="button"
            data-recording-playhead-button
            onClick={() => openConfirm("restart")}
            disabled={!enabled || pendingAction !== null}
            aria-label={labels.restart}
            title={labels.restartShortcut}
            className="recording-playhead__button recording-playhead__extras-restart"
          >
            <IconRefresh size={14} stroke={2} aria-hidden />
          </button>
          <button
            type="button"
            data-recording-playhead-button
            onClick={() =>
              enabled ? openConfirm("delete") : onDeleteRequest?.()
            }
            disabled={(!enabled && !onDeleteRequest) || pendingAction !== null}
            aria-label={labels.delete}
            title={labels.deleteShortcut}
            className="recording-playhead__button recording-playhead__extras-delete"
          >
            <IconTrash size={14} stroke={2} aria-hidden />
          </button>
        </span>
      </span>
    </div>
  );
}
