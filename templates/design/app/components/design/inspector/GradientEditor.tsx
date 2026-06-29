import { parseCssColor, rgbaToCss } from "@shared/color-utils";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

// ─── Checkerboard (matches FigmaColorPicker) ───────────────────────────────────

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
      // non-circular ellipse reads as the diamond falloff Figma shows.
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
    kind = fallbackKind === "linear" ? "linear" : fallbackKind;
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
    kind = /ellipse/i.test(first) ? "diamond" : "radial";
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

// ─── Component ─────────────────────────────────────────────────────────────────

export interface GradientEditorProps {
  value: GradientValue;
  onChange: (value: GradientValue) => void;
  selectedStopId: string;
  onSelectStop: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

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
    // Clicking the empty bar area adds a stop at that position.
    const position = positionFromPointer(event.clientX);
    const ordered = sortedStops(value.stops);
    // Interpolate the color from the nearest stops for a natural insert.
    const before = [...ordered].reverse().find((s) => s.position <= position);
    const newColor = before?.color ?? ordered[0]?.color ?? "#000000";
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
    onChange({ ...value, angle: clamp(angle, 0, 360) });
  };

  const showAngle = value.kind === "linear" || value.kind === "angular";

  return (
    <div className={cn("px-3 pt-1.5 pb-1", className)}>
      {/* ── Gradient bar with draggable stops ─────────────────────────────── */}
      <div className="relative h-6 select-none">
        {/* Checkerboard underlay so alpha stops read correctly */}
        <div
          className="absolute inset-0 rounded-md"
          style={{
            backgroundImage: CHECKERBOARD_IMAGE,
            backgroundSize: CHECKER_SIZE,
            backgroundPosition: CHECKER_POS,
          }}
          aria-hidden="true"
        />
        <div
          ref={barRef}
          role="group"
          aria-label={"Gradient stops" /* i18n-ignore */}
          onPointerDown={handleBarPointerDown}
          className={cn(
            "absolute inset-0 cursor-copy rounded-md border border-border/60",
            disabled && "cursor-not-allowed opacity-60",
          )}
          style={{ backgroundImage: stopsBarCss(value.stops) }}
        >
          {value.stops.map((stop) => {
            const isSelected = stop.id === selectedStopId;
            const parsed = parseCssColor(stop.color);
            return (
              <Tooltip key={stop.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${stop.color} ${Math.round(stop.position)}%`}
                    aria-pressed={isSelected}
                    disabled={disabled}
                    onPointerDown={(event) => startStopDrag(event, stop.id)}
                    onPointerMove={handleStopPointerMove}
                    onPointerUp={endStopDrag}
                    onPointerCancel={endStopDrag}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      removeStop(stop.id);
                    }}
                    className={cn(
                      "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 active:cursor-grabbing",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-white shadow-[0_0_0_1.5px_var(--primary)]"
                        : "border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]",
                    )}
                    style={{
                      left: `${stop.position}%`,
                      backgroundColor: parsed
                        ? rgbaToCss({ ...parsed, a: 1 })
                        : stop.color,
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {Math.round(stop.position)}%{" "}
                  {value.stops.length > 2
                    ? "· double-click to remove" /* i18n-ignore */
                    : ""}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* ── Stop controls: position + angle/center + add/remove ───────────── */}
      <div className="mt-2 flex items-center gap-1">
        {/* Selected stop position % */}
        <div className="flex h-6 flex-1 items-center overflow-hidden rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]">
          <span className="flex w-7 shrink-0 items-center justify-center border-r border-border/60 text-[10px] text-muted-foreground">
            {"Pos" /* i18n-ignore gradient stop position abbreviation */}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            aria-label={"Stop position" /* i18n-ignore */}
            disabled={disabled}
            value={Math.round(
              value.stops.find((s) => s.id === selectedStopId)?.position ?? 0,
            )}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next))
                updateStopPosition(selectedStopId, clamp(next, 0, 100));
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[11px] tabular-nums focus-visible:outline-none"
          />
          <span className="flex w-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground">
            %
          </span>
        </div>

        {/* Angle (linear/angular) */}
        {showAngle && (
          <div className="flex h-6 w-[4.5rem] items-center overflow-hidden rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]">
            <span className="flex w-6 shrink-0 items-center justify-center border-r border-border/60 text-[10px] text-muted-foreground">
              {"∠" /* i18n-ignore angle glyph */}
            </span>
            <input
              type="number"
              min={0}
              max={360}
              aria-label={"Gradient angle" /* i18n-ignore */}
              disabled={disabled}
              value={Math.round(value.angle)}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setAngle(next);
              }}
              className="h-full min-w-0 flex-1 bg-transparent px-1 text-[11px] tabular-nums focus-visible:outline-none"
            />
            <span className="flex w-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground">
              °
            </span>
          </div>
        )}

        {/* Add stop (at midpoint of the two widest-spaced stops) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={"Add stop" /* i18n-ignore */}
              onClick={() => {
                const ordered = sortedStops(value.stops);
                let gapStart = ordered[0];
                let gapEnd = ordered[ordered.length - 1];
                let widest = -1;
                for (let i = 0; i < ordered.length - 1; i += 1) {
                  const gap = ordered[i + 1].position - ordered[i].position;
                  if (gap > widest) {
                    widest = gap;
                    gapStart = ordered[i];
                    gapEnd = ordered[i + 1];
                  }
                }
                const position = (gapStart.position + gapEnd.position) / 2;
                const newStop: GradientStopValue = {
                  id: nextStopId(),
                  color: gapStart.color,
                  position,
                };
                onChange({ ...value, stops: [...value.stops, newStop] });
                onSelectStop(newStop.id);
              }}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled && "pointer-events-none opacity-40",
              )}
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{"Add stop" /* i18n-ignore */}</TooltipContent>
        </Tooltip>

        {/* Remove selected stop */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={disabled || value.stops.length <= 2}
              aria-label={"Remove stop" /* i18n-ignore */}
              onClick={() => removeStop(selectedStopId)}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground hover:text-destructive",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                (disabled || value.stops.length <= 2) &&
                  "pointer-events-none opacity-40",
              )}
            >
              <IconTrash className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{"Remove stop" /* i18n-ignore */}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// Re-export the keep-stable counter reset for tests if ever needed.
export function __resetStopCounterForTest(): void {
  stopCounter = 0;
}
