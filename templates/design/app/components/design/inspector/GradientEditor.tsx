import {
  defaultGradientEndColor,
  parseCssColor,
  rgbaToCss,
} from "@shared/color-utils";
import {
  gradientStopWithFillOpacity,
  gradientFillInterpolation,
  readGradientFillOpacity,
} from "@shared/gradient-opacity";
import { IconTrash } from "@tabler/icons-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";


export type GradientKind = "linear" | "radial" | "angular" | "diamond";

export interface GradientStopValue {
  id: string;
  color: string;
  position: number;
}

export interface GradientValue {
  kind: GradientKind;
  opacity?: number;
  interpolation?: string;
  angle: number;
  stops: GradientStopValue[];
}

/**
 * Contract for "a gradient editing session is active for element X with
 * value V" (Figma-parity on-canvas handles, IP21 follow-up). This popover
 * component stays the source of truth for parsing/serializing the CSS string
 * (`parseGradientCss`/`gradientToCss` below) and for the ramp-bar UI; a
 * canvas-side overlay (see `MultiScreenCanvas`'s `gradientEditTarget` prop)
 * is a *second*, purely-visual view of the same session, so the two must
 * agree on one shared shape rather than inventing parallel state.
 *
 * A caller that wants on-canvas handles alongside this popover should:
 *  1. Keep the "which element/selection is being fill-edited" id it already
 *     has to open this popover (e.g. a selected draft primitive id or a
 *     selected screen/frame id).
 *  2. Track the *current* `GradientValue` for that element the same way this
 *     component's `value` prop is already threaded (parsed once via
 *     `parseGradientCss`, then serialized back to CSS via `gradientToCss` on
 *     every change — exactly what this component's own `onChange` callers do
 *     today).
 *  3. Build a `GradientEditSessionTarget` from those two pieces and pass it
 *     to `MultiScreenCanvas`'s `gradientEditTarget` prop whenever this
 *     popover is open (gated on `showGradientEditor` /
 *     `GRADIENT_PAINT_TYPES.has(effectivePaintType)`) and the target is a
 *     board/draft primitive or screen frame that canvas can draw chrome for;
 *     pass `null`/`undefined` otherwise (popover closed, non-canvas target,
 *     or non-linear kind — see that prop's doc for the current linear-only
 *     scope).
 */
export interface GradientEditSessionTarget {
  frameOrDraftId: string;
  cssValue: string;
  onChange: (nextCss: string, meta?: { phase: "preview" | "commit" }) => void;
}


// guard:allow-raw-color — fixed light checkerboard tile keeps transparency visible.
const CHECKER_A = "#e5e5e5";
// guard:allow-raw-color — fixed light checkerboard tile keeps transparency visible.
const CHECKER_B = "#ffffff";
const CHECKERBOARD_IMAGE = `conic-gradient(${CHECKER_A} 25%, ${CHECKER_B} 0 50%, ${CHECKER_A} 0 75%, ${CHECKER_B} 0)`;
const CHECKER_SIZE = "8px 8px";
const CHECKER_POS = "0 0";


function sortedStops(stops: GradientStopValue[]): GradientStopValue[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

export function gradientToCss(value: GradientValue): string {
  const interpolation =
    value.interpolation ??
    gradientFillInterpolation(
      value.stops.map((stop) => stop.color),
      value.opacity,
    );
  const colorSpace = interpolation ? ` ${interpolation}` : "";
  const stops = sortedStops(value.stops)
    .map(
      (stop) =>
        `${gradientStopWithFillOpacity(normalizeColor(stop.color), value.opacity)} ${round(stop.position)}%`,
    )
    .join(", ");

  switch (value.kind) {
    case "linear":
      return `linear-gradient(${round(value.angle)}deg${colorSpace}, ${stops})`;
    case "radial":
      return `radial-gradient(circle at center${colorSpace}, ${stops})`;
    case "diamond":
      return `radial-gradient(ellipse closest-side at center${colorSpace}, ${stops})`;
    case "angular":
      return `conic-gradient(from ${round(value.angle)}deg at center${colorSpace}, ${stops})`;
    default:
      return `linear-gradient(${round(value.angle)}deg${colorSpace}, ${stops})`;
  }
}

function stopsBarCss(stops: GradientStopValue[]): string {
  const ordered = sortedStops(stops)
    .map((stop) => `${normalizeColor(stop.color)} ${round(stop.position)}%`)
    .join(", ");
  return `linear-gradient(90deg, ${ordered})`;
}

function normalizeColor(color: string): string {
  const parsed = parseCssColor(color);
  return parsed ? rgbaToCss(parsed) : color;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function parseStopPositionDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 100) : null;
}

