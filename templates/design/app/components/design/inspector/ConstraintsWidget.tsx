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
// bars that can be toggled on/off. When an axis is in "scale" mode the pins
// on that axis render dashed. When an axis is in "center" mode a center-line
// is drawn through the inner rect on that axis.
//
//  Edge pins: 6px long, 1.5px wide, placed 2px from the box edge.
//    left  : x=2..8,  y center=20
//    right : x=32..38, y center=20
//    top   : x center=20, y=2..8
//    bottom: x center=20, y=32..38
//
//  Center marker: a line through the inner rect midpoint for h=center or v=center.

const BOX = 40; // viewBox width/height (matches size-10 = 40px)
const INNER = 16; // inner rect size
const INNER_X = (BOX - INNER) / 2; // 12
const INNER_Y = (BOX - INNER) / 2; // 12
const PIN_LEN = 6;
const PIN_W = 1.5;
const MARGIN = 2; // gap between box edge and pin start
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
}

function PinBox({
  value,
  disabled,
  labels,
  onToggleH,
  onToggleV,
}: PinBoxProps) {
  const leftOn = hPinActive("left", value.horizontal);
  const rightOn = hPinActive("right", value.horizontal);
  const topOn = vPinActive("top", value.vertical);
  const bottomOn = vPinActive("bottom", value.vertical);
  const hCenter = value.horizontal === "center";
  const vCenter = value.vertical === "center";
  const hScale = value.horizontal === "scale";
  const vScale = value.vertical === "scale";

  // Pin rendering helpers:
  //   active  → accent color, solid
  //   scale   → accent color, dashed (Figma: Scale makes pins dashed)
  //   inactive → muted/dim, solid
  const ACCENT = "hsl(var(--primary))";
  const MUTED = "hsl(var(--foreground) / 0.30)";
  const SCALE_DASH = "3 2";

  // Hit-area size for each pin button (larger than the visual stroke for
  // easy clicking — 10×10 centered on the pin midpoint).
  const HIT = 10;

  // Pin color: accent when active or scale, muted otherwise.
  const lColor = leftOn || hScale ? ACCENT : MUTED;
  const rColor = rightOn || hScale ? ACCENT : MUTED;
  const tColor = topOn || vScale ? ACCENT : MUTED;
  const bColor = bottomOn || vScale ? ACCENT : MUTED;

  // Dash: scale mode makes that axis's pins dashed.
  const lDash = hScale ? SCALE_DASH : undefined;
  const rDash = hScale ? SCALE_DASH : undefined;
  const tDash = vScale ? SCALE_DASH : undefined;
  const bDash = vScale ? SCALE_DASH : undefined;

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
        stroke="hsl(var(--foreground) / 0.40)"
        strokeWidth={1}
      />

      {/* center lines for h-center or v-center — run from box edge to inner rect edge */}
      {hCenter && (
        <>
          {/* left segment: outer box to inner rect left edge */}
          <line
            x1={MARGIN + PIN_LEN}
            y1={CENTER}
            x2={INNER_X}
            y2={CENTER}
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="2 1.5"
          />
          {/* right segment: inner rect right edge to outer box */}
          <line
            x1={INNER_X + INNER}
            y1={CENTER}
            x2={BOX - MARGIN - PIN_LEN}
            y2={CENTER}
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="2 1.5"
          />
        </>
      )}
      {vCenter && (
        <>
          {/* top segment: outer box to inner rect top edge */}
          <line
            x1={CENTER}
            y1={MARGIN + PIN_LEN}
            x2={CENTER}
            y2={INNER_Y}
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="2 1.5"
          />
          {/* bottom segment: inner rect bottom edge to outer box */}
          <line
            x1={CENTER}
            y1={INNER_Y + INNER}
            x2={CENTER}
            y2={BOX - MARGIN - PIN_LEN}
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="2 1.5"
          />
        </>
      )}

      {/* edge pins — visual strokes */}
      {/* left pin */}
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

      {/* invisible click targets — rendered on top of strokes */}
      {!disabled && (
        <>
          {/* left pin hit area — clamped to x>=0 */}
          <rect
            x={0}
            y={CENTER - HIT / 2}
            width={MARGIN + PIN_LEN + HIT / 2}
            height={HIT}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleH("left")}
            role="button"
            aria-label={labels.left}
          />
          {/* right pin hit area — clamped to x<=BOX */}
          <rect
            x={BOX - MARGIN - PIN_LEN - HIT / 2}
            y={CENTER - HIT / 2}
            width={MARGIN + PIN_LEN + HIT / 2}
            height={HIT}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleH("right")}
            role="button"
            aria-label={labels.right}
          />
          {/* top pin hit area — clamped to y>=0 */}
          <rect
            x={CENTER - HIT / 2}
            y={0}
            width={HIT}
            height={MARGIN + PIN_LEN + HIT / 2}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleV("top")}
            role="button"
            aria-label={labels.top}
          />
          {/* bottom pin hit area — clamped to y<=BOX */}
          <rect
            x={CENTER - HIT / 2}
            y={BOX - MARGIN - PIN_LEN - HIT / 2}
            width={HIT}
            height={MARGIN + PIN_LEN + HIT / 2}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onToggleV("bottom")}
            role="button"
            aria-label={labels.bottom}
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
          labels={copy}
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
