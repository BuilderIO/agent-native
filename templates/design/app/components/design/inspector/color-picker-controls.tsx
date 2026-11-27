import { rgbaToCss } from "@shared/color-utils";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import {
  clamp,
  clampTo,
  hsvToRgba,
  parseNumericDraft,
  roundTo,
  type HsvaColor,
} from "./color-picker-utils";

export type PointerGestureState = boolean;

export const POINTER_GESTURE_IDLE: PointerGestureState = false;

export function startPointerGesture(): PointerGestureState {
  return true;
}

export function endPointerGesture(state: PointerGestureState): {
  state: PointerGestureState;
  shouldCommit: boolean;
} {
  return { state: POINTER_GESTURE_IDLE, shouldCommit: state };
}

const SCRUB_DRAG_THRESHOLD_PX = 3;
const SCRUB_PIXELS_PER_STEP = 4;

export interface ScrubGestureState {
  active: boolean;
  dragging: boolean;
  startX: number;
  startValue: number;
}

export const SCRUB_GESTURE_IDLE: ScrubGestureState = {
  active: false,
  dragging: false,
  startX: 0,
  startValue: 0,
};

export function startScrubGesture(
  startX: number,
  startValue: number,
): ScrubGestureState {
  return { active: true, dragging: false, startX, startValue };
}

/** `step` is the size of one scrub tick and `decimals` the precision kept: 1 and 0 for a whole-number field. */
export function computeScrubbedValue(
  startValue: number,
  deltaX: number,
  min: number,
  max: number,
  shiftKey: boolean,
  step = 1,
  decimals = 0,
): number {
  const rate = shiftKey ? 10 : 1;
  const delta = Math.round(deltaX / SCRUB_PIXELS_PER_STEP) * rate * step;
  return clampTo(startValue + delta, min, max, decimals);
}

function trySetPointerCapture(element: Element, pointerId: number): boolean {
  if (typeof element.setPointerCapture !== "function") return false;
  try {
    element.setPointerCapture(pointerId);
    return true;
    // coercion-ok: returning false explicitly selects the window-listener fallback when a pointer is synthetic or no longer active.
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}

function tryReleasePointerCapture(element: Element, pointerId: number): void {
  if (
    typeof element.hasPointerCapture === "function" &&
    typeof element.releasePointerCapture === "function" &&
    element.hasPointerCapture(pointerId)
  ) {
    element.releasePointerCapture(pointerId);
  }
}

function attachWindowPointerFallback(handlers: {
  pointerId: number;
  onMove: (event: globalThis.PointerEvent) => void;
  onUp: (event: globalThis.PointerEvent) => void;
  onCancel: (event: globalThis.PointerEvent) => void;
}): () => void {
  const handleMove = (event: globalThis.PointerEvent) => {
    if (event.pointerId !== handlers.pointerId) return;
    handlers.onMove(event);
  };
  const handleUp = (event: globalThis.PointerEvent) => {
    if (event.pointerId !== handlers.pointerId) return;
    handlers.onUp(event);
  };
  const handleCancel = (event: globalThis.PointerEvent) => {
    if (event.pointerId !== handlers.pointerId) return;
    handlers.onCancel(event);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleCancel);
  return () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
  };
}

// Knobs are 16px; their center travels from 8px to width - 8px so they stay
// on the track at both ends, and the pointer maps onto that same span.
const TRACK_KNOB_INSET_PX = 8;

const KNOB_CLASS =
  // guard:allow-raw-color — the knob keeps a white ring on every theme so it reads over any color.
  "pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]";

