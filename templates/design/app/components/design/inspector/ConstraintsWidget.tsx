import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type HorizontalConstraint =
  | "left"
  | "right"
  | "left-right"
  | "center"
  | "scale";
export type VerticalConstraint =
  | "top"
  | "bottom"
  | "top-bottom"
  | "center"
  | "scale";

export interface ConstraintsValue {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
}

export interface ConstraintsWidgetLabels {
  title: string;
  horizontal: string;
  vertical: string;
  left: string;
  right: string;
  leftRight: string;
  top: string;
  bottom: string;
  topBottom: string;
  center: string;
  scale: string;
}

export interface ConstraintsWidgetProps {
  value: ConstraintsValue;
  onChange: (value: ConstraintsValue) => void;
  labels?: Partial<ConstraintsWidgetLabels>;
  disabled?: boolean;
  className?: string;
}

export interface ConstraintsPreviewProps {
  value: ConstraintsValue;
  labels?: Partial<ConstraintsWidgetLabels>;
  disabled?: boolean;
  size?: number;
  surface?: boolean;
  className?: string;
}

const DEFAULT_LABELS: ConstraintsWidgetLabels = {
  title: "Constraints", // i18n-ignore fallback component label
  horizontal: "Horizontal", // i18n-ignore fallback component label
  vertical: "Vertical", // i18n-ignore fallback component label
  left: "Left", // i18n-ignore fallback component label
  right: "Right", // i18n-ignore fallback component label
  leftRight: "Left and right", // i18n-ignore fallback component label
  top: "Top", // i18n-ignore fallback component label
  bottom: "Bottom", // i18n-ignore fallback component label
  topBottom: "Top and bottom", // i18n-ignore fallback component label
  center: "Center", // i18n-ignore fallback component label
  scale: "Scale", // i18n-ignore fallback component label
};

// ── pin-box geometry ────────────────────────────────────────────────────────
// The preview box is 40×40px (size-10). Inside it sits an 18×14px inner rect
// (representing a child element) centered at (20,20). The proportions match
// the design editor's "little box" widget — inner rect is ~45–50% of the outer box width
// and slightly shorter in height to resemble a real element.
//
// Edge pins: 5px long, 2px wide, placed 2px from the box edge (flush to border).
//   left  : x=2..7,   y center=20
//   right : x=33..38, y center=20
//   top   : x center=20, y=2..7
//   bottom: x center=20, y=33..38
//
// Gap between pin tip and inner rect edge:
//   left  : inner left edge at x=11 → gap from x=7 to x=11  (4px)
//   right : inner right edge at x=29 → gap from x=29 to x=33 (4px)
//   top   : inner top edge at y=13  → gap from y=7 to y=13  (6px)
//   bottom: inner bottom edge at y=27 → gap from y=27 to y=33 (6px)
//
// Center marker: for h=center or v=center, a single accent line runs through
// the full width/height of the box (including through the inner rect), drawn
// on top at the midpoint — matching the design editor's solid crosshair treatment.
//
// Scale mode: all four pins on that axis render dashed, accent color.

const BOX = 40; // viewBox width/height (matches size-10 = 40px)
const INNER_W = 18; // inner rect width
const INNER_H = 14; // inner rect height (slightly shorter than wide = realistic element)
const INNER_X = (BOX - INNER_W) / 2; // 11
const INNER_Y = (BOX - INNER_H) / 2; // 13
const PIN_LEN = 5; // visual pin length
const PIN_W = 2; // pin stroke width (design editor: 2px thick pins)
const MARGIN = 2; // gap between outer box edge and pin start
const CENTER = BOX / 2; // 20

// Returns whether a given horizontal pin should be active (solid/accent).
function hPinActive(side: "left" | "right", h: HorizontalConstraint): boolean {
  if (side === "left") return h === "left" || h === "left-right";
  return h === "right" || h === "left-right";
}

function vPinActive(side: "top" | "bottom", v: VerticalConstraint): boolean {
  if (side === "top") return v === "top" || v === "top-bottom";
  return v === "bottom" || v === "top-bottom";
}

