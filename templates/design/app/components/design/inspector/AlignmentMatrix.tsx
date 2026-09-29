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
  direction?: FlowDirection;
}

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
  const size = 14;

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
  const barW = 2;
  const barH = [7, 5];
  const gap = 2;
  const margin = 1.5;

  const totalW = barW * 2 + gap;
  const xStart =
    horizontal === "left"
      ? margin
      : horizontal === "right"
        ? size - margin - totalW
        : (size - totalW) / 2;

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
  const barH = 2;
  const barW = [7, 5];
  const gap = 2;
  const margin = 1.5;

  const totalH = barH * 2 + gap;
  const yStart =
    vertical === "top"
      ? margin
      : vertical === "bottom"
        ? size - margin - totalH
        : (size - totalH) / 2;

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
