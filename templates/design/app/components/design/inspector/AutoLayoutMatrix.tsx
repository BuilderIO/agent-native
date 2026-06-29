import {
  IconArrowBackUp,
  IconArrowsDiagonal,
  IconLink,
  IconUnlink,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  AlignmentMatrix,
  type AlignmentMatrixValue,
  type DistributionAxis,
} from "./AlignmentMatrix";
import {
  IconFlowGrid,
  IconFlowHorizontal,
  IconFlowVertical,
  IconFlowWrap,
  IconGap,
  IconLayoutSettings,
  IconPaddingHorizontal,
  IconPaddingVertical,
} from "./figma-icons";
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
  clipContent?: boolean;
  resolvedSize?: {
    horizontal?: number;
    vertical?: number;
  };
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
  clipContent: string;
}

export interface AutoLayoutMatrixProps {
  value: AutoLayoutMatrixValue;
  onDirectionChange: (direction: AutoLayoutDirection) => void;
  onWrapChange: (wrap: AutoLayoutWrap) => void;
  onAlignmentChange: (alignment: AlignmentMatrixValue) => void;
  onGapChange: (gap: number) => void;
  onPaddingChange: (padding: AutoLayoutPadding) => void;
  onPaddingLinkedChange: (linked: boolean) => void;
  onClipContentChange?: (clipContent: boolean) => void;
  onDistribute?: (axis: DistributionAxis) => void;
  onChildSizingChange: (
    axis: AutoLayoutSizingAxis,
    sizing: AutoLayoutSizing,
  ) => void;
  availableChildSizing?: Partial<
    Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>
  >;
  labels?: Partial<AutoLayoutMatrixLabels>;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_LABELS: AutoLayoutMatrixLabels = {
  title: "Auto layout", // i18n-ignore fallback component label
  alignment: "Alignment", // i18n-ignore fallback component label
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
  clipContent: "Clip content", // i18n-ignore fallback component label
};

const SIZING_OPTIONS: AutoLayoutSizing[] = ["hug", "fill", "fixed"];

/** Derive the "active flow" option from direction + wrap state. */
function getFlowOption(
  direction: AutoLayoutDirection,
  wrap: AutoLayoutWrap,
): "horizontal" | "vertical" | "wrap" | "grid" {
  if (wrap === "wrap") return "wrap";
  if (direction === "vertical") return "vertical";
  return "horizontal";
}

export function AutoLayoutMatrix({
  value,
  onDirectionChange,
  onWrapChange,
  onAlignmentChange,
  onGapChange,
  onPaddingChange,
  onPaddingLinkedChange,
  onClipContentChange,
  onDistribute,
  onChildSizingChange,
  availableChildSizing,
  labels,
  disabled = false,
  className,
}: AutoLayoutMatrixProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };

  const horizontalPaddingValue = Math.round(
    (value.padding.left + value.padding.right) / 2,
  );
  const verticalPaddingValue = Math.round(
    (value.padding.top + value.padding.bottom) / 2,
  );

