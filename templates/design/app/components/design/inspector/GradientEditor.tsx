import { useT } from "@agent-native/core/client/i18n";
import {
  defaultGradientEndColor,
  mixCssColors,
  normalizeCssColor,
  parseCssColor,
  rgbaToCss,
  withCssColorAlpha,
} from "@shared/color-utils";
import {
  gradientStopWithFillOpacity,
  gradientFillInterpolation,
  readGradientFillOpacity,
} from "@shared/gradient-opacity";
import {
  IconMinus,
  IconPlus,
  IconRotate2,
  IconSwitchHorizontal,
} from "@tabler/icons-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { ColorValueField, OpacityValueField } from "./color-picker-fields";
import type { RenderNestedColorPicker } from "./color-picker-nested";
import {
  CHECKER_B,
  CHECKERBOARD_IMAGE,
  swatchStyle,
} from "./color-picker-swatch";

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
 * value V" (On-canvas handles, IP21 follow-up). This popover
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
  return normalizeCssColor(color) ?? color;
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
  const firstStopColor = withCssColorAlpha(baseColor, 1) ?? rgbaToCss(opaque);
  return {
    kind,
    angle: kind === "linear" ? 180 : kind === "angular" ? 90 : 0,
    stops: [
      { id: nextStopId(), color: firstStopColor, position: 0 },
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

/** The color a new stop at `position` starts with: the gradient's own color there. */
function colorAtPosition(stops: GradientStopValue[], position: number): string {
  const ordered = sortedStops(stops);
  const before = [...ordered].reverse().find((s) => s.position <= position);
  const after = ordered.find((s) => s.position > position);
  if (before && after) {
    const range = after.position - before.position;
    const t = range === 0 ? 0 : (position - before.position) / range;
    return mixCssColors(before.color, after.color, t) ?? before.color;
  }
  // guard:allow-raw-color — a gradient with no stops has no color to continue; black is the editor's own default.
  return before?.color ?? after?.color ?? ordered[0]?.color ?? "#000000";
}

/** Where Add stop puts a stop: halfway across the widest gap between two stops. */
export function nextStopPosition(stops: GradientStopValue[]): number {
  const ordered = sortedStops(stops);
  let widest = { gap: -1, at: 50 };
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const gap = ordered[index + 1]!.position - ordered[index]!.position;
    if (gap > widest.gap) {
      widest = { gap, at: ordered[index]!.position + gap / 2 };
    }
  }
  return round(widest.at);
}

export interface GradientEditorProps {
  value: GradientValue;
  onChange: (value: GradientValue) => void;
  onCommit?: () => void;
  selectedStopId: string;
  onSelectStop: (id: string) => void;
  /** The Type select. It leads the row that also holds the angle, reverse and rotate. */
  typeControl?: ReactNode;
  /**
   * Opens the picker beside the panel for a stop's color. Without it a stop's
   * swatch only shows the color.
   */
  renderColorPicker?: RenderNestedColorPicker;
  disabled?: boolean;
  className?: string;
}

const PIN_SIZE = 20;
const PIN_CLASS =
  // guard:allow-raw-color — a pin keeps a white outline so every stop color reads against the bar, in either theme.
  "absolute top-0 cursor-grab rounded-md border-2 border-white active:cursor-grabbing";
const PIN_ZONE = 22;
const BAR_TOP = PIN_ZONE + 6;
const BAR_HEIGHT = 24;
const TRACK_HEIGHT = BAR_TOP + BAR_HEIGHT;

const ICON_BUTTON =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const FIELD =
  "flex h-6 min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)]";
const NUMBER_INPUT =
  "h-full min-w-0 flex-1 bg-transparent px-1.5 !text-[11px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus-visible:outline-none";

function StopPositionField({
  position,
  disabled,
  onCommit,
}: {
  position: number;
  disabled: boolean;
  onCommit: (position: number) => void;
}) {
  const shown = String(Math.round(position));
  const [draft, setDraft] = useState(shown);
  const draftRef = useRef(shown);
  const skipBlurRef = useRef(false);
  useEffect(() => {
    // Resync when the stop moves from outside: a drag on the bar, Reverse.
    draftRef.current = shown;
    setDraft(shown);
  }, [shown]);

  const revert = () => {
    draftRef.current = shown;
    setDraft(shown);
  };
  const commit = () => {
    const parsed = parseStopPositionDraft(draftRef.current);
    if (parsed === null) {
      revert();
      return;
    }
    onCommit(parsed);
  };

  return (
    <div className={FIELD}>
      <input
        type="number"
        min={0}
        max={100}
        aria-label={"Stop position" /* i18n-ignore */}
        disabled={disabled}
        value={draft}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
        }}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            skipBlurRef.current = true;
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            revert();
            skipBlurRef.current = true;
            event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit();
        }}
        className={NUMBER_INPUT}
      />
      <span className="shrink-0 pr-1.5 !text-[11px] text-muted-foreground">
        {"%" /* i18n-ignore */}
      </span>
    </div>
  );
}