// Clicking a left/right pin cycles the constraint:
//   - if that side is the only active one → "left-right"
//   - if "left-right" or scale/center → single side
//   - if neither active → single side
// Can't clear both sides; reverts to single side instead.
function toggleHPin(
  side: "left" | "right",
  current: HorizontalConstraint,
): HorizontalConstraint {
  const leftOn = current === "left" || current === "left-right";
  const rightOn = current === "right" || current === "left-right";
  if (side === "left") {
    const nextLeft = !leftOn;
    if (nextLeft && rightOn) return "left-right";
    if (nextLeft) return "left";
    if (rightOn) return "right";
    return "left"; // can't clear both — revert to left
  } else {
    const nextRight = !rightOn;
    if (leftOn && nextRight) return "left-right";
    if (nextRight) return "right";
    if (leftOn) return "left";
    return "right"; // can't clear both — revert to right
  }
}

function toggleVPin(
  side: "top" | "bottom",
  current: VerticalConstraint,
): VerticalConstraint {
  const topOn = current === "top" || current === "top-bottom";
  const bottomOn = current === "bottom" || current === "top-bottom";
  if (side === "top") {
    const nextTop = !topOn;
    if (nextTop && bottomOn) return "top-bottom";
    if (nextTop) return "top";
    if (bottomOn) return "bottom";
    return "top";
  } else {
    const nextBottom = !bottomOn;
    if (topOn && nextBottom) return "top-bottom";
    if (nextBottom) return "bottom";
    if (topOn) return "top";
    return "bottom";
  }
}

// ── PinBox SVG ───────────────────────────────────────────────────────────────

interface PinBoxProps {
  value: ConstraintsValue;
  disabled: boolean;
  labels: Pick<ConstraintsWidgetLabels, "left" | "right" | "top" | "bottom">;
  onToggleH: (side: "left" | "right") => void;
  onToggleV: (side: "top" | "bottom") => void;
  interactive?: boolean;
  size?: number;
  surface?: boolean;
  className?: string;
}

