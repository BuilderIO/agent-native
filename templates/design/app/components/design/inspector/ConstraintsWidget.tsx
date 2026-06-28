import {
  IconAlignBoxCenterMiddle,
  IconArrowsDiagonal,
  IconBorderHorizontal,
  IconBorderVertical,
  IconBoxAlignBottom,
  IconBoxAlignLeft,
  IconBoxAlignRight,
  IconBoxAlignTop,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

type ConstraintIcon = ComponentType<{ className?: string }>;

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

const HORIZONTAL_OPTIONS: Array<{
  value: HorizontalConstraint;
  labelKey: keyof ConstraintsWidgetLabels;
  icon: ConstraintIcon;
}> = [
  { value: "left", labelKey: "left", icon: IconBoxAlignLeft },
  { value: "right", labelKey: "right", icon: IconBoxAlignRight },
  { value: "left-right", labelKey: "leftRight", icon: IconBorderHorizontal },
  { value: "center", labelKey: "center", icon: IconAlignBoxCenterMiddle },
  { value: "scale", labelKey: "scale", icon: IconArrowsDiagonal },
];

const VERTICAL_OPTIONS: Array<{
  value: VerticalConstraint;
  labelKey: keyof ConstraintsWidgetLabels;
  icon: ConstraintIcon;
}> = [
  { value: "top", labelKey: "top", icon: IconBoxAlignTop },
  { value: "bottom", labelKey: "bottom", icon: IconBoxAlignBottom },
  { value: "top-bottom", labelKey: "topBottom", icon: IconBorderVertical },
  { value: "center", labelKey: "center", icon: IconAlignBoxCenterMiddle },
  { value: "scale", labelKey: "scale", icon: IconArrowsDiagonal },
];

export function ConstraintsWidget({
  value,
  onChange,
  labels,
  disabled = false,
  className,
}: ConstraintsWidgetProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {copy.title}
        </span>
        <ConstraintPreview value={value} />
      </div>
      <ConstraintRow
        label={copy.horizontal}
        value={value.horizontal}
        disabled={disabled}
        options={HORIZONTAL_OPTIONS}
        labels={copy}
        onChange={(horizontal) => onChange({ ...value, horizontal })}
      />
      <ConstraintRow
        label={copy.vertical}
        value={value.vertical}
        disabled={disabled}
        options={VERTICAL_OPTIONS}
        labels={copy}
        onChange={(vertical) => onChange({ ...value, vertical })}
      />
    </div>
  );
}

function ConstraintRow<TValue extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  disabled,
}: {
  label: string;
  value: TValue;
  options: Array<{
    value: TValue;
    labelKey: keyof ConstraintsWidgetLabels;
    icon: ConstraintIcon;
  }>;
  labels: ConstraintsWidgetLabels;
  onChange: (value: TValue) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <ToggleGroup
        type="single"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next as TValue);
        }}
        className="justify-start"
      >
        {options.map((option) => {
          const Icon = option.icon;
          const optionLabel = labels[option.labelKey];
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              aria-label={optionLabel}
              title={optionLabel}
              className="size-8 min-w-8 px-0"
            >
              <Icon className="size-4" />
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

function ConstraintPreview({ value }: { value: ConstraintsValue }) {
  return (
    <div
      aria-hidden="true"
      className="relative size-12 shrink-0 rounded-md border border-border bg-muted/20"
    >
      <span className="absolute left-4 top-4 size-4 rounded-sm border border-foreground/70 bg-background shadow-sm" />
      {(value.horizontal === "left" || value.horizontal === "left-right") && (
        <span className="absolute left-1 top-1/2 h-px w-3 -translate-y-1/2 bg-foreground/70" />
      )}
      {(value.horizontal === "right" || value.horizontal === "left-right") && (
        <span className="absolute right-1 top-1/2 h-px w-3 -translate-y-1/2 bg-foreground/70" />
      )}
      {(value.vertical === "top" || value.vertical === "top-bottom") && (
        <span className="absolute left-1/2 top-1 h-3 w-px -translate-x-1/2 bg-foreground/70" />
      )}
      {(value.vertical === "bottom" || value.vertical === "top-bottom") && (
        <span className="absolute bottom-1 left-1/2 h-3 w-px -translate-x-1/2 bg-foreground/70" />
      )}
      {(value.horizontal === "center" || value.vertical === "center") && (
        <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-primary/70" />
      )}
      {value.vertical === "center" && (
        <span className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-primary/70" />
      )}
      {(value.horizontal === "scale" || value.vertical === "scale") && (
        <span className="absolute inset-2 rounded-sm border border-dashed border-primary/70" />
      )}
    </div>
  );
}
