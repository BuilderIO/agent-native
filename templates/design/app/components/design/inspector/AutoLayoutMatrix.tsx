import {
  IconArrowsDown,
  IconArrowsRight,
  IconLink,
  IconTextWrap,
  IconTextWrapDisabled,
  IconUnlink,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { AlignmentMatrix, type AlignmentMatrixValue } from "./AlignmentMatrix";
import { ScrubInput } from "./ScrubInput";

export type AutoLayoutDirection = "horizontal" | "vertical";
export type AutoLayoutWrap = "nowrap" | "wrap";
export type AutoLayoutSizing = "hug" | "fill" | "fixed";
export type AutoLayoutSizingAxis = "horizontal" | "vertical";

export interface AutoLayoutPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AutoLayoutMatrixValue {
  direction: AutoLayoutDirection;
  wrap: AutoLayoutWrap;
  alignment: AlignmentMatrixValue;
  gap: number;
  padding: AutoLayoutPadding;
  paddingLinked: boolean;
  childSizing: {
    horizontal: AutoLayoutSizing;
    vertical: AutoLayoutSizing;
  };
}

export interface AutoLayoutMatrixLabels {
  title: string;
  alignment: string;
  direction: string;
  horizontal: string;
  vertical: string;
  wrap: string;
  noWrap: string;
  gap: string;
  padding: string;
  linkPadding: string;
  unlinkPadding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  childSizing: string;
  hug: string;
  fill: string;
  fixed: string;
}

export interface AutoLayoutMatrixProps {
  value: AutoLayoutMatrixValue;
  onDirectionChange: (direction: AutoLayoutDirection) => void;
  onWrapChange: (wrap: AutoLayoutWrap) => void;
  onAlignmentChange: (alignment: AlignmentMatrixValue) => void;
  onGapChange: (gap: number) => void;
  onPaddingChange: (padding: AutoLayoutPadding) => void;
  onPaddingLinkedChange: (linked: boolean) => void;
  onChildSizingChange: (
    axis: AutoLayoutSizingAxis,
    sizing: AutoLayoutSizing,
  ) => void;
  labels?: Partial<AutoLayoutMatrixLabels>;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_LABELS: AutoLayoutMatrixLabels = {
  title: "Auto layout", // i18n-ignore fallback component label
  alignment: "Align", // i18n-ignore fallback component label
  direction: "Direction", // i18n-ignore fallback component label
  horizontal: "Horizontal", // i18n-ignore fallback component label
  vertical: "Vertical", // i18n-ignore fallback component label
  wrap: "Wrap", // i18n-ignore fallback component label
  noWrap: "No wrap", // i18n-ignore fallback component label
  gap: "Gap", // i18n-ignore fallback component label
  padding: "Padding", // i18n-ignore fallback component label
  linkPadding: "Link padding", // i18n-ignore fallback component label
  unlinkPadding: "Unlink padding", // i18n-ignore fallback component label
  paddingTop: "Top", // i18n-ignore fallback component label
  paddingRight: "Right", // i18n-ignore fallback component label
  paddingBottom: "Bottom", // i18n-ignore fallback component label
  paddingLeft: "Left", // i18n-ignore fallback component label
  childSizing: "Child sizing", // i18n-ignore fallback component label
  hug: "Hug", // i18n-ignore fallback component label
  fill: "Fill", // i18n-ignore fallback component label
  fixed: "Fixed", // i18n-ignore fallback component label
};

const SIZING_OPTIONS: AutoLayoutSizing[] = ["hug", "fill", "fixed"];

export function AutoLayoutMatrix({
  value,
  onDirectionChange,
  onWrapChange,
  onAlignmentChange,
  onGapChange,
  onPaddingChange,
  onPaddingLinkedChange,
  onChildSizingChange,
  labels,
  disabled = false,
  className,
}: AutoLayoutMatrixProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const linkedPaddingValue = value.padding.top;

  const updatePaddingSide = (side: keyof AutoLayoutPadding, next: number) => {
    if (value.paddingLinked) {
      onPaddingChange({
        top: next,
        right: next,
        bottom: next,
        left: next,
      });
      return;
    }
    onPaddingChange({ ...value.padding, [side]: next });
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {copy.title}
        </span>
        <div className="flex items-center gap-1">
          <ToggleGroup
            type="single"
            value={value.direction}
            disabled={disabled}
            onValueChange={(next) => {
              if (next) onDirectionChange(next as AutoLayoutDirection);
            }}
          >
            <ToggleGroupItem
              value="horizontal"
              aria-label={copy.horizontal}
              title={copy.horizontal}
              className="size-8 min-w-8 px-0"
            >
              <IconArrowsRight className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="vertical"
              aria-label={copy.vertical}
              title={copy.vertical}
              className="size-8 min-w-8 px-0"
            >
              <IconArrowsDown className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={value.wrap}
            disabled={disabled}
            onValueChange={(next) => {
              if (next) onWrapChange(next as AutoLayoutWrap);
            }}
          >
            <ToggleGroupItem
              value="nowrap"
              aria-label={copy.noWrap}
              title={copy.noWrap}
              className="size-8 min-w-8 px-0"
            >
              <IconTextWrapDisabled className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="wrap"
              aria-label={copy.wrap}
              title={copy.wrap}
              className="size-8 min-w-8 px-0"
            >
              <IconTextWrap className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <AlignmentMatrix
        value={value.alignment}
        onChange={onAlignmentChange}
        disabled={disabled}
        labels={{ title: copy.alignment }}
      />

      <div className="grid grid-cols-2 gap-2">
        <ScrubInput
          label={copy.gap}
          value={value.gap}
          onChange={(next) => onGapChange(next)}
          unit="px"
          min={0}
          step={1}
          precision={1}
          disabled={disabled}
          labelClassName="w-14"
        />
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={
              value.paddingLinked ? copy.unlinkPadding : copy.linkPadding
            }
            title={value.paddingLinked ? copy.unlinkPadding : copy.linkPadding}
            onClick={() => onPaddingLinkedChange(!value.paddingLinked)}
            className="size-8"
          >
            {value.paddingLinked ? (
              <IconLink className="size-4" />
            ) : (
              <IconUnlink className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {value.paddingLinked ? (
        <ScrubInput
          label={copy.padding}
          value={linkedPaddingValue}
          onChange={(next) => updatePaddingSide("top", next)}
          unit="px"
          min={0}
          step={1}
          precision={1}
          disabled={disabled}
          labelClassName="w-20"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <ScrubInput
            label={copy.paddingTop}
            value={value.padding.top}
            onChange={(next) => updatePaddingSide("top", next)}
            unit="px"
            min={0}
            step={1}
            precision={1}
            disabled={disabled}
            labelClassName="w-12"
          />
          <ScrubInput
            label={copy.paddingRight}
            value={value.padding.right}
            onChange={(next) => updatePaddingSide("right", next)}
            unit="px"
            min={0}
            step={1}
            precision={1}
            disabled={disabled}
            labelClassName="w-12"
          />
          <ScrubInput
            label={copy.paddingBottom}
            value={value.padding.bottom}
            onChange={(next) => updatePaddingSide("bottom", next)}
            unit="px"
            min={0}
            step={1}
            precision={1}
            disabled={disabled}
            labelClassName="w-12"
          />
          <ScrubInput
            label={copy.paddingLeft}
            value={value.padding.left}
            onChange={(next) => updatePaddingSide("left", next)}
            unit="px"
            min={0}
            step={1}
            precision={1}
            disabled={disabled}
            labelClassName="w-12"
          />
        </div>
      )}

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          {copy.childSizing}
        </span>
        <SizingRow
          axis={copy.horizontal}
          value={value.childSizing.horizontal}
          labels={copy}
          disabled={disabled}
          onChange={(next) => onChildSizingChange("horizontal", next)}
        />
        <SizingRow
          axis={copy.vertical}
          value={value.childSizing.vertical}
          labels={copy}
          disabled={disabled}
          onChange={(next) => onChildSizingChange("vertical", next)}
        />
      </div>
    </div>
  );
}

function SizingRow({
  axis,
  value,
  labels,
  disabled,
  onChange,
}: {
  axis: string;
  value: AutoLayoutSizing;
  labels: AutoLayoutMatrixLabels;
  disabled: boolean;
  onChange: (value: AutoLayoutSizing) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {axis}
      </span>
      <ToggleGroup
        type="single"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next as AutoLayoutSizing);
        }}
        className="justify-start"
      >
        {SIZING_OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option}
            value={option}
            aria-label={labels[option]}
            className="h-7 min-w-14 px-2 text-[11px]"
          >
            {labels[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