function PinBox({
  value,
  disabled,
  labels,
  onToggleH,
  onToggleV,
  interactive = true,
  size = BOX,
  surface = true,
  className,
}: PinBoxProps) {
  const [hoveredPin, setHoveredPin] = useState<
    "left" | "right" | "top" | "bottom" | null
  >(null);

  const leftOn = hPinActive("left", value.horizontal);
  const rightOn = hPinActive("right", value.horizontal);
  const topOn = vPinActive("top", value.vertical);
  const bottomOn = vPinActive("bottom", value.vertical);
  const hCenter = value.horizontal === "center";
  const vCenter = value.vertical === "center";
  const hScale = value.horizontal === "scale";
  const vScale = value.vertical === "scale";

  // Colors:
  //   active / scale → accent (primary)
  //   hovered inactive → slightly brighter muted
  //   inactive → muted (30% foreground opacity)
  const ACCENT = "var(--design-editor-accent-color, hsl(var(--primary)))";
  // Hover: lighten inactive pins on hover — use 55% opacity instead of 30%
  const MUTED = "hsl(var(--foreground) / 0.30)";
  const MUTED_HOVER = "hsl(var(--foreground) / 0.60)";
  const SCALE_DASH = "3 2";

  // Hit-area size for each pin (larger than the visual stroke for easy clicking
  // — 10px wide / 14px tall centered on the pin midpoint).
  const HIT_CROSS = 10; // perpendicular extent of hit area
  const HIT_LONG = 14; // along-pin extent of hit area (covers pin + gap to inner rect)

  // Pin color: accent when active or scale; hover-boosted or muted when inactive.
  function pinColor(
    side: "left" | "right" | "top" | "bottom",
    isActive: boolean,
    isScale: boolean,
  ): string {
    if (isActive || isScale) return ACCENT;
    if (hoveredPin === side) return MUTED_HOVER;
    return MUTED;
  }

  const lColor = pinColor("left", leftOn, hScale);
  const rColor = pinColor("right", rightOn, hScale);
  const tColor = pinColor("top", topOn, vScale);
  const bColor = pinColor("bottom", bottomOn, vScale);

  const lDash = hScale ? SCALE_DASH : undefined;
  const rDash = hScale ? SCALE_DASH : undefined;
  const tDash = vScale ? SCALE_DASH : undefined;
  const bDash = vScale ? SCALE_DASH : undefined;

  // Pin end coordinates (tip = closer to inner rect)
  // left pin:   x from MARGIN to MARGIN+PIN_LEN, y=CENTER
  // right pin:  x from BOX-MARGIN to BOX-MARGIN-PIN_LEN, y=CENTER
  // top pin:    x=CENTER, y from MARGIN to MARGIN+PIN_LEN
  // bottom pin: x=CENTER, y from BOX-MARGIN to BOX-MARGIN-PIN_LEN

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-[5px]",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
      style={{
        background: surface
          ? "var(--design-editor-control-bg, hsl(var(--muted) / 0.4))"
          : "transparent",
      }}
    >
      {/* outer border */}
      <rect
        x={0.75}
        y={0.75}
        width={BOX - 1.5}
        height={BOX - 1.5}
        rx={2.5}
        fill="none"
        stroke="hsl(var(--foreground) / 0.20)"
        strokeWidth={1.5}
      />

      {/* inner element rect — represents the selected element */}
      <rect
        x={INNER_X}
        y={INNER_Y}
        width={INNER_W}
        height={INNER_H}
        rx={1}
        fill="hsl(var(--background))"
        stroke="hsl(var(--foreground) / 0.35)"
        strokeWidth={1}
      />

      {/* center crosshair lines — drawn THROUGH the full box width/height
          (including through the inner rect), matching the design editor's solid crosshair.
          Only rendered when the constraint is "center" on that axis.            */}
      {hCenter && (
        <line
          x1={MARGIN + PIN_LEN}
          y1={CENTER}
          x2={BOX - MARGIN - PIN_LEN}
          y2={CENTER}
          stroke={ACCENT}
          strokeWidth={1}
          strokeLinecap="round"
        />
      )}
      {vCenter && (
        <line
          x1={CENTER}
          y1={MARGIN + PIN_LEN}
          x2={CENTER}
          y2={BOX - MARGIN - PIN_LEN}
          stroke={ACCENT}
          strokeWidth={1}
          strokeLinecap="round"
        />
      )}

      {/* edge pins — visual strokes */}
      {/* left pin: from outer edge toward inner rect */}
      <line
        x1={MARGIN}
        y1={CENTER}
        x2={MARGIN + PIN_LEN}
        y2={CENTER}
        stroke={lColor}
        strokeWidth={PIN_W}
        strokeLinecap="round"
        strokeDasharray={lDash}
      />
      {/* right pin */}
      <line
        x1={BOX - MARGIN}
        y1={CENTER}
        x2={BOX - MARGIN - PIN_LEN}
        y2={CENTER}
        stroke={rColor}
        strokeWidth={PIN_W}
        strokeLinecap="round"
        strokeDasharray={rDash}
      />
      {/* top pin */}
      <line
        x1={CENTER}
        y1={MARGIN}
        x2={CENTER}
        y2={MARGIN + PIN_LEN}
        stroke={tColor}
        strokeWidth={PIN_W}
        strokeLinecap="round"
        strokeDasharray={tDash}
      />
      {/* bottom pin */}
      <line
        x1={CENTER}
        y1={BOX - MARGIN}
        x2={CENTER}
        y2={BOX - MARGIN - PIN_LEN}
        stroke={bColor}
        strokeWidth={PIN_W}
        strokeLinecap="round"
        strokeDasharray={bDash}
      />

      {/* invisible click + hover targets — rendered on top of strokes */}
      {interactive && !disabled && (
        <>
          {/* left pin hit area */}
          <rect
            x={0}
            y={CENTER - HIT_CROSS / 2}
            width={MARGIN + PIN_LEN + HIT_LONG / 2}
            height={HIT_CROSS}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleH("left")}
            onMouseEnter={() => setHoveredPin("left")}
            onMouseLeave={() => setHoveredPin(null)}
            role="button"
            aria-label={labels.left}
          />
          {/* right pin hit area */}
          <rect
            x={BOX - MARGIN - PIN_LEN - HIT_LONG / 2}
            y={CENTER - HIT_CROSS / 2}
            width={MARGIN + PIN_LEN + HIT_LONG / 2}
            height={HIT_CROSS}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleH("right")}
            onMouseEnter={() => setHoveredPin("right")}
            onMouseLeave={() => setHoveredPin(null)}
            role="button"
            aria-label={labels.right}
          />
          {/* top pin hit area */}
          <rect
            x={CENTER - HIT_CROSS / 2}
            y={0}
            width={HIT_CROSS}
            height={MARGIN + PIN_LEN + HIT_LONG / 2}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleV("top")}
            onMouseEnter={() => setHoveredPin("top")}
            onMouseLeave={() => setHoveredPin(null)}
            role="button"
            aria-label={labels.top}
          />
          {/* bottom pin hit area */}
          <rect
            x={CENTER - HIT_CROSS / 2}
            y={BOX - MARGIN - PIN_LEN - HIT_LONG / 2}
            width={HIT_CROSS}
            height={MARGIN + PIN_LEN + HIT_LONG / 2}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleV("bottom")}
            onMouseEnter={() => setHoveredPin("bottom")}
            onMouseLeave={() => setHoveredPin(null)}
            role="button"
            aria-label={labels.bottom}
          />
        </>
      )}
    </svg>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export function ConstraintsPreview({
  value,
  labels,
  disabled = false,
  size = 22,
  surface = false,
  className,
}: ConstraintsPreviewProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };

  return (
    <PinBox
      value={value}
      disabled={disabled}
      labels={copy}
      onToggleH={() => undefined}
      onToggleV={() => undefined}
      interactive={false}
      size={size}
      surface={surface}
      className={className}
    />
  );
}