/** The 248px saturation/brightness square, drawn over the current hue. */
export function SaturationBrightnessField({
  hsv,
  hueColor: hueColorOverride,
  label,
  disabled,
  overlay,
  onChange,
  onCommit,
}: {
  hsv: HsvaColor;
  /** The pure hue at the square's top-right corner; sRGB unless the caller passes a wide one. */
  hueColor?: string;
  label: string;
  disabled: boolean;
  /** Drawn over the square, under the knob, and never takes the pointer. */
  overlay?: ReactNode;
  onChange: (color: HsvaColor) => void;
  onCommit?: () => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<PointerGestureState>(POINTER_GESTURE_IDLE);
  const activePointerIdRef = useRef<number | null>(null);
  const sawPressedButtonsRef = useRef(false);
  const cleanupWindowFallbackRef = useRef<(() => void) | null>(null);
  const latestRef = useRef({ hsv, disabled, onChange, onCommit });
  latestRef.current = { hsv, disabled, onChange, onCommit };
  const hueColor =
    hueColorOverride ??
    rgbaToCss(hsvToRgba({ h: hsv.h, s: 100, v: 100, a: 1 }));

  const clearWindowFallback = () => {
    cleanupWindowFallbackRef.current?.();
    cleanupWindowFallbackRef.current = null;
  };

  useEffect(() => () => clearWindowFallback(), []);

  useEffect(() => {
    if (!disabled || !draggingRef.current) return;
    clearWindowFallback();
    const ended = endPointerGesture(draggingRef.current);
    draggingRef.current = ended.state;
    activePointerIdRef.current = null;
    sawPressedButtonsRef.current = false;
  }, [disabled]);

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const nextSaturation = ((clientX - rect.left) / rect.width) * 100;
    const nextBrightness = 100 - ((clientY - rect.top) / rect.height) * 100;
    latestRef.current.onChange({
      ...latestRef.current.hsv,
      s: clamp(nextSaturation, 0, 100),
      v: clamp(nextBrightness, 0, 100),
    });
  };

  const finishGesture = (pointerId?: number, releaseTarget?: Element) => {
    if (
      pointerId !== undefined &&
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== pointerId
    ) {
      return;
    }
    clearWindowFallback();
    const ended = endPointerGesture(draggingRef.current);
    draggingRef.current = ended.state;
    activePointerIdRef.current = null;
    sawPressedButtonsRef.current = false;
    if (releaseTarget && pointerId !== undefined) {
      tryReleasePointerCapture(releaseTarget, pointerId);
    }
    if (ended.shouldCommit) latestRef.current.onCommit?.();
  };

  const stepWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s + step, 0, 100) });
      onCommit?.();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s - step, 0, 100) });
      onCommit?.();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v + step, 0, 100) });
      onCommit?.();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v - step, 0, 100) });
      onCommit?.();
    }
  };

  return (
    <div
      ref={fieldRef}
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        clearWindowFallback();
        draggingRef.current = startPointerGesture();
        activePointerIdRef.current = event.pointerId;
        sawPressedButtonsRef.current = event.buttons > 0;
        const captured = trySetPointerCapture(
          event.currentTarget,
          event.pointerId,
        );
        if (!captured) {
          cleanupWindowFallbackRef.current = attachWindowPointerFallback({
            pointerId: event.pointerId,
            onMove: (moveEvent) => {
              if (!draggingRef.current || latestRef.current.disabled) return;
              if (sawPressedButtonsRef.current && moveEvent.buttons === 0) {
                finishGesture(moveEvent.pointerId);
                return;
              }
              updateFromClientPoint(moveEvent.clientX, moveEvent.clientY);
            },
            onUp: (upEvent) => finishGesture(upEvent.pointerId),
            onCancel: (cancelEvent) => finishGesture(cancelEvent.pointerId),
          });
        }
        updateFromClientPoint(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (
          !draggingRef.current ||
          disabled ||
          (activePointerIdRef.current !== null &&
            activePointerIdRef.current !== event.pointerId)
        ) {
          return;
        }
        if (sawPressedButtonsRef.current && event.buttons === 0) {
          finishGesture(event.pointerId, event.currentTarget);
          return;
        }
        updateFromClientPoint(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        finishGesture(event.pointerId, event.currentTarget);
      }}
      onPointerCancel={(event) => {
        finishGesture(event.pointerId, event.currentTarget);
      }}
      onLostPointerCapture={(event) => {
        finishGesture(event.pointerId);
      }}
      onKeyDown={stepWithKeyboard}
      className={cn(
        "relative aspect-square w-full touch-none cursor-crosshair rounded outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{
        // guard:allow-raw-color — the field is always black over white over the hue, whatever the theme.
        backgroundImage: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, ${hueColor} 100%)`,
      }}
    >
      {overlay}
      <span
        className={KNOB_CLASS}
        style={{
          left: `${hsv.s}%`,
          top: `${100 - hsv.v}%`,
        }}
      />
    </div>
  );
}

/** A 16px slider track (hue or opacity) whose knob stays inside the track. */
export function ColorTrack({
  label,
  value,
  min,
  max,
  disabled,
  backgroundImage,
  backgroundColor,
  backgroundSize,
  backgroundPosition,
  onChange,
  onCommit,
  onCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  backgroundImage: string;
  backgroundColor?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  onChange: (value: number) => void;
  onCancel?: () => void;
  onCommit?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<PointerGestureState>(POINTER_GESTURE_IDLE);
  const activePointerIdRef = useRef<number | null>(null);
  const sawPressedButtonsRef = useRef(false);
  const cleanupWindowFallbackRef = useRef<(() => void) | null>(null);
  const gestureStartValueRef = useRef(value);
  const latestRef = useRef({ min, max, disabled, onChange, onCommit });
  latestRef.current = { min, max, disabled, onChange, onCommit };
  const range = max - min;
  const percent = range > 0 ? ((value - min) / range) * 100 : 0;

  const clearWindowFallback = () => {
    cleanupWindowFallbackRef.current?.();
    cleanupWindowFallbackRef.current = null;
  };

  useEffect(() => () => clearWindowFallback(), []);

  useEffect(() => {
    if (!disabled || !draggingRef.current) return;
    clearWindowFallback();
    const ended = endPointerGesture(draggingRef.current);
    draggingRef.current = ended.state;
    activePointerIdRef.current = null;
    sawPressedButtonsRef.current = false;
  }, [disabled]);

  const updateFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    const { min: lo, max: hi, onChange: emit } = latestRef.current;
    if (!rect || rect.width <= 0 || hi <= lo) return;
    const span = Math.max(1, rect.width - TRACK_KNOB_INSET_PX * 2);
    const ratio = (clientX - rect.left - TRACK_KNOB_INSET_PX) / span;
    emit(clamp(lo + ratio * (hi - lo), lo, hi));
  };

  const finishGesture = (pointerId?: number, releaseTarget?: Element) => {
    if (
      pointerId !== undefined &&
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== pointerId
    ) {
      return;
    }
    clearWindowFallback();
    const ended = endPointerGesture(draggingRef.current);
    draggingRef.current = ended.state;
    activePointerIdRef.current = null;
    sawPressedButtonsRef.current = false;
    if (releaseTarget && pointerId !== undefined) {
      tryReleasePointerCapture(releaseTarget, pointerId);
    }
    if (ended.shouldCommit) latestRef.current.onCommit?.();
  };

  const stepWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clamp(value + step, min, max));
      onCommit?.();
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clamp(value - step, min, max));
      onCommit?.();
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
      onCommit?.();
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
      onCommit?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      draggingRef.current &&
      onCancel &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      event.stopPropagation();
      clearWindowFallback();
      const pointerId = activePointerIdRef.current;
      draggingRef.current = POINTER_GESTURE_IDLE;
      activePointerIdRef.current = null;
      sawPressedButtonsRef.current = false;
      if (pointerId !== null && trackRef.current) {
        tryReleasePointerCapture(trackRef.current, pointerId);
      }
      onChange(gestureStartValueRef.current);
      onCancel();
      return;
    }
    stepWithKeyboard(event);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-disabled={disabled}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        clearWindowFallback();
        gestureStartValueRef.current = value;
        draggingRef.current = startPointerGesture();
        activePointerIdRef.current = event.pointerId;
        sawPressedButtonsRef.current = event.buttons > 0;
        const captured = trySetPointerCapture(
          event.currentTarget,
          event.pointerId,
        );
        if (!captured) {
          cleanupWindowFallbackRef.current = attachWindowPointerFallback({
            pointerId: event.pointerId,
            onMove: (moveEvent) => {
              if (!draggingRef.current || latestRef.current.disabled) return;
              if (sawPressedButtonsRef.current && moveEvent.buttons === 0) {
                finishGesture(moveEvent.pointerId);
                return;
              }
              updateFromClientX(moveEvent.clientX);
            },
            onUp: (upEvent) => finishGesture(upEvent.pointerId),
            onCancel: (cancelEvent) => finishGesture(cancelEvent.pointerId),
          });
        }
        updateFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if (
          !draggingRef.current ||
          disabled ||
          (activePointerIdRef.current !== null &&
            activePointerIdRef.current !== event.pointerId)
        ) {
          return;
        }
        if (sawPressedButtonsRef.current && event.buttons === 0) {
          finishGesture(event.pointerId, event.currentTarget);
          return;
        }
        updateFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        finishGesture(event.pointerId, event.currentTarget);
      }}
      onPointerCancel={(event) => {
        finishGesture(event.pointerId, event.currentTarget);
      }}
      onLostPointerCapture={(event) => {
        finishGesture(event.pointerId);
      }}
      className={cn(
        "relative h-4 touch-none cursor-pointer rounded-full border border-border/60 outline-none",
        "ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{
        backgroundImage,
        backgroundColor,
        backgroundSize,
        backgroundPosition,
      }}
    >
      <span
        className={cn(KNOB_CLASS, "top-1/2")}
        style={{
          left: `calc(${TRACK_KNOB_INSET_PX}px + (100% - ${TRACK_KNOB_INSET_PX * 2}px) * ${clamp(percent, 0, 100) / 100})`,
        }}
      />
    </div>
  );
}

/**
 * A number field that scrubs on horizontal drag. `prefix` is the channel
 * letter inside the field's start edge; `suffix` is a unit at its end.
 */
export function ScrubbyNumberInput({
  "aria-label": ariaLabel,
  value,
  min,
  max,
  disabled,
  onChange,
  onCommit,
  className,
  prefix,
  suffix,
  step = 1,
  decimals = 0,
}: {
  "aria-label": string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit?: () => void;
  className?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Size of one arrow-key or scrub tick. */
  step?: number;
  /** Decimal places the field shows and writes. */
  decimals?: number;
}) {
  const shown = (next: number) => String(roundTo(next, decimals));
  const [draft, setDraft] = useState<string>(() => shown(value));
  const draftRef = useRef(draft);
  const skipBlurRef = useRef(false);
  const scrubRef = useRef<ScrubGestureState>(SCRUB_GESTURE_IDLE);
  const activePointerIdRef = useRef<number | null>(null);
  const sawPressedButtonsRef = useRef(false);
  const cleanupWindowFallbackRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestRef = useRef({
    min,
    max,
    step,
    decimals,
    disabled,
    onChange,
    onCommit,
  });
  latestRef.current = {
    min,
    max,
    step,
    decimals,
    disabled,
    onChange,
    onCommit,
  };

  const clearWindowFallback = () => {
    cleanupWindowFallbackRef.current?.();
    cleanupWindowFallbackRef.current = null;
  };

  useEffect(() => () => clearWindowFallback(), []);

  useEffect(() => {
    if (!disabled || !scrubRef.current.active) return;
    clearWindowFallback();
    scrubRef.current = SCRUB_GESTURE_IDLE;
    activePointerIdRef.current = null;
    sawPressedButtonsRef.current = false;
  }, [disabled]);

  useEffect(() => {
    const nextDraft = shown(value);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  const commit = () => {
    const parsed = parseNumericDraft(draftRef.current);
    // An unchanged draft writes nothing: a field that shows 3 decimals of a
    // color authored with 6 must not round it on blur.
    if (
      parsed === null ||
      clampTo(parsed, min, max, decimals) === roundTo(value, decimals)
    ) {
      const reverted = shown(value);
      draftRef.current = reverted;
      setDraft(reverted);
      return;
    }
    onChange(clampTo(parsed, min, max, decimals));
    onCommit?.();
  };

  const applyScrubMove = (
    clientX: number,
    shiftKey: boolean,
    preventDefault?: () => void,
  ) => {
    const deltaX = clientX - scrubRef.current.startX;
    if (!scrubRef.current.dragging) {
      if (Math.abs(deltaX) < SCRUB_DRAG_THRESHOLD_PX) return;
      scrubRef.current = { ...scrubRef.current, dragging: true };
      window.getSelection()?.removeAllRanges();
    }
    preventDefault?.();
    const {
      min: lo,
      max: hi,
      step: s,
      decimals: d,
      onChange: emit,
    } = latestRef.current;
    emit(
      computeScrubbedValue(
        scrubRef.current.startValue,
        deltaX,
        lo,
        hi,
        shiftKey,
        s,
        d,
      ),
    );
  };

  const finishScrub = (
    pointerId: number | undefined,
    blurAfterDrag: boolean,
    releaseTarget?: Element,
  ) => {
    if (
      pointerId !== undefined &&
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== pointerId
    ) {
      return;
    }
    clearWindowFallback();
    const wasDragging = scrubRef.current.dragging;
    scrubRef.current = SCRUB_GESTURE_IDLE;
    activePointerIdRef.current = null;
    sawPressedButtonsRef.current = false;
    if (releaseTarget && pointerId !== undefined) {
      tryReleasePointerCapture(releaseTarget, pointerId);
    }
    if (wasDragging) {
      latestRef.current.onCommit?.();
      skipBlurRef.current = true;
      if (blurAfterDrag) {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="relative min-w-0">
      {prefix !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center !text-[11px] text-muted-foreground">
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        type="number"
        step={step}
        aria-label={ariaLabel}
        value={draft}
        min={min}
        max={max}
        disabled={disabled}
        className={cn(
          "h-6 w-full touch-none rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-center !text-[11px] tabular-nums",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          prefix !== undefined && "ps-5 text-start",
          suffix !== undefined && "pe-5",
          className,
        )}
        onChange={(e) => {
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            skipBlurRef.current = true;
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            const reverted = shown(value);
            draftRef.current = reverted;
            setDraft(reverted);
            skipBlurRef.current = true;
            e.currentTarget.blur();
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            const tick = e.shiftKey ? step * 10 : step;
            const parsed = parseNumericDraft(draftRef.current);
            const base = parsed ?? value;
            onChange(clampTo(base + tick, min, max, decimals));
            onCommit?.();
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            const tick = e.shiftKey ? step * 10 : step;
            const parsed = parseNumericDraft(draftRef.current);
            const base = parsed ?? value;
            onChange(clampTo(base - tick, min, max, decimals));
            onCommit?.();
          }
        }}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit();
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          clearWindowFallback();
          scrubRef.current = startScrubGesture(e.clientX, value);
          activePointerIdRef.current = e.pointerId;
          sawPressedButtonsRef.current = e.buttons > 0;
          const captured = trySetPointerCapture(e.currentTarget, e.pointerId);
          if (!captured) {
            cleanupWindowFallbackRef.current = attachWindowPointerFallback({
              pointerId: e.pointerId,
              onMove: (moveEvent) => {
                if (latestRef.current.disabled || !scrubRef.current.active) {
                  return;
                }
                if (sawPressedButtonsRef.current && moveEvent.buttons === 0) {
                  finishScrub(moveEvent.pointerId, true);
                  return;
                }
                applyScrubMove(moveEvent.clientX, moveEvent.shiftKey, () =>
                  moveEvent.preventDefault(),
                );
              },
              onUp: (upEvent) => finishScrub(upEvent.pointerId, true),
              onCancel: (cancelEvent) =>
                finishScrub(cancelEvent.pointerId, false),
            });
          }
        }}
        onPointerMove={(e) => {
          if (
            disabled ||
            !scrubRef.current.active ||
            (activePointerIdRef.current !== null &&
              activePointerIdRef.current !== e.pointerId)
          ) {
            return;
          }
          if (sawPressedButtonsRef.current && e.buttons === 0) {
            finishScrub(e.pointerId, true, e.currentTarget);
            return;
          }
          applyScrubMove(e.clientX, e.shiftKey, () => e.preventDefault());
        }}
        onPointerUp={(e) => {
          finishScrub(e.pointerId, true, e.currentTarget);
        }}
        onPointerCancel={(e) => {
          finishScrub(e.pointerId, false, e.currentTarget);
        }}
        onLostPointerCapture={(e) => {
          finishScrub(e.pointerId, false);
        }}
      />
      {suffix !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center !text-[11px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}
