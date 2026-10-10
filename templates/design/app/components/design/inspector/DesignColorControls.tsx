import { rgbaToCss, type RgbaColor } from "@shared/color-utils";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils";

const colorHandleRing =
  // guard:allow-raw-color — a fixed white edge keeps color controls visible against authored colors.
  "border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]";

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function hasEyeDropperSupport(): boolean {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

export async function beginEyedropperPick(): Promise<string | null> {
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor })
    .EyeDropper;
  if (!EyeDropper) return null;
  try {
    const result = await new EyeDropper().open();
    return result.sRGBHex ?? null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return null;
    throw error;
  }
}

export interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

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

export function rgbaToHsv(color: RgbaColor): HsvaColor {
  const r = clampFloat(color.r / 255, 0, 1);
  const g = clampFloat(color.g / 255, 0, 1);
  const b = clampFloat(color.b / 255, 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: Math.round(h),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
    a: color.a,
  };
}

export function hsvToRgba(color: HsvaColor): RgbaColor {
  const [r, g, b] = hsvToNormalizedRgb(color);
  return {
    r: clamp(Math.round(r * 255), 0, 255),
    g: clamp(Math.round(g * 255), 0, 255),
    b: clamp(Math.round(b * 255), 0, 255),
    a: clampFloat(color.a, 0, 1),
  };
}

export function hsvToNormalizedRgb(color: HsvaColor): [number, number, number] {
  const h = ((color.h % 360) + 360) % 360;
  const s = clampFloat(color.s, 0, 100) / 100;
  const v = clampFloat(color.v, 0, 100) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return [r + m, g + m, b + m];
}

export function SaturationBrightnessField({
  hsv,
  label,
  disabled,
  onChange,
  onCommit,
}: {
  hsv: HsvaColor;
  label: string;
  disabled: boolean;
  onChange: (color: HsvaColor) => void;
  onCommit?: () => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<PointerGestureState>(POINTER_GESTURE_IDLE);
  const hueColor = rgbaToCss(hsvToRgba({ h: hsv.h, s: 100, v: 100, a: 1 }));

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextSaturation = ((event.clientX - rect.left) / rect.width) * 100;
    const nextBrightness =
      100 - ((event.clientY - rect.top) / rect.height) * 100;
    onChange({
      ...hsv,
      s: clamp(nextSaturation, 0, 100),
      v: clamp(nextBrightness, 0, 100),
    });
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
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.focus();
        draggingRef.current = startPointerGesture();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || disabled) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (ended.shouldCommit) onCommit?.();
      }}
      onPointerCancel={() => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (ended.shouldCommit) onCommit?.();
      }}
      onKeyDown={stepWithKeyboard}
      className={cn(
        "relative h-48 w-full touch-none cursor-crosshair overflow-hidden outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{
        // guard:allow-raw-color — the color plane uses fixed white and black mathematical endpoints.
        backgroundImage: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, ${hueColor} 100%)`,
      }}
    >
      {/* Handle: size-4, white ring, consistent foreground shadow */}
      <span
        className={cn(
          "pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full",
          colorHandleRing,
        )}
        style={{
          left: `${hsv.s}%`,
          top: `${100 - hsv.v}%`,
        }}
      />
    </div>
  );
}

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
  const gestureStartValueRef = useRef(value);
  const percent = ((value - min) / (max - min)) * 100;

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = min + ((event.clientX - rect.left) / rect.width) * (max - min);
    onChange(clamp(next, min, max));
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
      draggingRef.current = POINTER_GESTURE_IDLE;
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
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.focus();
        gestureStartValueRef.current = value;
        draggingRef.current = startPointerGesture();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || disabled) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (ended.shouldCommit) onCommit?.();
      }}
      onPointerCancel={() => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (ended.shouldCommit) onCommit?.();
      }}
      className={cn(
        "relative h-3.5 touch-none cursor-pointer rounded-full border border-border/60 outline-none",
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
      {/* Thumb overhangs the track slightly, matching the design editor */}
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full",
          colorHandleRing,
        )}
        style={{ left: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  );
}