/** One stop: `0% · swatch · 171717 · 100 % · −`, with the swatch opening its picker. */
function StopRow({
  stop,
  selected,
  canRemove,
  disabled,
  renderColorPicker,
  onSelect,
  onPosition,
  onColor,
  onColorCommit,
  onRemove,
}: {
  stop: GradientStopValue;
  selected: boolean;
  canRemove: boolean;
  disabled: boolean;
  renderColorPicker?: RenderNestedColorPicker;
  onSelect: () => void;
  onPosition: (position: number) => void;
  onColor: (css: string) => void;
  onColorCommit: (css: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const rowRef = useRef<HTMLDivElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <div
        ref={rowRef}
        data-stop-row
        data-stop-id={stop.id}
        data-selected={selected ? "" : undefined}
        // A click on the row's own space focuses the row, so Backspace there
        // removes the selected stop instead of landing on the popover.
        tabIndex={-1}
        onPointerDownCapture={onSelect}
        onFocusCapture={onSelect}
        className={cn(
          "grid h-8 grid-cols-[3.5rem_minmax(0,1fr)_1.5rem] items-center gap-2 px-3 focus-visible:outline-none",
          selected && "bg-primary/10",
        )}
      >
        <StopPositionField
          position={stop.position}
          disabled={disabled}
          onCommit={onPosition}
        />
        <div className={cn(FIELD, "gap-2 px-1.5")}>
          <button
            type="button"
            aria-label={t("editPanel.colorPicker.editStopColor")}
            disabled={disabled || !renderColorPicker}
            onClick={() => setPickerAnchor(rowRef.current)}
            className="size-4 shrink-0 rounded-[3px] border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            style={swatchStyle(stop.color)}
          />
          <ColorValueField
            css={stop.color}
            ariaLabel={t("editPanel.colorPicker.stopColor")}
            disabled={disabled}
            className="flex-1"
            onCommit={onColorCommit}
          />
          <OpacityValueField
            css={stop.color}
            ariaLabel={t("editPanel.colorPicker.stopOpacity")}
            disabled={disabled}
            className="w-7 shrink-0 text-right"
            onCommit={onColorCommit}
          />
          <span className="-ml-1 shrink-0 !text-[11px] text-muted-foreground">
            {"%" /* i18n-ignore */}
          </span>
        </div>
        <button
          type="button"
          disabled={disabled || !canRemove}
          aria-label={"Remove stop" /* i18n-ignore */}
          onClick={onRemove}
          className={ICON_BUTTON}
        >
          <IconMinus className="size-4" />
        </button>
      </div>
      {pickerAnchor
        ? renderColorPicker?.({
            anchor: pickerAnchor,
            css: stop.color,
            onChange: onColor,
            onCommit: onColorCommit,
            onClose: () => setPickerAnchor(null),
          })
        : null}
    </>
  );
}

export function GradientEditor({
  value,
  onChange,
  onCommit,
  selectedStopId,
  onSelectStop,
  typeControl,
  renderColorPicker,
  disabled = false,
  className,
}: GradientEditorProps) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const draggingStopRef = useRef<string | null>(null);
  const stopDragMovedRef = useRef(false);
  const barClickRef = useRef<{ moved: boolean; startX: number } | null>(null);
  const pinRefs = useRef(new Map<string, HTMLButtonElement>());
  // The pin that should hold focus once it is on screen: one just added, or
  // the one a removal selected.
  const focusPinRef = useRef<string | null>(null);

  useEffect(() => {
    const id = focusPinRef.current;
    const pin = id ? pinRefs.current.get(id) : undefined;
    if (!pin) return;
    focusPinRef.current = null;
    pin.focus({ preventScroll: true });
  });

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

  const updateStopColor = (id: string, color: string) => {
    onChange({
      ...value,
      stops: value.stops.map((stop) =>
        stop.id === id ? { ...stop, color } : stop,
      ),
    });
  };

  const addStopAt = (position: number, focusPin = false) => {
    const newStop: GradientStopValue = {
      id: nextStopId(),
      color: colorAtPosition(value.stops, position),
      position,
    };
    onChange({ ...value, stops: [...value.stops, newStop] });
    onSelectStop(newStop.id);
    if (focusPin) focusPinRef.current = newStop.id;
    onCommit?.();
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
    addStopAt(positionFromPointer(event.clientX), true);
  };

  const startStopDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (disabled) return;
    event.stopPropagation();
    // Cancelling pointerdown (it starts a drag) also cancels the browser's
    // focus change. The pin takes focus itself: otherwise Backspace goes to
    // whatever held focus before, never to this editor.
    event.preventDefault();
    onSelectStop(id);
    draggingStopRef.current = id;
    stopDragMovedRef.current = false;
    event.currentTarget.focus({ preventScroll: true });
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

  // A gradient keeps at least two stops.
  const canRemoveStop = value.stops.length > 2;
  const removeStop = (id: string) => {
    if (!canRemoveStop) return;
    const removed = value.stops.find((stop) => stop.id === id);
    if (!removed) return;
    const nextStops = value.stops.filter((stop) => stop.id !== id);
    onChange({ ...value, stops: nextStops });
    const nextSelected =
      selectedStopId === id
        ? (nearestStopId(nextStops, removed.position) ?? "")
        : selectedStopId;
    if (selectedStopId === id) onSelectStop(nextSelected);
    // The focused pin or button is gone. Focus on the body would let the next
    // Backspace through to the canvas, so it moves to the stop now selected.
    focusPinRef.current = nextSelected;
    onCommit?.();
  };

  const setAngle = (angle: number) => {
    onChange({ ...value, angle: ((angle % 360) + 360) % 360 });
  };

  const reverseStops = () => {
    onChange({
      ...value,
      stops: value.stops.map((stop) => ({
        ...stop,
        position: round(100 - stop.position),
      })),
    });
    onCommit?.();
  };

  const rotate = () => {
    setAngle(value.angle + 90);
    onCommit?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.defaultPrevented) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    // The picker beside the panel is portalled out of this editor's DOM.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if ((event.target as HTMLElement).closest("input, textarea, select")) {
      return;
    }
    event.preventDefault();
    removeStop(selectedStopId);
  };

  const showAngle = value.kind === "linear" || value.kind === "angular";

  return (
    <div className={cn("select-none", className)} onKeyDown={handleKeyDown}>
      {/* ── Type, angle, reverse, rotate ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="w-[136px] min-w-0 shrink">{typeControl}</div>
        <div className="flex-1" />
        {showAngle && (
          <div className={cn(FIELD, "w-14 shrink-0")}>
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
              className={NUMBER_INPUT}
            />
            <span className="shrink-0 pr-1.5 !text-[11px] text-muted-foreground">
              °
            </span>
          </div>
        )}
        <button
          type="button"
          disabled={disabled}
          aria-label={t("editPanel.colorPicker.reverseStops")}
          title={t("editPanel.colorPicker.reverseStops")}
          onClick={reverseStops}
          className={ICON_BUTTON}
        >
          <IconSwitchHorizontal className="size-4" />
        </button>
        <button
          type="button"
          disabled={disabled || !showAngle}
          aria-label={t("editPanel.colorPicker.rotateGradient")}
          title={t("editPanel.colorPicker.rotateGradient")}
          onClick={rotate}
          className={ICON_BUTTON}
        >
          <IconRotate2 className="size-4" />
        </button>
      </div>

      {/* ── Pins above the bar; clicking the bar adds one ────────────────────── */}
      <div className="px-3 pt-2">
        <div
          className="relative"
          style={{ height: TRACK_HEIGHT }}
          onPointerMove={handleBarPointerMove}
        >
          <div
            className="absolute left-0 right-0 rounded-md"
            style={{
              top: BAR_TOP,
              height: BAR_HEIGHT,
              backgroundImage: CHECKERBOARD_IMAGE,
              backgroundColor: CHECKER_B,
              backgroundSize: "8px 8px",
            }}
            aria-hidden="true"
          />
          <div
            ref={barRef}
            role="group"
            aria-label={"Gradient stops" /* i18n-ignore */}
            onPointerDown={handleBarPointerDown}
            onPointerUp={(e) => handleBarClick(e)}
            className={cn(
              "absolute left-0 right-0 cursor-copy rounded-md border border-border/50",
              disabled && "cursor-not-allowed opacity-60",
            )}
            style={{
              top: BAR_TOP,
              height: BAR_HEIGHT,
              backgroundImage: stopsBarCss(value.stops),
            }}
          />

          {value.stops.map((stop) => {
            const isSelected = stop.id === selectedStopId;
            const solidColor = withCssColorAlpha(stop.color, 1) ?? stop.color;

            return (
              <button
                key={stop.id}
                ref={(node) => {
                  if (node) pinRefs.current.set(stop.id, node);
                  else pinRefs.current.delete(stop.id);
                }}
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
                  PIN_CLASS,
                  "focus-visible:outline-none",
                  isSelected
                    ? "z-10 shadow-[0_0_0_1.5px_var(--primary),0_1px_3px_rgba(0,0,0,0.35)]"
                    : "shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.25)]",
                )}
                style={{
                  width: PIN_SIZE,
                  height: PIN_SIZE,
                  left: `${stop.position}%`,
                  transform: "translateX(-50%)",
                  backgroundColor: solidColor,
                }}
              >
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-full mt-0.75 size-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-primary"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Stops ────────────────────────────────────────────────────────────── */}
      <div className="mt-1 flex h-8 items-center justify-between px-3">
        <span className="!text-[11px] font-medium text-foreground">
          {t("editPanel.colorPicker.stops")}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("editPanel.colorPicker.addStop")}
          title={t("editPanel.colorPicker.addStop")}
          onClick={() => addStopAt(nextStopPosition(value.stops))}
          className={ICON_BUTTON}
        >
          <IconPlus className="size-4" />
        </button>
      </div>
      <div className="mt-1 pb-1">
        {sortedStops(value.stops).map((stop) => (
          <StopRow
            key={stop.id}
            stop={stop}
            selected={stop.id === selectedStopId}
            canRemove={canRemoveStop}
            disabled={disabled}
            renderColorPicker={renderColorPicker}
            onSelect={() => onSelectStop(stop.id)}
            onPosition={(position) => {
              updateStopPosition(stop.id, position);
              onCommit?.();
            }}
            onColor={(css) => updateStopColor(stop.id, css)}
            onColorCommit={(css) => {
              updateStopColor(stop.id, css);
              onCommit?.();
            }}
            onRemove={() => removeStop(stop.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function __resetStopCounterForTest(): void {
  stopCounter = 0;
}