function ConstraintSelect({
  axis,
  value,
  onChange,
  disabled,
  labels,
}: {
  axis: "horizontal" | "vertical";
  value: HorizontalConstraint | VerticalConstraint;
  onChange: (value: HorizontalConstraint | VerticalConstraint) => void;
  disabled: boolean;
  labels: ConstraintsWidgetLabels;
}) {
  const options =
    axis === "horizontal"
      ? [
          { value: "left", label: labels.left },
          { value: "right", label: labels.right },
          { value: "left-right", label: labels.leftRight },
          { value: "center", label: labels.center },
          { value: "scale", label: labels.scale },
        ]
      : [
          { value: "top", label: labels.top },
          { value: "bottom", label: labels.bottom },
          { value: "top-bottom", label: labels.topBottom },
          { value: "center", label: labels.center },
          { value: "scale", label: labels.scale },
        ];

  return (
    <Select
      value={value}
      onValueChange={(next) =>
        onChange(next as HorizontalConstraint | VerticalConstraint)
      }
      disabled={disabled}
    >
      <SelectTrigger
        className="h-8 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-[12px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)] focus:ring-offset-0 [&>svg]:size-3"
        aria-label={axis === "horizontal" ? labels.horizontal : labels.vertical}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[270]">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="text-[12px]"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ConstraintsWidget({
  value,
  onChange,
  labels,
  disabled = false,
  className,
}: ConstraintsWidgetProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };

  function handleToggleH(side: "left" | "right") {
    onChange({ ...value, horizontal: toggleHPin(side, value.horizontal) });
  }

  function handleToggleV(side: "top" | "bottom") {
    onChange({ ...value, vertical: toggleVPin(side, value.vertical) });
  }

  return (
    <div className={cn("space-y-2", className)}>
      <span className="!text-[11px] font-medium text-muted-foreground">
        {copy.title}
      </span>

      <div className="grid grid-cols-[minmax(0,1fr)_4rem] items-stretch gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <ConstraintSelect
            axis="horizontal"
            value={value.horizontal}
            onChange={(next) =>
              onChange({ ...value, horizontal: next as HorizontalConstraint })
            }
            disabled={disabled}
            labels={copy}
          />
          <ConstraintSelect
            axis="vertical"
            value={value.vertical}
            onChange={(next) =>
              onChange({ ...value, vertical: next as VerticalConstraint })
            }
            disabled={disabled}
            labels={copy}
          />
        </div>
        <PinBox
          value={value}
          disabled={disabled}
          labels={copy}
          onToggleH={handleToggleH}
          onToggleV={handleToggleV}
          size={64}
        />
      </div>
    </div>
  );
}
