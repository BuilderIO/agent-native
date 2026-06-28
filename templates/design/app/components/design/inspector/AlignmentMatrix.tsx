import {
  IconAlignBoxBottomCenter,
  IconAlignBoxBottomLeft,
  IconAlignBoxBottomRight,
  IconAlignBoxCenterMiddle,
  IconAlignBoxCenterTop,
  IconAlignBoxLeftMiddle,
  IconAlignBoxLeftTop,
  IconAlignBoxRightMiddle,
  IconAlignBoxRightTop,
  IconSpacingHorizontal,
  IconSpacingVertical,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
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
  icon: MatrixIcon;
}> = [
  {
    horizontal: "left",
    vertical: "top",
    labelKey: "alignTopLeft",
    icon: IconAlignBoxLeftTop,
  },
  {
    horizontal: "center",
    vertical: "top",
    labelKey: "alignTopCenter",
    icon: IconAlignBoxCenterTop,
  },
  {
    horizontal: "right",
    vertical: "top",
    labelKey: "alignTopRight",
    icon: IconAlignBoxRightTop,
  },
  {
    horizontal: "left",
    vertical: "middle",
    labelKey: "alignMiddleLeft",
    icon: IconAlignBoxLeftMiddle,
  },
  {
    horizontal: "center",
    vertical: "middle",
    labelKey: "alignCenter",
    icon: IconAlignBoxCenterMiddle,
  },
  {
    horizontal: "right",
    vertical: "middle",
    labelKey: "alignMiddleRight",
    icon: IconAlignBoxRightMiddle,
  },
  {
    horizontal: "left",
    vertical: "bottom",
    labelKey: "alignBottomLeft",
    icon: IconAlignBoxBottomLeft,
  },
  {
    horizontal: "center",
    vertical: "bottom",
    labelKey: "alignBottomCenter",
    icon: IconAlignBoxBottomCenter,
  },
  {
    horizontal: "right",
    vertical: "bottom",
    labelKey: "alignBottomRight",
    icon: IconAlignBoxBottomRight,
  },
];

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
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {copy.title}
          </span>
          {onDistribute && (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={copy.distributeHorizontal}
                    onClick={() => onDistribute("horizontal")}
                    className="size-7"
                  >
                    <IconSpacingHorizontal className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {copy.distributeHorizontal}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={copy.distributeVertical}
                    onClick={() => onDistribute("vertical")}
                    className="size-7"
                  >
                    <IconSpacingVertical className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {copy.distributeVertical}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
        <div className="grid w-max grid-cols-3 gap-1 rounded-md border border-border bg-muted/20 p-1">
          {MATRIX_OPTIONS.map((option) => {
            const active =
              option.horizontal === value.horizontal &&
              option.vertical === value.vertical;
            const Icon = option.icon;
            const label = copy[option.labelKey];
            return (
              <Tooltip key={`${option.horizontal}-${option.vertical}`}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={active ? "secondary" : "ghost"}
                    size="icon"
                    disabled={disabled}
                    aria-label={label}
                    aria-pressed={active}
                    onClick={() =>
                      onChange({
                        horizontal: option.horizontal,
                        vertical: option.vertical,
                      })
                    }
                    className="size-8"
                  >
                    <Icon
                      className={cn(
                        "size-4",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
