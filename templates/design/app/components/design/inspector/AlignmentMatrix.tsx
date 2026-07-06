import type { ComponentType } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type AlignmentHorizontal = "left" | "center" | "right";
export type AlignmentVertical = "top" | "middle" | "bottom";
export type DistributionAxis = "horizontal" | "vertical";
export type FlowDirection = "horizontal" | "vertical";

export interface AlignmentMatrixValue {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
}

export interface AlignmentMatrixLabels {
  title: string;
  alignTopLeft: string;
  alignTopCenter: string;
  alignTopRight: string;
  alignMiddleLeft: string;
  alignCenter: string;
  alignMiddleRight: string;
  alignBottomLeft: string;
  alignBottomCenter: string;
  alignBottomRight: string;
}

export interface AlignmentMatrixProps {
  value: AlignmentMatrixValue;
  onChange: (value: AlignmentMatrixValue) => void;
  labels?: Partial<AlignmentMatrixLabels>;
  disabled?: boolean;
  className?: string;
  /** Auto-layout flow direction — controls bar orientation in active cell */
  direction?: FlowDirection;
}

type MatrixIcon = ComponentType<{ className?: string }>;

const DEFAULT_LABELS: AlignmentMatrixLabels = {
  title: "Align", // i18n-ignore fallback component label
  alignTopLeft: "Align top left", // i18n-ignore fallback component label
  alignTopCenter: "Align top center", // i18n-ignore fallback component label
  alignTopRight: "Align top right", // i18n-ignore fallback component label
  alignMiddleLeft: "Align middle left", // i18n-ignore fallback component label
  alignCenter: "Align center", // i18n-ignore fallback component label
  alignMiddleRight: "Align middle right", // i18n-ignore fallback component label
  alignBottomLeft: "Align bottom left", // i18n-ignore fallback component label
  alignBottomCenter: "Align bottom center", // i18n-ignore fallback component label
  alignBottomRight: "Align bottom right", // i18n-ignore fallback component label
};

const MATRIX_OPTIONS: Array<{
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  labelKey: keyof AlignmentMatrixLabels;
}> = [
  { horizontal: "left", vertical: "top", labelKey: "alignTopLeft" },
  { horizontal: "center", vertical: "top", labelKey: "alignTopCenter" },
  { horizontal: "right", vertical: "top", labelKey: "alignTopRight" },
  { horizontal: "left", vertical: "middle", labelKey: "alignMiddleLeft" },
  { horizontal: "center", vertical: "middle", labelKey: "alignCenter" },
  { horizontal: "right", vertical: "middle", labelKey: "alignMiddleRight" },
  { horizontal: "left", vertical: "bottom", labelKey: "alignBottomLeft" },
  { horizontal: "center", vertical: "bottom", labelKey: "alignBottomCenter" },
  { horizontal: "right", vertical: "bottom", labelKey: "alignBottomRight" },
];