export function nearestStopId(
  stops: GradientStopValue[],
  removedPosition: number | undefined,
): string | null {
  if (stops.length === 0) return null;
  if (removedPosition === undefined) return sortedStops(stops)[0]?.id ?? null;
  let best: GradientStopValue | null = null;
  let bestDistance = Infinity;
  for (const stop of stops) {
    const distance = Math.abs(stop.position - removedPosition);
    if (distance < bestDistance) {
      best = stop;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}


let stopCounter = 0;
function nextStopId(): string {
  stopCounter += 1;
  return `gstop-${stopCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultGradient(
  kind: GradientKind,
  baseColor = "#000000",
): GradientValue {
  const opaque = {
    ...(parseCssColor(baseColor) ?? { r: 0, g: 0, b: 0 }),
    a: 1,
  };
  return {
    kind,
    angle: kind === "linear" ? 180 : kind === "angular" ? 90 : 0,
    stops: [
      { id: nextStopId(), color: rgbaToCss(opaque), position: 0 },
      {
        id: nextStopId(),
        color: rgbaToCss(defaultGradientEndColor(opaque)),
        position: 100,
      },
    ],
  };
}

const GRADIENT_FN_RE = /^(linear|radial|conic)-gradient\s*\(([\s\S]*)\)\s*$/i;
const ANGLE_RE = /(-?\d+(?:\.\d+)?)deg/;
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function parseGradientCss(
  value: string,
  fallbackKind: GradientKind = "linear",
): GradientValue | null {
  const match = value.trim().match(GRADIENT_FN_RE);
  if (!match) return null;

  const fn = match[1].toLowerCase();
  const body = match[2];
  const segments = splitTopLevel(body);
  if (segments.length === 0) return null;

  let kind: GradientKind = fallbackKind;
  let angle = fn === "linear" ? 180 : 90;
  let stopStart = 0;

  const first = segments[0];
  const looksLikeStop =
    /#|rgb|hsl|^\s*[a-z]+\s+\d/i.test(first) && fn === "linear"
      ? ANGLE_RE.test(first) === false && /%/.test(first)
      : false;

  if (fn === "linear") {
    kind = "linear";
    const angleMatch = first.match(ANGLE_RE);
    if (angleMatch) {
      angle = Number(angleMatch[1]);
      stopStart = 1;
    } else if (/to\s+/i.test(first)) {
      stopStart = 1;
    } else if (!looksLikeStop && /^\s*(circle|ellipse|from|at)/i.test(first)) {
      stopStart = 1;
    }
  } else if (fn === "radial") {
    kind =
      /ellipse\s+closest-side/i.test(first) ||
      /closest-corner/i.test(first) ||
      fallbackKind === "diamond"
        ? "diamond"
        : "radial";
    if (/circle|ellipse|at\s|closest-/i.test(first)) stopStart = 1;
  } else if (fn === "conic") {
    kind = "angular";
    const angleMatch = first.match(ANGLE_RE);
    if (angleMatch) angle = Number(angleMatch[1]);
    if (/from|at\s/i.test(first)) stopStart = 1;
  }

  if (/^in\s/i.test(first)) stopStart = 1;
  const interpolation =
    stopStart === 1
      ? first.match(
          /\bin\s+[a-z0-9-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/i,
        )?.[0]
      : undefined;
  const stopSegments = segments.slice(stopStart);
  const stops: GradientStopValue[] = [];
  stopSegments.forEach((seg, index) => {
    const posMatch = seg.match(/(-?\d+(?:\.\d+)?)%\s*$/);
    const color = posMatch ? seg.slice(0, posMatch.index).trim() : seg.trim();
    if (!color) return;
    const position = posMatch
      ? clamp(Number(posMatch[1]), 0, 100)
      : (index / Math.max(1, stopSegments.length - 1)) * 100;
    stops.push({ id: nextStopId(), color, position });
  });

  if (stops.length < 2) return null;
  const fill = readGradientFillOpacity(stops);
  return {
    kind,
    angle,
    stops: fill.stops,
    ...(interpolation ? { interpolation } : {}),
    ...(fill.opacity !== 100 ? { opacity: fill.opacity } : {}),
  };
}


interface AngleDialProps {
  angle: number;
  onChange: (angle: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
}

function AngleDial({
  angle,
  onChange,
  onCommit,
  disabled = false,
}: AngleDialProps) {
  const dialRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const angleFromPointer = (clientX: number, clientY: number): number => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return angle;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rad = Math.atan2(clientY - cy, clientX - cx);
    let deg = (rad * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    if (deg >= 360) deg -= 360;
    return Math.round(deg);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(angleFromPointer(e.clientX, e.clientY));
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onChange(angleFromPointer(e.clientX, e.clientY));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wasDragging) onCommit?.();
  };

  const dotAngle = ((angle - 90) * Math.PI) / 180;
  const r = 7;
  const dotX = 50 + r * Math.cos(dotAngle);
  const dotY = 50 + r * Math.sin(dotAngle);

  return (
    <div
      ref={dialRef}
      role="slider"
      aria-label={"Gradient angle" /* i18n-ignore */}
      aria-valuenow={Math.round(angle)}
      aria-valuemin={0}
      aria-valuemax={360}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange((angle + 1) % 360);
          onCommit?.();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange((angle - 1 + 360) % 360);
          onCommit?.();
        }
      }}
      className={cn(
        "relative flex size-[18px] shrink-0 cursor-pointer select-none items-center justify-center rounded-full",
        "border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full"
        aria-hidden="true"
      >
        {/* Outer ring track */}
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="currentColor"
          strokeWidth="0"
          opacity="0"
        />
        {/* Dot indicator */}
        <circle
          cx={dotX}
          cy={dotY}
          r="12"
          fill="currentColor"
          className="text-foreground"
        />
      </svg>
    </div>
  );
}


export interface GradientEditorProps {
  value: GradientValue;
  onChange: (value: GradientValue) => void;
  onCommit?: () => void;
  selectedStopId: string;
  onSelectStop: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

const STOP_SIZE = 12;
const STOP_RING = 2;
const STOP_OUTER = STOP_SIZE + STOP_RING * 2;
const BAR_HEIGHT = 16;
const HANDLE_AREA = STOP_OUTER + 4;
const WRAPPER_HEIGHT = BAR_HEIGHT + HANDLE_AREA;

export function GradientEditor({
  value,
  onChange,
  onCommit,
  selectedStopId,
  onSelectStop,
  disabled = false,
  className,
}: GradientEditorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingStopRef = useRef<string | null>(null);
  const stopDragMovedRef = useRef(false);
  const barClickRef = useRef<{ moved: boolean; startX: number } | null>(null);

  const [angleInput, setAngleInput] = useState<string | null>(null);

  const positionFromPointer = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  };

  const updateStopPosition = (id: string, position: number) => {
    onChange({
      ...value,
      stops: value.stops.map((stop) =>
        stop.id === id ? { ...stop, position } : stop,
      ),
    });
  };

  const handleBarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    barClickRef.current = { moved: false, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!barClickRef.current) return;
    if (Math.abs(event.clientX - barClickRef.current.startX) > 3) {
      barClickRef.current.moved = true;
    }
  };

  const handleBarClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!barClickRef.current || barClickRef.current.moved) {
      barClickRef.current = null;
      return;
    }
    barClickRef.current = null;
    const position = positionFromPointer(event.clientX);
    const ordered = sortedStops(value.stops);
    const before = [...ordered].reverse().find((s) => s.position <= position);
    const after = ordered.find((s) => s.position > position);
    let newColor: string;
    if (before && after) {
      const range = after.position - before.position;
      const t = range === 0 ? 0 : (position - before.position) / range;
      const cb = parseCssColor(before.color);
      const ca = parseCssColor(after.color);
      if (cb && ca) {
        newColor = rgbaToCss({
          r: Math.round(cb.r + t * (ca.r - cb.r)),
          g: Math.round(cb.g + t * (ca.g - cb.g)),
          b: Math.round(cb.b + t * (ca.b - cb.b)),
          a: cb.a + t * (ca.a - cb.a),
        });
      } else {
        newColor = before.color;
      }
    } else {
      newColor =
        before?.color ?? after?.color ?? ordered[0]?.color ?? "#000000";
    }
    const newStop: GradientStopValue = {
      id: nextStopId(),
      color: newColor,
      position,
    };
    onChange({ ...value, stops: [...value.stops, newStop] });
    onSelectStop(newStop.id);
    onCommit?.();
  };

  const startStopDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (disabled) return;
    event.stopPropagation();
    event.preventDefault();
    onSelectStop(id);
    draggingStopRef.current = id;
    stopDragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleStopPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!draggingStopRef.current || disabled) return;
    stopDragMovedRef.current = true;
    updateStopPosition(
      draggingStopRef.current,
      positionFromPointer(event.clientX),
    );
  };

  const endStopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const wasDragging =
      draggingStopRef.current !== null && stopDragMovedRef.current;
    draggingStopRef.current = null;
    stopDragMovedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasDragging) onCommit?.();
  };

  const removeStop = (id: string) => {
    if (value.stops.length <= 2) return;
    const removed = value.stops.find((stop) => stop.id === id);
    const nextStops = value.stops.filter((stop) => stop.id !== id);
    onChange({ ...value, stops: nextStops });
    if (selectedStopId === id) {
      onSelectStop(nearestStopId(nextStops, removed?.position) ?? "");
    }
    onCommit?.();
  };

  const setAngle = (angle: number) => {
    onChange({ ...value, angle: ((angle % 360) + 360) % 360 });
  };

  const showAngle = value.kind === "linear" || value.kind === "angular";
  const selectedStop = value.stops.find((s) => s.id === selectedStopId);

  const [positionDraft, setPositionDraft] = useState<string>(() =>
    String(Math.round(selectedStop?.position ?? 0)),
  );
  const positionDraftRef = useRef(positionDraft);
  const skipPositionBlurRef = useRef(false);
  const selectedStopPosition = selectedStop?.position;
  useEffect(() => {
    const next = String(Math.round(selectedStopPosition ?? 0));
    positionDraftRef.current = next;
    setPositionDraft(next);
    // Resync whenever the selected stop changes or its position changes
    // externally (drag on the bar, another control).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopId, selectedStopPosition]);

  const commitPositionDraft = () => {
    const parsed = parseStopPositionDraft(positionDraftRef.current);
    if (parsed === null) {
      const reverted = String(Math.round(selectedStop?.position ?? 0));
      positionDraftRef.current = reverted;
      setPositionDraft(reverted);
      return;
    }
    updateStopPosition(selectedStopId, parsed);
    onCommit?.();
  };

  const revertPositionDraft = () => {
    const reverted = String(Math.round(selectedStop?.position ?? 0));
    positionDraftRef.current = reverted;
    setPositionDraft(reverted);
  };

  return (
    <div className={cn("px-3 pt-1.5 pb-1 select-none", className)}>
      {/* ── Gradient bar + stop handles ──────────────────────────────────────── */}
      <div
        className="relative"
        style={{ height: WRAPPER_HEIGHT }}
        onPointerMove={handleBarPointerMove}
      >
        {/* Checkerboard underlay */}
        <div
          className="absolute left-0 right-0 top-0 rounded-md"
          style={{
            height: BAR_HEIGHT,
            backgroundImage: CHECKERBOARD_IMAGE,
            backgroundColor: CHECKER_B,
            backgroundSize: CHECKER_SIZE,
            backgroundPosition: CHECKER_POS,
          }}
          aria-hidden="true"
        />
        {/* Gradient bar — clicking empty area adds a stop */}
        <div
          ref={barRef}
          role="group"
          aria-label={"Gradient stops" /* i18n-ignore */}
          onPointerDown={handleBarPointerDown}
          onPointerUp={(e) => handleBarClick(e)}
          className={cn(
            "absolute left-0 right-0 top-0 cursor-copy rounded-md border border-border/50",
            disabled && "cursor-not-allowed opacity-60",
          )}
          style={{
            height: BAR_HEIGHT,
            backgroundImage: stopsBarCss(value.stops),
          }}
        />

        {/* Stop handles — positioned below the bar */}
        {value.stops.map((stop) => {
          const isSelected = stop.id === selectedStopId;
          const parsed = parseCssColor(stop.color);
          const solidColor = parsed
            ? rgbaToCss({ ...parsed, a: 1 })
            : stop.color;
          const topOffset = BAR_HEIGHT + 2;

          return (
            <button
              key={stop.id}
              type="button"
              aria-label={`${stop.color} at ${Math.round(stop.position)}%`}
              aria-pressed={isSelected}
              disabled={disabled}
              onPointerDown={(e) => startStopDrag(e, stop.id)}
              onPointerMove={handleStopPointerMove}
              onPointerUp={endStopDrag}
              onPointerCancel={endStopDrag}
              onClick={(e) => {
                e.stopPropagation();
                onSelectStop(stop.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeStop(stop.id);
              }}
              onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  removeStop(stop.id);
                  return;
                }
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const step = e.shiftKey ? 10 : 1;
                  const delta = e.key === "ArrowRight" ? step : -step;
                  updateStopPosition(
                    stop.id,
                    clamp(stop.position + delta, 0, 100),
                  );
                  onCommit?.();
                }
              }}
              className={cn(
                "absolute cursor-grab active:cursor-grabbing",
                "rounded-full border-[2px] border-white",
                "focus-visible:outline-none",
                isSelected
                  ? "shadow-[0_0_0_1.5px_var(--primary),0_1px_3px_rgba(0,0,0,0.35)]"
                  : "shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.25)]",
              )}
              style={{
                width: STOP_OUTER,
                height: STOP_OUTER,
                left: `${stop.position}%`,
                top: topOffset,
                transform: "translateX(-50%)",
                backgroundColor: solidColor,
              }}
            />
          );
        })}
      </div>

      {/* ── Controls row: position, angle, remove ──────────────────────────── */}
      <div className="mt-2 flex items-center gap-1">
        {/* Selected stop position % */}
        <div className="flex h-6 flex-1 items-center overflow-hidden rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]">
          <span className="flex w-7 shrink-0 items-center justify-center border-r border-border/60 text-[10px] text-muted-foreground">
            {"%" /* i18n-ignore */}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            aria-label={"Stop position" /* i18n-ignore */}
            disabled={disabled}
            value={positionDraft}
            onChange={(event) => {
              positionDraftRef.current = event.target.value;
              setPositionDraft(event.target.value);
            }}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPositionDraft();
                skipPositionBlurRef.current = true;
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                revertPositionDraft();
                skipPositionBlurRef.current = true;
                event.currentTarget.blur();
              }
            }}
            onBlur={() => {
              if (skipPositionBlurRef.current) {
                skipPositionBlurRef.current = false;
                return;
              }
              commitPositionDraft();
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-1.5 !text-[11px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus-visible:outline-none"
          />
        </div>

        {/* Angle: rotatable dial + numeric input */}
        {showAngle && (
          <div className="flex items-center gap-0.5">
            <AngleDial
              angle={value.angle}
              onChange={setAngle}
              onCommit={onCommit}
              disabled={disabled}
            />
            <div className="flex h-6 w-14 items-center overflow-hidden rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]">
              <input
                type="number"
                min={0}
                max={360}
                aria-label={"Gradient angle" /* i18n-ignore */}
                disabled={disabled}
                value={angleInput ?? Math.round(value.angle)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) {
                    const normalised = ((next % 360) + 360) % 360;
                    setAngle(next);
                    setAngleInput(String(Math.round(normalised)));
                  } else {
                    setAngleInput(e.target.value);
                  }
                }}
                onBlur={() => {
                  const changed = angleInput !== null;
                  setAngleInput(null);
                  if (changed) onCommit?.();
                }}
                className="h-full min-w-0 flex-1 bg-transparent px-1.5 !text-[11px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus-visible:outline-none"
              />
              <span className="flex w-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground">
                °
              </span>
            </div>
          </div>
        )}

        {/* Delete selected stop */}
        <button
          type="button"
          disabled={disabled || value.stops.length <= 2}
          aria-label={"Remove stop" /* i18n-ignore */}
          onClick={() => removeStop(selectedStopId)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground",
            "hover:border-destructive/40 hover:text-destructive",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            (disabled || value.stops.length <= 2) &&
              "pointer-events-none opacity-40",
          )}
        >
          <IconTrash className="size-3" />
        </button>
      </div>
    </div>
  );
}

export function __resetStopCounterForTest(): void {
  stopCounter = 0;
}
