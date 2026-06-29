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
  distributeHorizontal: string;
  distributeVertical: string;
}

export interface AlignmentMatrixProps {
  value: AlignmentMatrixValue;
  onChange: (value: AlignmentMatrixValue) => void;
  onDistribute?: (axis: DistributionAxis) => void;
  labels?: Partial<AlignmentMatrixLabels>;
  disabled?: boolean;
  className?: string;
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
  distributeHorizontal: "Distribute horizontal spacing", // i18n-ignore fallback component label
  distributeVertical: "Distribute vertical spacing", // i18n-ignore fallback component label
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

/** Figma-style alignment cell: blue bars when active, faint dot when inactive. */
function AlignmentCell({
  horizontal,
  vertical,
  active,
  label,
  disabled,
  onClick,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  active: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  // The active cell shows blue bars representing the alignment direction.
  // Inactive cells show a small faint dot.
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
            "flex size-[26px] items-center justify-center rounded-sm transition-colors",
            "hover:bg-[var(--design-editor-control-bg)]",
            disabled && "pointer-events-none opacity-40",
          )}
        >
          {active ? (
            <AlignmentBars horizontal={horizontal} vertical={vertical} />
          ) : (
            <span
              className="block size-1 rounded-full bg-current opacity-25"
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
 * Renders the Figma-style blue bars for the active alignment cell.
 * The bars are drawn as short lines showing the items packed
 * against the given horizontal + vertical edge.
 */
function AlignmentBars({
  horizontal,
  vertical,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
}) {
  // We draw 2-3 small bars inside a tiny box to indicate alignment direction.
  // The bars are positioned based on which corner/edge is active.
  const accent = "var(--design-editor-accent-color, #18a0fb)";

  // Determine the transform for the inner bars container
  // based on alignment position within the 16×16 drawing area
  const justifyClass =
    horizontal === "left"
      ? "justify-start"
      : horizontal === "right"
        ? "justify-end"
        : "justify-center";

  const alignClass =
    vertical === "top"
      ? "items-start"
      : vertical === "bottom"
        ? "items-end"
        : "items-center";

  return (
    <svg
      viewBox="0 0 14 14"
      width={14}
      height={14}
      fill="none"
      aria-hidden="true"
    >
      {/* Outer frame (faint) */}
      <rect
        x="0.5"
        y="0.5"
        width="13"
        height="13"
        rx="1"
        stroke={accent}
        strokeWidth="1"
        opacity="0.35"
      />
      {/* Inner content bars — positioned by alignment */}
      <AlignmentBarsContent
        horizontal={horizontal}
        vertical={vertical}
        accent={accent}
      />
    </svg>
  );
}

function AlignmentBarsContent({
  horizontal,
  vertical,
  accent,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  accent: string;
}) {
  // Draw 2 bars (representing child items) packed toward the alignment edge.
  // The bars are thin rectangles with rounded caps.
  const barH = 2; // bar height in px
  const barW = [4, 3]; // varying widths for visual interest
  const gap = 1.5; // gap between bars
  const totalH = barH * 2 + gap;
  const totalW = Math.max(...barW);

  // Y position based on vertical alignment
  const yStart =
    vertical === "top"
      ? 2.5
      : vertical === "bottom"
        ? 14 - 2.5 - totalH
        : (14 - totalH) / 2;

  // X positions for the bars based on horizontal alignment
  const getBarX = (w: number) => {
    if (horizontal === "left") return 2.5;
    if (horizontal === "right") return 14 - 2.5 - w;
    return (14 - w) / 2;
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
  onDistribute,
  labels,
  disabled = false,
  className,
}: AlignmentMatrixProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("space-y-0", className)}>
        {/* 3×3 dot grid — Figma style */}
        <div
          className={cn(
            "grid grid-cols-3 rounded-md border border-[var(--design-editor-control-border,hsl(var(--border)))]",
            "bg-[var(--design-editor-control-bg)] p-0.5",
          )}
          style={{ width: 84 }}
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
