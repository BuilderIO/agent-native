import {
  Select,
  SelectContent,
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
// The preview box is 40×40px (size-10). Inside it sits a 16×16px inner rect
// (representing the element) centered at (20,20). The four edge pins are thin
// bars that can be toggled on/off; a center-cross appears for "center" mode.
//
//  Edge pins: 6px long, 1.5px wide, placed 2px from the box edge.
//    left  : x=2..8,  y center=20
//    right : x=32..38, y center=20
//    top   : x center=20, y=2..8
//    bottom: x center=20, y=32..38
//
//  Center marker: a 4px dot at (20,20) for h=center or v=center.

const BOX = 40; // viewBox width/height (matches size-10 = 40px)
const INNER = 16; // inner rect size
const INNER_X = (BOX - INNER) / 2; // 12
const INNER_Y = (BOX - INNER) / 2; // 12
const PIN_LEN = 6;
const PIN_W = 1.5;
const MARGIN = 2; // gap between box edge and pin start
const CENTER = BOX / 2; // 20

// Returns whether a given horizontal pin should be active.
function hPinActive(side: "left" | "right", h: HorizontalConstraint): boolean {
  if (side === "left") return h === "left" || h === "left-right";
  return h === "right" || h === "left-right";
}

function vPinActive(side: "top" | "bottom", v: VerticalConstraint): boolean {
  if (side === "top") return v === "top" || v === "top-bottom";
  return v === "bottom" || v === "top-bottom";
}

// Clicking a left/right pin cycles: if that side is the only active one →
// "left-right"; if "left-right" → single side; if neither → single side.
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
  onToggleH: (side: "left" | "right") => void;
  onToggleV: (side: "top" | "bottom") => void;
}

