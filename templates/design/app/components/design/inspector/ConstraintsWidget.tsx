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
  | "scale"
  | "mixed";
export type VerticalConstraint =
  | "top"
  | "bottom"
  | "top-bottom"
  | "center"
  | "scale"
  | "mixed";

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
  mixed: string;
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
  mixed: "Mixed", // i18n-ignore fallback component label
};

const BOX = 40;
const INNER_W = 18;
const INNER_H = 14;
const INNER_X = (BOX - INNER_W) / 2;
const INNER_Y = (BOX - INNER_H) / 2;
const PIN_LEN = 5;
const PIN_W = 2;
const MARGIN = 2;
const CENTER = BOX / 2;

function hPinActive(side: "left" | "right", h: HorizontalConstraint): boolean {
  if (side === "left") return h === "left" || h === "left-right";
  return h === "right" || h === "left-right";
}

function vPinActive(side: "top" | "bottom", v: VerticalConstraint): boolean {
  if (side === "top") return v === "top" || v === "top-bottom";
  return v === "bottom" || v === "top-bottom";
}

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
    return "left";
  } else {
    const nextRight = !rightOn;
    if (leftOn && nextRight) return "left-right";
    if (nextRight) return "right";
    if (leftOn) return "left";
    return "right";
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

  const ACCENT = "var(--design-editor-accent-color, hsl(var(--primary)))";
  const MUTED = "hsl(var(--foreground) / 0.30)";
  const MUTED_HOVER = "hsl(var(--foreground) / 0.60)";
  const SCALE_DASH = "3 2";

  const HIT_CROSS = 10;
  const HIT_LONG = 14;

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
  const renderedOptions =
    value === "mixed"
      ? [{ value: "mixed", label: labels.mixed, disabled: true }, ...options]
      : options;

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
        {value === "mixed" ? labels.mixed : <SelectValue />}
      </SelectTrigger>
      <SelectContent className="z-[270]">
        <SelectGroup>
          {renderedOptions.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={"disabled" in option && option.disabled}
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
      <span className="design-sidebar-field-label text-muted-foreground">
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