/** design-editor alignment cell: blue bars when active, faint dot when inactive. */
function AlignmentCell({
  horizontal,
  vertical,
  active,
  label,
  disabled,
  direction,
  onClick,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  active: boolean;
  label: string;
  disabled: boolean;
  direction: FlowDirection;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-[22px] items-center justify-center rounded-sm transition-colors",
            "hover:bg-[var(--design-editor-control-bg)]",
            disabled && "pointer-events-none opacity-40",
          )}
        >
          {active ? (
            <AlignmentBars
              horizontal={horizontal}
              vertical={vertical}
              direction={direction}
            />
          ) : (
            <span
              className="block size-[3px] rounded-full bg-current opacity-20"
              aria-hidden="true"
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Renders the design-editor blue bars for the active alignment cell.
 *
 * Bar orientation matches the flow direction:
 * - HORIZONTAL flow → VERTICAL bars (tall, narrow), packed to the active
 *   horizontal edge (left/center/right), then aligned vertically.
 * - VERTICAL flow  → HORIZONTAL bars (wide, short), packed to the active
 *   vertical edge (top/middle/bottom), then aligned horizontally.
 *
 * No outer frame rect — the design editor's active cell shows only the bars.
 */
function AlignmentBars({
  horizontal,
  vertical,
  direction,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  direction: FlowDirection;
}) {
  const accent = "var(--design-editor-accent-color, #18a0fb)";
  const size = 14; // SVG canvas size

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      {direction === "horizontal" ? (
        <HorizontalFlowBars
          horizontal={horizontal}
          vertical={vertical}
          accent={accent}
          size={size}
        />
      ) : (
        <VerticalFlowBars
          horizontal={horizontal}
          vertical={vertical}
          accent={accent}
          size={size}
        />
      )}
    </svg>
  );
}

/**
 * HORIZONTAL flow: items are laid out left→right.
 * Bars are VERTICAL (tall, narrow) representing child items.
 * Packed toward the active horizontal edge; aligned vertically.
 */
function HorizontalFlowBars({
  horizontal,
  vertical,
  accent,
  size,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  accent: string;
  size: number;
}) {
  // Two vertical bars of slightly different heights for visual interest
  const barW = 2; // bar width
  const barH = [7, 5]; // bar heights
  const gap = 2; // gap between bars
  const margin = 1.5; // distance from edge

  // X positions: bars packed toward the horizontal alignment edge
  const totalW = barW * 2 + gap;
  const xStart =
    horizontal === "left"
      ? margin
      : horizontal === "right"
        ? size - margin - totalW
        : (size - totalW) / 2;

  // Y positions: each bar aligned to the vertical edge
  const getBarY = (h: number) => {
    if (vertical === "top") return margin;
    if (vertical === "bottom") return size - margin - h;
    return (size - h) / 2;
  };

  return (
    <>
      <rect
        x={xStart}
        y={getBarY(barH[0]!)}
        width={barW}
        height={barH[0]}
        rx={0.5}
        fill={accent}
      />
      <rect
        x={xStart + barW + gap}
        y={getBarY(barH[1]!)}
        width={barW}
        height={barH[1]}
        rx={0.5}
        fill={accent}
      />
    </>
  );
}

/**
 * VERTICAL flow: items are laid out top→bottom.
 * Bars are HORIZONTAL (wide, short) representing child items.
 * Packed toward the active vertical edge; aligned horizontally.
 */
function VerticalFlowBars({
  horizontal,
  vertical,
  accent,
  size,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  accent: string;
  size: number;
}) {
  // Two horizontal bars of slightly different widths for visual interest
  const barH = 2; // bar height
  const barW = [7, 5]; // bar widths
  const gap = 2; // gap between bars
  const margin = 1.5; // distance from edge

  // Y positions: bars packed toward the vertical alignment edge
  const totalH = barH * 2 + gap;
  const yStart =
    vertical === "top"
      ? margin
      : vertical === "bottom"
        ? size - margin - totalH
        : (size - totalH) / 2;

  // X positions: each bar aligned to the horizontal edge
  const getBarX = (w: number) => {
    if (horizontal === "left") return margin;
    if (horizontal === "right") return size - margin - w;
    return (size - w) / 2;
  };

  return (
    <>
      <rect
        x={getBarX(barW[0]!)}
        y={yStart}
        width={barW[0]}
        height={barH}
        rx={0.5}
        fill={accent}
      />
      <rect
        x={getBarX(barW[1]!)}
        y={yStart + barH + gap}
        width={barW[1]}
        height={barH}
        rx={0.5}
        fill={accent}
      />
    </>
  );
}

export function AlignmentMatrix({
  value,
  onChange,
  labels,
  disabled = false,
  className,
  direction = "horizontal",
}: AlignmentMatrixProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("flex flex-col gap-0", className)}>
        {/*
         * 3×3 dot grid — design-editor style.
         * NO border, NO background box — bare grid of cells.
         * Each cell is 22px; 3 cols = 66px total.
         */}
        <div
          className="grid grid-cols-3"
          style={{ width: 66 }}
          role="group"
          aria-label={copy.title}
        >
          {MATRIX_OPTIONS.map((option) => {
            const active =
              option.horizontal === value.horizontal &&
              option.vertical === value.vertical;
            return (
              <AlignmentCell
                key={`${option.horizontal}-${option.vertical}`}
                horizontal={option.horizontal}
                vertical={option.vertical}
                active={active}
                label={copy[option.labelKey]}
                disabled={disabled}
                direction={direction}
                onClick={() =>
                  onChange({
                    horizontal: option.horizontal,
                    vertical: option.vertical,
                  })
                }
              />
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