function PinBox({ value, disabled, onToggleH, onToggleV }: PinBoxProps) {
  const leftOn = hPinActive("left", value.horizontal);
  const rightOn = hPinActive("right", value.horizontal);
  const topOn = vPinActive("top", value.vertical);
  const bottomOn = vPinActive("bottom", value.vertical);
  const hCenter = value.horizontal === "center";
  const vCenter = value.vertical === "center";
  const hScale = value.horizontal === "scale";
  const vScale = value.vertical === "scale";

  // Hit-area size for each pin button (larger than the visual stroke for
  // easy clicking — 8×8 centered on the pin midpoint).
  const HIT = 8;

  return (
    <svg
      width={BOX}
      height={BOX}
      viewBox={`0 0 ${BOX} ${BOX}`}
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-sm",
        disabled && "pointer-events-none opacity-40",
      )}
      style={{ background: "hsl(var(--muted) / 0.3)" }}
    >
      {/* outer border */}
      <rect
        x={0.75}
        y={0.75}
        width={BOX - 1.5}
        height={BOX - 1.5}
        rx={3}
        fill="none"
        stroke="hsl(var(--border))"
        strokeWidth={1.5}
      />

      {/* inner element rect */}
      <rect
        x={INNER_X}
        y={INNER_Y}
        width={INNER}
        height={INNER}
        rx={1.5}
        fill="hsl(var(--background))"
        stroke="hsl(var(--foreground) / 0.5)"
        strokeWidth={1}
      />

      {/* scale dashed overlay */}
      {(hScale || vScale) && (
        <rect
          x={INNER_X + 1}
          y={INNER_Y + 1}
          width={INNER - 2}
          height={INNER - 2}
          rx={1}
          fill="none"
          stroke="hsl(var(--primary) / 0.8)"
          strokeWidth={1}
          strokeDasharray="2 1.5"
        />
      )}

      {/* center cross for h-center or v-center */}
      {(hCenter || vCenter) && (
        <>
          {hCenter && (
            <line
              x1={INNER_X - 2}
              y1={CENTER}
              x2={INNER_X + INNER + 2}
              y2={CENTER}
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
            />
          )}
          {vCenter && (
            <line
              x1={CENTER}
              y1={INNER_Y - 2}
              x2={CENTER}
              y2={INNER_Y + INNER + 2}
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
            />
          )}
        </>
      )}

      {/* edge pins — visual strokes */}
      {/* left pin */}
      <line
        x1={MARGIN}
        y1={CENTER}
        x2={MARGIN + PIN_LEN}
        y2={CENTER}
        stroke={
          leftOn ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.35)"
        }
        strokeWidth={PIN_W}
        strokeLinecap="round"
      />
      {/* right pin */}
      <line
        x1={BOX - MARGIN}
        y1={CENTER}
        x2={BOX - MARGIN - PIN_LEN}
        y2={CENTER}
        stroke={
          rightOn ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.35)"
        }
        strokeWidth={PIN_W}
        strokeLinecap="round"
      />
      {/* top pin */}
      <line
        x1={CENTER}
        y1={MARGIN}
        x2={CENTER}
        y2={MARGIN + PIN_LEN}
        stroke={topOn ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.35)"}
        strokeWidth={PIN_W}
        strokeLinecap="round"
      />
      {/* bottom pin */}
      <line
        x1={CENTER}
        y1={BOX - MARGIN}
        x2={CENTER}
        y2={BOX - MARGIN - PIN_LEN}
        stroke={
          bottomOn ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.35)"
        }
        strokeWidth={PIN_W}
        strokeLinecap="round"
      />

      {/* invisible click targets — rendered on top of strokes */}
      {!disabled && (
        <>
          {/* left pin hit area */}
          <rect
            x={MARGIN - HIT / 2}
            y={CENTER - HIT / 2}
            width={PIN_LEN + HIT}
            height={HIT}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleH("left")}
            role="button"
            aria-label="Toggle left pin"
          />
          {/* right pin hit area */}
          <rect
            x={BOX - MARGIN - PIN_LEN - HIT / 2}
            y={CENTER - HIT / 2}
            width={PIN_LEN + HIT}
            height={HIT}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleH("right")}
            role="button"
            aria-label="Toggle right pin"
          />
          {/* top pin hit area */}
          <rect
            x={CENTER - HIT / 2}
            y={MARGIN - HIT / 2}
            width={HIT}
            height={PIN_LEN + HIT}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleV("top")}
            role="button"
            aria-label="Toggle top pin"
          />
          {/* bottom pin hit area */}
          <rect
            x={CENTER - HIT / 2}
            y={BOX - MARGIN - PIN_LEN - HIT / 2}
            width={HIT}
            height={PIN_LEN + HIT}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleV("bottom")}
            role="button"
            aria-label="Toggle bottom pin"
          />
        </>
      )}
    </svg>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

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
    <div className={cn("space-y-1.5", className)}>
      {/* section label */}
      <span className="text-[11px] font-medium text-muted-foreground">
        {copy.title}
      </span>

      {/* main row: pin-box LEFT + dropdowns RIGHT */}
      <div className="flex items-center gap-2">
        {/* pin box */}
        <PinBox
          value={value}
          disabled={disabled}
          onToggleH={handleToggleH}
          onToggleV={handleToggleV}
        />

        {/* dropdowns column */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* horizontal constraint */}
          <Select
            value={value.horizontal}
            onValueChange={(next) =>
              onChange({ ...value, horizontal: next as HorizontalConstraint })
            }
            disabled={disabled}
          >
            <SelectTrigger
              className="h-6 w-full px-1.5 text-[11px]"
              aria-label={copy.horizontal}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left" className="text-[11px]">
                {copy.left}
              </SelectItem>
              <SelectItem value="right" className="text-[11px]">
                {copy.right}
              </SelectItem>
              <SelectItem value="left-right" className="text-[11px]">
                {copy.leftRight}
              </SelectItem>
              <SelectItem value="center" className="text-[11px]">
                {copy.center}
              </SelectItem>
              <SelectItem value="scale" className="text-[11px]">
                {copy.scale}
              </SelectItem>
            </SelectContent>
          </Select>

          {/* vertical constraint */}
          <Select
            value={value.vertical}
            onValueChange={(next) =>
              onChange({ ...value, vertical: next as VerticalConstraint })
            }
            disabled={disabled}
          >
            <SelectTrigger
              className="h-6 w-full px-1.5 text-[11px]"
              aria-label={copy.vertical}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top" className="text-[11px]">
                {copy.top}
              </SelectItem>
              <SelectItem value="bottom" className="text-[11px]">
                {copy.bottom}
              </SelectItem>
              <SelectItem value="top-bottom" className="text-[11px]">
                {copy.topBottom}
              </SelectItem>
              <SelectItem value="center" className="text-[11px]">
                {copy.center}
              </SelectItem>
              <SelectItem value="scale" className="text-[11px]">
                {copy.scale}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
