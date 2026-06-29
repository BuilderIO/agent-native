import { parseCssColor, rgbaToCss } from "@shared/color-utils";
import { IconTrash } from "@tabler/icons-react";
import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GradientKind = "linear" | "radial" | "angular" | "diamond";

export interface GradientStopValue {
  id: string;
  /** Any CSS color string. */
  color: string;
  /** 0–100 along the gradient axis. */
  position: number;
}

export interface GradientValue {
  kind: GradientKind;
  /** Angle in degrees — used by linear and angular (conic) gradients. */
  angle: number;
  stops: GradientStopValue[];
}

// ─── Checkerboard (matches DesignColorPicker) ───────────────────────────────────

const CHECKER_A = "#d4d4d4";
const CHECKERBOARD_IMAGE = `linear-gradient(45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(-45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${CHECKER_A} 75%), linear-gradient(-45deg, transparent 75%, ${CHECKER_A} 75%)`;
const CHECKER_SIZE = "8px 8px, 8px 8px, 8px 8px, 8px 8px";
const CHECKER_POS = "0 0, 0 4px, 4px -4px, -4px 0";

// ─── CSS serialization ─────────────────────────────────────────────────────────

function sortedStops(stops: GradientStopValue[]): GradientStopValue[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

/** Build a valid CSS gradient string for the given gradient value. */
export function gradientToCss(value: GradientValue): string {
  const stops = sortedStops(value.stops)
    .map((stop) => `${normalizeColor(stop.color)} ${round(stop.position)}%`)
    .join(", ");

  switch (value.kind) {
    case "linear":
      return `linear-gradient(${round(value.angle)}deg, ${stops})`;
    case "radial":
      return `radial-gradient(circle at center, ${stops})`;
    case "diamond":
      // CSS has no diamond gradient; a radial gradient with closest-side on a
      // non-circular ellipse reads as the diamond falloff the design editor shows.
      return `radial-gradient(ellipse closest-side at center, ${stops})`;
    case "angular":
      return `conic-gradient(from ${round(value.angle)}deg at center, ${stops})`;
    default:
      return `linear-gradient(${round(value.angle)}deg, ${stops})`;
  }
}

/** A flat left-to-right preview of the stops, independent of kind/angle. */
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

// ─── Default / parse helpers ───────────────────────────────────────────────────

let stopCounter = 0;
function nextStopId(): string {
  stopCounter += 1;
  return `gstop-${stopCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultGradient(
  kind: GradientKind,
  baseColor = "#000000",
): GradientValue {
  const parsed = parseCssColor(baseColor);
  const solid = parsed ? rgbaToCss({ ...parsed, a: 1 }) : "#000000";
  const transparent = parsed
    ? rgbaToCss({ ...parsed, a: 0 })
    : "rgba(0, 0, 0, 0)";
  return {
    kind,
    angle: kind === "radial" || kind === "diamond" ? 0 : 90,
    stops: [
      { id: nextStopId(), color: solid, position: 0 },
      { id: nextStopId(), color: transparent, position: 100 },
    ],
  };
}

const GRADIENT_FN_RE = /^(linear|radial|conic)-gradient\s*\(([\s\S]*)\)\s*$/i;
const ANGLE_RE = /(-?\d+(?:\.\d+)?)deg/;
// Split top-level commas (ignore commas inside rgb()/hsl() parens).
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

/** Best-effort parse of a CSS gradient string back into a GradientValue. */
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
  let angle = 90;
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
      /ellipse\s+closest-side/i.test(first) || fallbackKind === "diamond"
        ? "diamond"
        : "radial";
    if (/circle|ellipse|at\s/i.test(first)) stopStart = 1;
  } else if (fn === "conic") {
    kind = "angular";
    const angleMatch = first.match(ANGLE_RE);
    if (angleMatch) angle = Number(angleMatch[1]);
    if (/from|at\s/i.test(first)) stopStart = 1;
  }

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
  return { kind, angle, stops };
}

// ─── AngleDial ────────────────────────────────────────────────────────────────

interface AngleDialProps {
  angle: number;
  onChange: (angle: number) => void;
  disabled?: boolean;
}

/** design-editor circular dial for rotating gradient angle. */
function AngleDial({ angle, onChange, disabled = false }: AngleDialProps) {
  const dialRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const angleFromPointer = (clientX: number, clientY: number): number => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return angle;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rad = Math.atan2(clientY - cy, clientX - cx);
    // atan2 gives angle from east; the design editor's 0° is north (up), clockwise.
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
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const dotAngle = ((angle - 90) * Math.PI) / 180;
  // Dot placed at ~65% radius from center.
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
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange((angle - 1 + 360) % 360);
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

// ─── Component ─────────────────────────────────────────────────────────────────

export interface GradientEditorProps {
  value: GradientValue;
  onChange: (value: GradientValue) => void;
  selectedStopId: string;
  onSelectStop: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

// Stop handle dimensions — the design editor uses ~12px handles with white ring.
const STOP_SIZE = 12; // px, the colored circle diameter
const STOP_RING = 2; // px, white border thickness
const STOP_OUTER = STOP_SIZE + STOP_RING * 2; // 16px total outer
const BAR_HEIGHT = 16; // px — the gradient preview bar
// Handles sit below the bar with a 2px notch gap.
const HANDLE_AREA = STOP_OUTER + 4; // px — vertical space for handles below bar
const WRAPPER_HEIGHT = BAR_HEIGHT + HANDLE_AREA; // total component height

export function GradientEditor({
  value,
  onChange,
  selectedStopId,
  onSelectStop,
  disabled = false,
  className,
}: GradientEditorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingStopRef = useRef<string | null>(null);
  // Track whether a pointerdown on the bar started a drag (vs click-to-add).
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

  // Bar background click → add a new stop (only if no significant drag movement).
  const handleBarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    barClickRef.current = { moved: false, startX: event.clientX };
  };

  const handleBarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!barClickRef.current) return;
    if (Math.abs(event.clientX - barClickRef.current.startX) > 3) {
      barClickRef.current.moved = true;
    }
  };

  const handleBarClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only add if the pointer didn't move significantly (not a drag).
    if (!barClickRef.current || barClickRef.current.moved) {
      barClickRef.current = null;
      return;
    }
    barClickRef.current = null;
    const position = positionFromPointer(event.clientX);
    const ordered = sortedStops(value.stops);
    // Interpolate the color from the adjacent stops for a natural insert.
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
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleStopPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!draggingStopRef.current || disabled) return;
    updateStopPosition(
      draggingStopRef.current,
      positionFromPointer(event.clientX),
    );
  };

  const endStopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    draggingStopRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const removeStop = (id: string) => {
    if (value.stops.length <= 2) return;
    const nextStops = value.stops.filter((stop) => stop.id !== id);
    onChange({ ...value, stops: nextStops });
    if (selectedStopId === id) {
      onSelectStop(sortedStops(nextStops)[0]?.id ?? "");
    }
  };

  const setAngle = (angle: number) => {
    onChange({ ...value, angle: ((angle % 360) + 360) % 360 });
  };

  const showAngle = value.kind === "linear" || value.kind === "angular";
  const selectedStop = value.stops.find((s) => s.id === selectedStopId);

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
          // Opaque version for the handle swatch.
          const solidColor = parsed
            ? rgbaToCss({ ...parsed, a: 1 })
            : stop.color;
          // Position the handle horizontally along the bar width.
          // Handles sit 2px below the bar's bottom edge.
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
              className={cn(
                // Base: round handle with white border ring + outer accent ring
                "absolute cursor-grab active:cursor-grabbing",
                "rounded-full border-[2px] border-white",
                "focus-visible:outline-none",
                // Selected: accent-colored outer ring (the same way's blue ring)
                isSelected
                  ? "shadow-[0_0_0_1.5px_var(--primary),0_1px_3px_rgba(0,0,0,0.35)]"
                  : "shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.25)]",
              )}
              style={{
                width: STOP_OUTER,
                height: STOP_OUTER,
                left: `${stop.position}%`,
                top: topOffset,
                // Center horizontally on the position %.
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
            value={Math.round(selectedStop?.position ?? 0)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next))
                updateStopPosition(selectedStopId, clamp(next, 0, 100));
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[11px] tabular-nums focus-visible:outline-none"
          />
        </div>

        {/* Angle: rotatable dial + numeric input */}
        {showAngle && (
          <div className="flex items-center gap-0.5">
            <AngleDial
              angle={value.angle}
              onChange={setAngle}
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
                onBlur={() => setAngleInput(null)}
                className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[11px] tabular-nums focus-visible:outline-none"
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

// Re-export the keep-stable counter reset for tests if ever needed.
export function __resetStopCounterForTest(): void {
  stopCounter = 0;
}