  const activeFlow = getFlowOption(value.direction, value.wrap);

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("space-y-2", className)}>
        {/* ── Flow ── */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {"Flow" /* i18n-ignore Figma inspector label */}
          </span>
          <div className="flex items-center gap-1.5">
            {/* 4-segment flow bar: horizontal / vertical / wrap / grid */}
            <div className="flex h-6 flex-1 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
              <FlowButton
                label={copy.horizontal}
                active={activeFlow === "horizontal"}
                disabled={disabled}
                onClick={() => {
                  onDirectionChange("horizontal");
                  onWrapChange("nowrap");
                }}
                position="first"
              >
                <IconFlowHorizontal className="size-3.5" />
              </FlowButton>
              <FlowButton
                label={copy.vertical}
                active={activeFlow === "vertical"}
                disabled={disabled}
                onClick={() => {
                  onDirectionChange("vertical");
                  onWrapChange("nowrap");
                }}
              >
                <IconFlowVertical className="size-3.5" />
              </FlowButton>
              <FlowButton
                label={copy.wrap}
                active={activeFlow === "wrap"}
                disabled={disabled}
                onClick={() => {
                  onDirectionChange("horizontal");
                  onWrapChange("wrap");
                }}
              >
                <IconFlowWrap className="size-3.5" />
              </FlowButton>
              <FlowButton
                label={"Grid" /* i18n-ignore Figma inspector label */}
                active={activeFlow === "grid"}
                disabled={disabled}
                onClick={() => {
                  onDirectionChange("horizontal");
                  onWrapChange("wrap");
                }}
                position="last"
              >
                <IconFlowGrid className="size-3.5" />
              </FlowButton>
            </div>
            {/* Reset button — same slot as before */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={
                    "Reset auto layout flow" /* i18n-ignore inspector tooltip */
                  }
                  onClick={() => {
                    onDirectionChange("horizontal");
                    onWrapChange("nowrap");
                  }}
                  className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                >
                  <IconArrowBackUp className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {"Reset auto layout flow" /* i18n-ignore inspector tooltip */}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Resizing ── */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {"Resizing" /* i18n-ignore Figma inspector label */}
          </span>
          <div className="grid grid-cols-[1fr_1fr_1.5rem] items-center gap-1">
            <SizingField
              axis="W"
              value={value.childSizing.horizontal}
              resolvedSize={value.resolvedSize?.horizontal}
              options={availableChildSizing?.horizontal ?? SIZING_OPTIONS}
              labels={copy}
              disabled={disabled}
              onChange={(next) => onChildSizingChange("horizontal", next)}
            />
            <SizingField
              axis="H"
              value={value.childSizing.vertical}
              resolvedSize={value.resolvedSize?.vertical}
              options={availableChildSizing?.vertical ?? SIZING_OPTIONS}
              labels={copy}
              disabled={disabled}
              onChange={(next) => onChildSizingChange("vertical", next)}
            />
            {/* Resize-to-fit icon button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={
                    "Resize to fit" /* i18n-ignore inspector tooltip */
                  }
                  onClick={() => {
                    onChildSizingChange("horizontal", "hug");
                    onChildSizingChange("vertical", "hug");
                  }}
                  className="size-6 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                >
                  <IconArrowsDiagonal className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {"Resize to fit" /* i18n-ignore inspector tooltip */}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Alignment + Gap (two-column row) ── */}
        <div className="grid grid-cols-[84px_1fr] items-start gap-2">
          {/* Left: Alignment label + 3×3 matrix */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {"Alignment" /* i18n-ignore Figma inspector label */}
            </span>
            <AlignmentMatrix
              value={value.alignment}
              onChange={onAlignmentChange}
              onDistribute={onDistribute}
              disabled={disabled}
            />
          </div>

          {/* Right: Gap label + input */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {copy.gap}
            </span>
            <div className="flex items-center gap-1">
              {/* Gap scrub input with ]·[ icon */}
              <div className="min-w-0 flex-1">
                <ScrubInput
                  label={copy.gap}
                  ariaLabel={copy.gap}
                  value={value.gap}
                  onChange={(next) => onGapChange(next)}
                  icon={IconGap}
                  unit="px"
                  min={0}
                  step={1}
                  precision={1}
                  disabled={disabled}
                  labelClassName="w-5 shrink-0 [&>span]:hidden"
                  inputClassName="h-6 text-[11px]"
                />
              </div>
              {/* Gap options / layout settings button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={
                      "Layout settings" /* i18n-ignore inspector tooltip */
                    }
                    className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                  >
                    <IconLayoutSettings className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {"Layout settings" /* i18n-ignore inspector tooltip */}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* ── Padding ── */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {copy.padding}
          </span>
          <div className="grid grid-cols-[1fr_1fr_1.5rem] items-center gap-1">
            {/* Horizontal padding (left + right) */}
            <ScrubInput
              label={copy.padding}
              ariaLabel={copy.paddingLeft + " / " + copy.paddingRight}
              value={
                value.paddingLinked ? value.padding.top : horizontalPaddingValue
              }
              onChange={(next) => {
                if (value.paddingLinked) {
                  onPaddingChange({
                    top: next,
                    right: next,
                    bottom: next,
                    left: next,
                  });
                  return;
                }
                onPaddingChange({
                  ...value.padding,
                  left: next,
                  right: next,
                });
              }}
              icon={IconPaddingHorizontal}
              unit="px"
              min={0}
              step={1}
              precision={1}
              disabled={disabled}
              labelClassName="w-5 shrink-0 [&>span]:hidden"
              inputClassName="h-6 text-[11px]"
            />
            {/* Vertical padding (top + bottom) */}
            <ScrubInput
              label={copy.padding}
              ariaLabel={copy.paddingTop + " / " + copy.paddingBottom}
              value={
                value.paddingLinked ? value.padding.top : verticalPaddingValue
              }
              onChange={(next) => {
                if (value.paddingLinked) {
                  onPaddingChange({
                    top: next,
                    right: next,
                    bottom: next,
                    left: next,
                  });
                  return;
                }
                onPaddingChange({
                  ...value.padding,
                  top: next,
                  bottom: next,
                });
              }}
              icon={IconPaddingVertical}
              unit="px"
              min={0}
              step={1}
              precision={1}
              disabled={disabled}
              labelClassName="w-5 shrink-0 [&>span]:hidden"
              inputClassName="h-6 text-[11px]"
            />
            {/* Link/unlink independent padding */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={
                    value.paddingLinked ? copy.unlinkPadding : copy.linkPadding
                  }
                  onClick={() => onPaddingLinkedChange(!value.paddingLinked)}
                  className="size-6 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                >
                  {value.paddingLinked ? (
                    <IconLink className="size-3.5" />
                  ) : (
                    <IconUnlink className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {value.paddingLinked ? copy.unlinkPadding : copy.linkPadding}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Expanded 4-field padding when unlinked */}
          {!value.paddingLinked && (
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <ScrubInput
                label={copy.paddingTop}
                value={value.padding.top}
                onChange={(next) =>
                  onPaddingChange({ ...value.padding, top: next })
                }
                unit="px"
                min={0}
                step={1}
                precision={1}
                disabled={disabled}
                labelClassName="w-8"
                inputClassName="h-6 text-[11px]"
              />
              <ScrubInput
                label={copy.paddingRight}
                value={value.padding.right}
                onChange={(next) =>
                  onPaddingChange({ ...value.padding, right: next })
                }
                unit="px"
                min={0}
                step={1}
                precision={1}
                disabled={disabled}
                labelClassName="w-8"
                inputClassName="h-6 text-[11px]"
              />
              <ScrubInput
                label={copy.paddingBottom}
                value={value.padding.bottom}
                onChange={(next) =>
                  onPaddingChange({ ...value.padding, bottom: next })
                }
                unit="px"
                min={0}
                step={1}
                precision={1}
                disabled={disabled}
                labelClassName="w-8"
                inputClassName="h-6 text-[11px]"
              />
              <ScrubInput
                label={copy.paddingLeft}
                value={value.padding.left}
                onChange={(next) =>
                  onPaddingChange({ ...value.padding, left: next })
                }
                unit="px"
                min={0}
                step={1}
                precision={1}
                disabled={disabled}
                labelClassName="w-8"
                inputClassName="h-6 text-[11px]"
              />
            </div>
          )}
        </div>

        {/* ── Clip content ── */}
        <label className="flex h-6 cursor-pointer items-center gap-2 text-[11px] text-foreground">
          <Checkbox
            checked={Boolean(value.clipContent)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onClipContentChange?.(checked === true)
            }
            className="size-4 rounded-sm"
          />
          <span>{copy.clipContent}</span>
        </label>
      </div>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────

/** A single segment in the flow segmented control. */
function FlowButton({
  label,
  active,
  disabled,
  onClick,
  children,
  position,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
  position?: "first" | "last";
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
            "flex flex-1 items-center justify-center transition-colors",
            "border-r border-[var(--design-editor-control-border,hsl(var(--border)/0.5))]",
            "text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-40",
            position === "last" && "border-r-0",
            active && [
              "bg-[var(--design-editor-panel-bg)]",
              "text-foreground",
              "shadow-[inset_0_0_0_1px_var(--design-editor-control-border,hsl(var(--border)))]",
            ],
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Figma-style sizing field: [axis | resolved-size | mode ▾] as a dropdown trigger. */
function SizingField({
  axis,
  value,
  resolvedSize,
  options = SIZING_OPTIONS,
  labels,
  disabled,
  onChange,
}: {
  axis: string;
  value: AutoLayoutSizing;
  resolvedSize?: number;
  options?: AutoLayoutSizing[];
  labels: AutoLayoutMatrixLabels;
  disabled: boolean;
  onChange: (value: AutoLayoutSizing) => void;
}) {
  // Ensure current value is in list (guard against stale state)
  const validOptions: AutoLayoutSizing[] = options.includes(value)
    ? options
    : [...options, value];

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${axis} ${labels[value]}`}
              disabled={disabled}
              className={cn(
                "flex h-6 w-full items-center overflow-hidden rounded-md",
                "bg-[var(--design-editor-control-bg)] text-[11px]",
                "hover:bg-[var(--design-editor-panel-raised-bg)]",
                "disabled:pointer-events-none disabled:opacity-40",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
              )}
            >
              {/* Axis letter */}
              <span className="flex h-full w-4 shrink-0 items-center justify-center border-r border-[var(--design-editor-control-border,hsl(var(--border)/0.6))] text-muted-foreground">
                {axis}
              </span>
              {/* Resolved size */}
              <span className="min-w-0 flex-1 truncate px-0.5 text-center tabular-nums text-foreground">
                {Math.round(resolvedSize ?? 0)}
              </span>
              {/* Mode word + caret */}
              <span className="flex h-full shrink-0 items-center gap-0 border-l border-[var(--design-editor-control-border,hsl(var(--border)/0.6))] px-0.5 text-muted-foreground">
                {labels[value]}
                <svg
                  viewBox="0 0 8 8"
                  width={8}
                  height={8}
                  fill="currentColor"
                  aria-hidden="true"
                  className="opacity-60"
                >
                  <path
                    d="M1.5 3 L4 5.5 L6.5 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{`${axis} ${labels[value]}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="min-w-[100px] text-[12px]"
        sideOffset={4}
      >
        {validOptions.map((opt) => (
          <DropdownMenuItem
            key={opt}
            onSelect={() => onChange(opt)}
            className={cn(
              "text-[12px]",
              opt === value &&
                "font-medium text-[var(--design-editor-accent-color)]",
            )}
          >
            {labels[opt]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
