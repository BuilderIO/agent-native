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
  PointerEventHandler,
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { RecordingPlayheadOrientation } from "./recording-playhead-position";

import "./recording-playhead.css";

const SEGMENT_MS = 120;
const HOVER_INTENT_MS = 150;
const CONFIRM_CONTENT_DELAY_MS = 24;

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
  orientation?: RecordingPlayheadOrientation;
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
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
}

type Segment = "mid" | "confirm" | "extras";

const SEGMENTS: Segment[] = ["mid", "confirm", "extras"];

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
  orientation = "horizontal",
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  className,
  style,
}: RecordingPlayheadProps) {
  const [confirmIntent, setConfirmIntent] =
    useState<RecordingPlayheadIntent | null>(null);
  const [expanded, setExpanded] = useState(false);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const confirmActionRef = useRef<HTMLButtonElement | null>(null);
  const displayedConfirmIntentRef = useRef<RecordingPlayheadIntent>("delete");
  const segmentRefs = useRef<Record<Segment, HTMLSpanElement | null>>({
    mid: null,
    confirm: null,
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
  const transitionSegmentsRef = useRef<
    (changes: Array<[Segment, boolean, number]>) => void
  >(() => {});
  const lastConfirmRequestRef = useRef(0);
  const previousOrientationRef = useRef(orientation);
  const openSegmentsRef = useRef<Record<Segment, boolean>>({
    mid: true,
    confirm: false,
    extras: false,
  });

  pausedRef.current = paused;
  onLayoutChangeRef.current = onLayoutChange;
  onExpandedChangeRef.current = onExpandedChange;
  if (confirmIntent) displayedConfirmIntentRef.current = confirmIntent;

  // Segment animations leave inline dimensions behind. Clear the old axis
  // before the next layout pass so a docked playhead cannot inherit a hidden
  // width when it switches to the vertical axis.
  useLayoutEffect(() => {
    const previous = previousOrientationRef.current;
    if (previous === orientation) return;
    const oldDimension = previous === "vertical" ? "height" : "width";
    for (const segment of SEGMENTS) {
      const el = segmentRefs.current[segment];
      if (el) el.style[oldDimension] = "";
    }
    previousOrientationRef.current = orientation;
  }, [orientation]);

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

  useLayoutEffect(() => {
    // Native overlays need a synchronous size report when the axis changes;
    // a ResizeObserver notification can be deferred while a Tauri drag is
    // handing control back from the platform window manager.
    reportLayout();
  }, [orientation, reportLayout]);

  function segmentInnerSize(segment: Segment): number {
    const el = segmentRefs.current[segment];
    const inner = el?.firstElementChild as HTMLElement | null;
    if (!inner) return 0;
    const rect = inner.getBoundingClientRect();
    return Math.ceil(orientation === "vertical" ? rect.height : rect.width);
  }

  function segmentCurrentSize(segment: Segment): number {
    const rect = segmentRefs.current[segment]?.getBoundingClientRect();
    return rect ? (orientation === "vertical" ? rect.height : rect.width) : 0;
  }

  function setSegment(segment: Segment, open: boolean, delayMs = 0) {
    const el = segmentRefs.current[segment];
    if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null;
    el.dataset.state = open ? "open" : "closed";
    const dimension = orientation === "vertical" ? "height" : "width";
    // A segment that starts at `auto` cannot animate from a number. Snap it to
    // its measured main-axis size first, just as the desktop overlay does.
    if (!open && (!el.style[dimension] || el.style[dimension] === "auto")) {
      el.style.transition = "none";
      el.style[dimension] = `${segmentCurrentSize(segment)}px`;
      void el.offsetWidth;
    }
    const reduced = reducedMotionRef.current;
    el.style.transition = reduced
      ? "none"
      : `${dimension} ${SEGMENT_MS}ms var(--playhead-ease), opacity ${SEGMENT_MS}ms ease`;
    // Geometry always moves as one surface. Delaying individual segments
    // makes the pill resize in steps, which reads as bounce rather than a
    // deliberate state transition.
    el.style.transitionDelay = "0ms";
    if (inner) {
      // Let the surface begin opening before its contents crossfade. The same
      // delay applies to every confirmation control, so they read as one state
      // change rather than a sequence of animated widgets.
      inner.style.transitionDelay = reduced || !open ? "0ms" : `${delayMs}ms`;
    }
    el.style[dimension] = open ? `${segmentInnerSize(segment)}px` : "0px";
    el.style.opacity = open ? "1" : "0";
  }

  function transitionSegments(changes: Array<[Segment, boolean, number]>) {
    const playhead = playheadRef.current;
    if (!playhead) return;
    for (const [segment, open] of changes) {
      openSegmentsRef.current[segment] = open;
    }

    const playheadRect = playhead.getBoundingClientRect();
    const playheadMainSize =
      orientation === "vertical" ? playheadRect.height : playheadRect.width;
    const currentSegmentsSize = SEGMENTS.reduce(
      (sum, segment) => sum + segmentCurrentSize(segment),
      0,
    );
    const staticSize = playheadMainSize - currentSegmentsSize;
    const targetSize = SEGMENTS.reduce(
      (sum, segment) =>
        sum +
        (openSegmentsRef.current[segment] ? segmentInnerSize(segment) : 0),
      staticSize,
    );
    const maxDelay = changes.reduce(
      (max, [, , delay]) => Math.max(max, delay),
      0,
    );
    const settleMs = reducedMotionRef.current ? 16 : SEGMENT_MS + maxDelay + 16;
    const batch = ++settleBatchRef.current;
    layoutTransitionPendingRef.current = true;

    onLayoutChangeRef.current?.({
      // Give native desktop windows room before the animation starts. The
      // browser ignores this callback and lets the document reflow normally.
      width:
        orientation === "vertical"
          ? Math.ceil(playheadRect.width)
          : Math.ceil(Math.max(playheadRect.width, targetSize)),
      height:
        orientation === "vertical"
          ? Math.ceil(Math.max(playheadRect.height, targetSize))
          : Math.ceil(playheadRect.height),
    });

    for (const [segment, open, delay] of changes) {
      setSegment(segment, open, delay);
    }

    const finishSettle = () => {
      if (settleBatchRef.current !== batch) return;
      layoutTransitionPendingRef.current = false;
      reportLayout();
    };
    if (shrinkTimerRef.current) clearTimeout(shrinkTimerRef.current);
    // One timer owns the whole batch. Individual transitionend events can
    // belong to an animation that was interrupted by a newer hover state.
    shrinkTimerRef.current = setTimeout(
      finishSettle,
      reducedMotionRef.current ? 0 : settleMs + 16,
    );
  }

  transitionSegmentsRef.current = transitionSegments;

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
        ["confirm", true, CONFIRM_CONTENT_DELAY_MS],
      ]);
      return;
    }
    transitionSegmentsRef.current([
      ["confirm", false, 0],
      ["mid", true, CONFIRM_CONTENT_DELAY_MS],
      ["extras", expanded, 0],
    ]);
  }, [confirmIntent, expanded, orientation]);

  useLayoutEffect(() => {
    if (confirmIntent) confirmActionRef.current?.focus();
  }, [confirmIntent]);

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
    onPointerDown?.(event);
    const target = event.target as Element | null;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (target?.closest("[data-recording-playhead-button]")) return;
    event.preventDefault();
    event.stopPropagation();
    if (confirmIntent || expanded) return;
    // Touch and pen have no reliable hover state. Use the first tap to reveal
    // the actions and keep it from becoming a drag on the recorder shell.
    updateExpanded(true);
  }

  const timer = formatTimer(elapsedMs);
  const isConfirming = confirmIntent !== null;
  const displayedConfirmIntent =
    confirmIntent ?? displayedConfirmIntentRef.current;
  const controlsDisabled = !enabled || isConfirming || pendingAction !== null;
  const classNames = ["recording-playhead", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={playheadRef}
      role="toolbar"
      aria-label={labels.controls}
      aria-orientation={orientation}
      data-orientation={orientation}
      data-confirming={isConfirming ? "true" : undefined}
      onMouseDown={onMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={classNames}
      style={style}
    >
      <button
        type="button"
        data-recording-playhead-button
        className="recording-playhead__button recording-playhead__stop"
        onClick={onStop}
        disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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
          segmentRefs.current.confirm = el;
        }}
        className="recording-playhead__segment recording-playhead__segment--confirm"
      >
        <span className="recording-playhead__inline">
          <span className="recording-playhead__confirm-question">
            {displayedConfirmIntent === "restart"
              ? labels.restartQuestion
              : labels.deleteQuestion(elapsedMs)}
          </span>
          <button
            type="button"
            data-recording-playhead-button
            ref={confirmActionRef}
            onClick={confirmAction}
            disabled={pendingAction !== null}
            tabIndex={isConfirming ? 0 : -1}
            data-intent={displayedConfirmIntent}
            className="recording-playhead__confirm-action"
          >
            {displayedConfirmIntent === "restart"
              ? labels.restartConfirm
              : labels.deleteConfirm}
          </button>
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
            tabIndex={isConfirming || !expanded ? -1 : 0}
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
            tabIndex={isConfirming || !expanded ? -1 : 0}
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
