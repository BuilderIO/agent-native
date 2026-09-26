import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowsDiagonalMinimize2,
  IconBorderBottom,
  IconBorderLeft,
  IconBorderRight,
  IconBorderTop,
  IconBoxModel2,
  IconBoxPadding,
  IconCheck,
  IconChevronDown,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
} from "@tabler/icons-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  INSPECTOR_GRID_ACTION_PAIR_SPAN,
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  InspectorGrid,
  InspectorGridCell,
} from "../edit-panel/inspector-grid";
import type {
  AlignmentHorizontal,
  AlignmentMatrixValue,
  AlignmentVertical,
  DistributionAxis,
} from "./AlignmentMatrix";
import {
  IconFlowGrid,
  IconFlowHorizontal,
  IconFlowNormal,
  IconFlowVertical,
  IconGap,
  IconGapVertical,
  IconPaddingHorizontal,
  IconPaddingVertical,
  IconSizingFill,
  IconSizingFixed,
  IconSizingHug,
  IconSizingMax,
  IconSizingMin,
  IconSizingRemove,
  IconSizingVariable,
} from "./design-icons";
import {
  ScrubInput,
  type ScrubInputChangeMeta,
  type ScrubInputProps,
} from "./ScrubInput";

export type AutoLayoutDirection = "horizontal" | "vertical";
export type AutoLayoutWrap = "nowrap" | "wrap";
export type AutoLayoutSizing = "hug" | "fill" | "fixed";
export type AutoLayoutSizingAxis = "horizontal" | "vertical";
export type AutoLayoutGridTrackSizing = "fill" | "hug" | "fixed" | "custom";

export interface AutoLayoutGridValue {
  columns: number;
  rows: number;
  columnSizing: AutoLayoutGridTrackSizing;
  rowSizing: AutoLayoutGridTrackSizing;
  columnSize?: number;
  rowSize?: number;
  columnTemplate?: string;
  rowTemplate?: string;
  columnGap: number;
  rowGap: number;
  columnsMixed?: boolean;
  rowsMixed?: boolean;
  columnGapMixed?: boolean;
  rowGapMixed?: boolean;
  columnSizingUnknown?: boolean;
  rowSizingUnknown?: boolean;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export type AutoLayoutFlow = "normal" | "vertical" | "horizontal" | "grid";
type ResolvedAutoLayoutFlow = AutoLayoutFlow | "mixed";

export interface AutoLayoutPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type AutoLayoutMargin = AutoLayoutPadding;
export type AutoLayoutSidesMixed = Partial<
  Record<keyof AutoLayoutPadding, boolean>
>;
export type AutoLayoutMarginTextValues = Partial<
  Record<keyof AutoLayoutPadding, string>
>;

const OPPOSITE_PADDING_SIDE: Record<
  keyof AutoLayoutPadding,
  keyof AutoLayoutPadding
> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

type PaddingChangeMeta = {
  source: ScrubInputChangeMeta["source"];
  phase: ScrubInputChangeMeta["phase"];
  altKey?: boolean;
};

export function mirrorPaddingChange(
  padding: AutoLayoutPadding,
  side: keyof AutoLayoutPadding,
  meta?: PaddingChangeMeta,
): AutoLayoutPadding {
  return mirrorSpacingChange(padding, side, meta);
}

export function mirrorMarginChange(
  margin: AutoLayoutMargin,
  side: keyof AutoLayoutPadding,
  meta?: PaddingChangeMeta,
): AutoLayoutMargin {
  return mirrorSpacingChange(margin, side, meta);
}

function mirrorSpacingChange(
  spacing: AutoLayoutPadding,
  side: keyof AutoLayoutPadding,
  meta?: PaddingChangeMeta,
): AutoLayoutPadding {
  if (!meta?.altKey) return spacing;
  return {
    ...spacing,
    [OPPOSITE_PADDING_SIDE[side]]: spacing[side],
  };
}

export interface AutoLayoutMatrixValue {
  direction: AutoLayoutDirection;
  wrap: AutoLayoutWrap;
  alignment: AlignmentMatrixValue;
  alignmentMixed?: boolean;
  gap: number;
  padding: AutoLayoutPadding;
  paddingLinked: boolean;
  margin?: AutoLayoutMargin;
  marginMixed?: AutoLayoutSidesMixed;
  marginTextValues?: AutoLayoutMarginTextValues;
  clipContent?: boolean;
  clipContentMixed?: boolean;
  resolvedSize?: {
    horizontal?: number | null;
    vertical?: number | null;
  };
  mixedSize?: {
    horizontal?: boolean;
    vertical?: boolean;
  };
  gapMixed?: boolean;
  gapModeMixed?: boolean;
  grid?: AutoLayoutGridValue;
  paddingMixed?: {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
  };
  childSizing: {
    horizontal: AutoLayoutSizing;
    vertical: AutoLayoutSizing;
  };
  childMinMax?: {
    horizontal?: { min?: number | null; max?: number | null };
    vertical?: { min?: number | null; max?: number | null };
  };
  display?: "flex" | "grid" | "block";
  flowMixed?: boolean;
  spaceBetween?: boolean;
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
  margin: string;
  linkMargin: string;
  unlinkMargin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  childSizing: string;
  hug: string;
  fill: string;
  fixed: string;
  clipContent: string;
  fixedWidth: string;
  fixedHeight: string;
  hugContents: string;
  fillContainer: string;
  addMinWidth: string;
  addMaxWidth: string;
  addMinHeight: string;
  addMaxHeight: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  applyVariable: string;
  removeConstraint: string;
}

export interface AutoLayoutMatrixProps {
  value: AutoLayoutMatrixValue;
  onDirectionChange: (direction: AutoLayoutDirection) => void;
  onWrapChange: (wrap: AutoLayoutWrap) => void;
  onAlignmentChange: (alignment: AlignmentMatrixValue) => void;
  onGapChange: (gap: number, meta?: ScrubInputChangeMeta) => void;
  onGridChange?: (
    grid: AutoLayoutGridValue,
    meta?: ScrubInputChangeMeta,
  ) => void;
  onPaddingChange: (
    padding: AutoLayoutPadding,
    meta?: ScrubInputChangeMeta,
  ) => void;
  onPaddingLinkedChange: (linked: boolean) => void;
  onMarginChange?: (
    margin: AutoLayoutMargin,
    meta: ScrubInputChangeMeta | undefined,
    changedSides: Array<keyof AutoLayoutMargin>,
  ) => void;
  onClipContentChange?: (clipContent: boolean) => void;
  clipContentSupported?: boolean;
  onDistribute?: (axis: DistributionAxis) => void;
  onGapModeChange?: (mode: "fixed" | "auto", axis: DistributionAxis) => void;
  onChildSizingChange: (
    axis: AutoLayoutSizingAxis,
    sizing: AutoLayoutSizing,
  ) => void;
  onChildSizeChange?: (
    axis: AutoLayoutSizingAxis,
    value: number,
    meta?: ScrubInputChangeMeta,
  ) => void;
  onChildMinMaxChange?: (
    axis: AutoLayoutSizingAxis,
    kind: "min" | "max",
    value: number | null,
    meta?: ScrubInputChangeMeta,
  ) => void;
  onApplyVariable?: (axis: AutoLayoutSizingAxis) => void;
  onFlowChange?: (flow: AutoLayoutFlow) => void;
  onDisplayChange?: (display: "flex" | "grid" | "block") => void;
  availableChildSizing?: Partial<
    Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>
  >;
  showChildLayoutControls?: boolean;
  showSizingControls?: boolean;
  labels?: Partial<AutoLayoutMatrixLabels>;
  disabled?: boolean;
  className?: string;
}

export const DEFAULT_AUTO_LAYOUT_LABELS: AutoLayoutMatrixLabels = {
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
  margin: "Margin", // i18n-ignore fallback component label
  linkMargin: "Link margin sides", // i18n-ignore fallback component label
  unlinkMargin: "Unlink margin sides", // i18n-ignore fallback component label
  marginTop: "Top margin", // i18n-ignore fallback component label
  marginRight: "Right margin", // i18n-ignore fallback component label
  marginBottom: "Bottom margin", // i18n-ignore fallback component label
  marginLeft: "Left margin", // i18n-ignore fallback component label
  childSizing: "Child sizing", // i18n-ignore fallback component label
  hug: "Hug", // i18n-ignore fallback component label
  fill: "Fill", // i18n-ignore fallback component label
  fixed: "Fixed", // i18n-ignore fallback component label
  clipContent: "Clip content", // i18n-ignore fallback component label
  fixedWidth: "Fixed width", // i18n-ignore fallback component label
  fixedHeight: "Fixed height", // i18n-ignore fallback component label
  hugContents: "Hug contents", // i18n-ignore fallback component label
  fillContainer: "Fill container", // i18n-ignore fallback component label
  addMinWidth: "Add min width…", // i18n-ignore fallback component label
  addMaxWidth: "Add max width…", // i18n-ignore fallback component label
  addMinHeight: "Add min height…", // i18n-ignore fallback component label
  addMaxHeight: "Add max height…", // i18n-ignore fallback component label
  minWidth: "Min width", // i18n-ignore fallback component label
  maxWidth: "Max width", // i18n-ignore fallback component label
  minHeight: "Min height", // i18n-ignore fallback component label
  maxHeight: "Max height", // i18n-ignore fallback component label
  applyVariable: "Apply variable…", // i18n-ignore fallback component label
  removeConstraint: "Remove", // i18n-ignore fallback component label
};

const SIZING_OPTIONS: AutoLayoutSizing[] = ["hug", "fill", "fixed"];

function getFlowOption(value: AutoLayoutMatrixValue): ResolvedAutoLayoutFlow {
  if (value.flowMixed) return "mixed";
  if (value.display === "block") return "normal";
  if (value.display === "grid") return "grid";
  if (value.direction === "vertical") return "vertical";
  return "horizontal";
}

export function AutoLayoutMatrix({
  value,
  onDirectionChange,
  onWrapChange,
  onAlignmentChange,
  onGapChange,
  onGridChange,
  onPaddingChange,
  onPaddingLinkedChange,
  onMarginChange,
  onClipContentChange,
  clipContentSupported = true,
  onDistribute,
  onGapModeChange,
  onChildSizingChange,
  onChildMinMaxChange,
  onApplyVariable,
  onFlowChange,
  onDisplayChange,
  onChildSizeChange,
  availableChildSizing,
  showChildLayoutControls = true,
  showSizingControls = true,
  labels,
  disabled = false,
  className,
}: AutoLayoutMatrixProps) {
  const copy = { ...DEFAULT_AUTO_LAYOUT_LABELS, ...labels };

  const activeFlow = getFlowOption(value);
  const isBlock = activeFlow === "normal";
  const canResizeToFit =
    (availableChildSizing?.horizontal ?? SIZING_OPTIONS).includes("hug") &&
    (availableChildSizing?.vertical ?? SIZING_OPTIONS).includes("hug");

  const selectFlow = (flow: AutoLayoutFlow) => {
    if (onFlowChange) {
      onFlowChange(flow);
      return;
    }
    if (flow === "normal") {
      onDisplayChange?.("block");
      return;
    }
    onDisplayChange?.(flow === "grid" ? "grid" : "flex");
    if (flow === "vertical") {
      onDirectionChange("vertical");
      onWrapChange("nowrap");
    } else if (flow === "horizontal") {
      onDirectionChange("horizontal");
      onWrapChange("nowrap");
    } else {
      // Grid tracks are controlled independently below.
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("space-y-2", className)}>
        {/* ── Flow ── */}
        {showChildLayoutControls ? (
          <InspectorGrid
            className="design-sidebar-property-grid items-center"
            layout="label-field-action"
          >
            <InspectorGridCell span={28}>
              <div className="flex min-h-3 items-center justify-between">
                <ControlLabel>
                  {"Flow" /* i18n-ignore design inspector label */}
                </ControlLabel>
                {value.flowMixed ? (
                  <span className="!text-[11px] text-muted-foreground">
                    {"Mixed" /* i18n-ignore design mixed value */}
                  </span>
                ) : null}
              </div>
            </InspectorGridCell>
            <InspectorGridCell span={24}>
              {/* 4-segment flow bar: normal / vertical / horizontal / grid */}
              <div
                data-flow-value={activeFlow}
                className="flex h-6 w-full items-center gap-0.5 rounded-md bg-[var(--design-editor-control-bg)] p-0.5"
              >
                <FlowButton
                  label={"Normal flow" /* i18n-ignore design inspector label */}
                  active={activeFlow === "normal"}
                  disabled={disabled}
                  onClick={() => selectFlow("normal")}
                >
                  <IconFlowNormal className="size-4" />
                </FlowButton>
                <FlowButton
                  label={copy.vertical}
                  active={activeFlow === "vertical"}
                  disabled={disabled}
                  onClick={() => selectFlow("vertical")}
                >
                  <IconFlowVertical className="size-4" />
                </FlowButton>
                <FlowButton
                  label={copy.horizontal}
                  active={activeFlow === "horizontal"}
                  disabled={disabled}
                  onClick={() => selectFlow("horizontal")}
                >
                  <IconFlowHorizontal className="size-4" />
                </FlowButton>
                <FlowButton
                  label={"Grid" /* i18n-ignore design inspector label */}
                  active={activeFlow === "grid"}
                  disabled={disabled}
                  onClick={() => selectFlow("grid")}
                >
                  <IconFlowGrid className="size-4" />
                </FlowButton>
              </div>
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              {/* Swap axis: flips between horizontal/vertical flex flow
                  without forcing a specific direction. Previously this
                  unconditionally called selectFlow("horizontal"), silently
                  destroying an authored vertical/grid/normal-flow layout
                  every time it was clicked regardless of the current state
                  (there's no stashed "authored" value to restore to, so a
                  true reset isn't possible) — swapping is the one action
                  here that's both non-destructive and matches what an
                  undo/reverse-style icon implies. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={
                      "Swap flow direction" /* i18n-ignore inspector tooltip */
                    }
                    onClick={() =>
                      selectFlow(
                        activeFlow === "vertical" ? "horizontal" : "vertical",
                      )
                    }
                    className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                  >
                    <IconArrowBackUp className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {"Swap flow direction" /* i18n-ignore inspector tooltip */}
                </TooltipContent>
              </Tooltip>
            </InspectorGridCell>
          </InspectorGrid>
        ) : null}

        {/* ── Resizing ── */}
        {showSizingControls ? (
          <InspectorGrid
            className="design-sidebar-property-grid items-start"
            layout="label-action-pair"
          >
            <InspectorGridCell span={28}>
              <div className="flex items-center justify-between gap-2">
                <ControlLabel>
                  {"Resizing" /* i18n-ignore design inspector label */}
                </ControlLabel>
                <span
                  aria-hidden="true"
                  className="flex items-center gap-0.5 text-[9px] text-muted-foreground/70"
                >
                  <kbd className="rounded border border-border/60 px-1 font-mono">
                    F
                  </kbd>
                  <kbd className="rounded border border-border/60 px-1 font-mono">
                    H
                  </kbd>
                </span>
              </div>
            </InspectorGridCell>
            <InspectorGridCell span={11}>
              <SizingField
                axis="W"
                sizingAxis="horizontal"
                value={value.childSizing.horizontal}
                resolvedSize={value.resolvedSize?.horizontal}
                mixed={Boolean(value.mixedSize?.horizontal)}
                minMax={value.childMinMax?.horizontal}
                options={resolveSizingOptions(
                  availableChildSizing?.horizontal,
                  value.childSizing.horizontal,
                )}
                labels={copy}
                disabled={disabled}
                onChange={(next) => onChildSizingChange("horizontal", next)}
                onSizeChange={
                  onChildSizeChange
                    ? (px, meta) => onChildSizeChange("horizontal", px, meta)
                    : undefined
                }
                onMinMaxChange={onChildMinMaxChange}
                onApplyVariable={onApplyVariable}
              />
            </InspectorGridCell>
            <InspectorGridCell span={1} ariaHidden />
            <InspectorGridCell span={11}>
              <SizingField
                axis="H"
                sizingAxis="vertical"
                value={value.childSizing.vertical}
                resolvedSize={value.resolvedSize?.vertical}
                mixed={Boolean(value.mixedSize?.vertical)}
                minMax={value.childMinMax?.vertical}
                options={resolveSizingOptions(
                  availableChildSizing?.vertical,
                  value.childSizing.vertical,
                )}
                labels={copy}
                disabled={disabled}
                onChange={(next) => onChildSizingChange("vertical", next)}
                onSizeChange={
                  onChildSizeChange
                    ? (px, meta) => onChildSizeChange("vertical", px, meta)
                    : undefined
                }
                onMinMaxChange={onChildMinMaxChange}
                onApplyVariable={onApplyVariable}
              />
            </InspectorGridCell>
            <InspectorGridCell span={1} ariaHidden />
            <InspectorGridCell span={4} className="flex justify-center">
              {canResizeToFit ? (
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
                      <IconArrowsDiagonalMinimize2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {"Resize to fit" /* i18n-ignore inspector tooltip */}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </InspectorGridCell>
          </InspectorGrid>
        ) : null}

        {showChildLayoutControls &&
        !isBlock &&
        activeFlow === "grid" &&
        value.grid ? (
          <GridControls
            value={value.grid}
            onChange={onGridChange}
            alignment={value.alignment}
            alignmentMixed={value.alignmentMixed}
            onAlignmentChange={onAlignmentChange}
            direction={value.direction}
            disabled={disabled}
          />
        ) : null}

        {showChildLayoutControls && !isBlock && activeFlow !== "grid" ? (
          <InspectorGrid className="items-start" layout="pair-flow">
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <div className="design-sidebar-property-group">
                <div className="flex items-center justify-between gap-2">
                  <ControlLabel>
                    {"Alignment" /* i18n-ignore design inspector label */}
                  </ControlLabel>
                  {value.alignmentMixed ? (
                    <span className="!text-[11px] text-muted-foreground">
                      {"Mixed" /* i18n-ignore design mixed value */}
                    </span>
                  ) : null}
                </div>
                <CompactAlignmentMatrix
                  value={value.alignment}
                  mixed={value.alignmentMixed}
                  onChange={onAlignmentChange}
                  direction={value.direction}
                  disabled={disabled}
                  onDistribute={onDistribute}
                />
              </div>
            </InspectorGridCell>

            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <div className="design-sidebar-property-group">
                <div className="flex items-center justify-between gap-2">
                  <ControlLabel>{copy.gap}</ControlLabel>
                  <kbd
                    aria-hidden="true"
                    className="rounded border border-border/60 px-1 font-mono text-[9px] text-muted-foreground/70"
                  >
                    A
                  </kbd>
                </div>
                <GapField
                  value={value.gap}
                  mixed={value.gapMixed}
                  onGapChange={onGapChange}
                  onDistribute={onDistribute}
                  onGapModeChange={onGapModeChange}
                  label={copy.gap}
                  disabled={disabled}
                  direction={value.direction}
                  gapMode={value.spaceBetween ? "auto" : "fixed"}
                  gapModeMixed={value.gapModeMixed}
                />
                {activeFlow === "horizontal" ? (
                  <label className="flex items-center gap-2 !text-[11px] text-foreground">
                    <Checkbox
                      checked={value.wrap === "wrap"}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        onWrapChange(checked === true ? "wrap" : "nowrap")
                      }
                      className="size-3.5 rounded-[3px] [&_svg]:size-3"
                    />
                    <span>{copy.wrap}</span>
                  </label>
                ) : null}
              </div>
            </InspectorGridCell>
          </InspectorGrid>
        ) : null}

        {/* ── Padding ── */}
        {showChildLayoutControls ? (
          <FourSideSpacingProperties
            label={copy.padding}
            value={value.padding}
            mixed={value.paddingMixed}
            linked={value.paddingLinked}
            linkLabel={copy.linkPadding}
            unlinkLabel={copy.unlinkPadding}
            sideLabels={{
              top: copy.paddingTop,
              right: copy.paddingRight,
              bottom: copy.paddingBottom,
              left: copy.paddingLeft,
            }}
            onLinkedChange={onPaddingLinkedChange}
            onChange={onPaddingChange}
            mirrorOppositeOnAlt
            disabled={disabled}
          />
        ) : null}

        {showChildLayoutControls && value.margin ? (
          <MarginProperties
            value={value.margin}
            mixed={value.marginMixed}
            textValues={value.marginTextValues}
            labels={copy}
            onChange={(margin, meta, changedSides) =>
              onMarginChange?.(margin, meta, changedSides)
            }
            disabled={disabled}
          />
        ) : null}

        {/* ── Clip content ── */}
        {showChildLayoutControls && clipContentSupported ? (
          <InspectorGrid>
            <InspectorGridCell span={28}>
              <label className="flex h-6 cursor-pointer items-center gap-2 !text-[11px] text-foreground">
                <Checkbox
                  checked={
                    value.clipContentMixed
                      ? "indeterminate"
                      : Boolean(value.clipContent)
                  }
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onClipContentChange?.(checked === true)
                  }
                  className="size-3.5 rounded-[3px] [&_svg]:size-3"
                />
                <span>{copy.clipContent}</span>
              </label>
            </InspectorGridCell>
          </InspectorGrid>
        ) : null}
      </div>
    </TooltipProvider>
  );
}


function resolveSizingOptions(
  available: AutoLayoutSizing[] | undefined,
  current: AutoLayoutSizing,
): AutoLayoutSizing[] {
  if (!available) return SIZING_OPTIONS;
  return available.includes(current) ? available : [...available, current];
}

const ALIGNMENT_CELLS: Array<{
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
}> = [
  { horizontal: "left", vertical: "top" },
  { horizontal: "center", vertical: "top" },
  { horizontal: "right", vertical: "top" },
  { horizontal: "left", vertical: "middle" },
  { horizontal: "center", vertical: "middle" },
  { horizontal: "right", vertical: "middle" },
  { horizontal: "left", vertical: "bottom" },
  { horizontal: "center", vertical: "bottom" },
  { horizontal: "right", vertical: "bottom" },
];


function GridControls({
  value,
  onChange,
  alignment,
  alignmentMixed,
  onAlignmentChange,
  direction,
  disabled,
}: {
  value: AutoLayoutGridValue;
  onChange?: (value: AutoLayoutGridValue, meta?: ScrubInputChangeMeta) => void;
  alignment: AlignmentMatrixValue;
  alignmentMixed?: boolean;
  onAlignmentChange: (alignment: AlignmentMatrixValue) => void;
  direction: AutoLayoutDirection;
  disabled: boolean;
}) {
  const locked = disabled || !onChange;
  const update = (
    patch: Partial<AutoLayoutGridValue>,
    meta?: ScrubInputChangeMeta,
  ) => onChange?.({ ...value, ...patch }, meta);

  return (
    <div className="design-sidebar-property-group">
      <InspectorGrid className="items-center">
        <InspectorGridCell span={12}>
          <ControlLabel>
            {"Grid" /* i18n-ignore design inspector label */}
          </ControlLabel>
        </InspectorGridCell>
        <InspectorGridCell span={16}>
          <div className="flex items-center justify-between gap-1.5">
            <ControlLabel>
              {"Gap" /* i18n-ignore design inspector label */}
            </ControlLabel>
            <GridAdvancedPopover
              value={value}
              update={update}
              alignment={alignment}
              alignmentMixed={alignmentMixed}
              onAlignmentChange={onAlignmentChange}
              direction={direction}
              disabled={locked}
            />
          </div>
        </InspectorGridCell>
      </InspectorGrid>
      <InspectorGrid className="items-start">
        <InspectorGridCell span={12}>
          <GridTrackMatrix
            columns={value.columns}
            rows={value.rows}
            mixed={Boolean(value.columnsMixed || value.rowsMixed)}
            disabled={
              locked ||
              Boolean(value.columnSizingUnknown || value.rowSizingUnknown) ||
              value.columnSizing === "custom" ||
              value.rowSizing === "custom"
            }
            onChange={(columns, rows, meta) => update({ columns, rows }, meta)}
          />
        </InspectorGridCell>
        <InspectorGridCell span={16}>
          <div className="design-sidebar-property-group">
            <GridGapField
              icon={IconGap}
              label={"Column gap" /* i18n-ignore design inspector label */}
              value={value.columnGap}
              mixed={value.columnGapMixed}
              disabled={locked}
              onChange={(columnGap, meta) => update({ columnGap }, meta)}
            />
            <GridGapField
              icon={IconGapVertical}
              label={"Row gap" /* i18n-ignore design inspector label */}
              value={value.rowGap}
              mixed={value.rowGapMixed}
              disabled={locked}
              onChange={(rowGap, meta) => update({ rowGap }, meta)}
            />
          </div>
        </InspectorGridCell>
      </InspectorGrid>
    </div>
  );
}

const GRID_MATRIX_MAX = 6;

function gridMatrixExtent(count: number): number {
  return Math.min(GRID_MATRIX_MAX, Math.max(3, Math.round(count) + 1));
}

function GridTrackMatrix({
  columns,
  rows,
  mixed,
  disabled,
  onChange,
}: {
  columns: number;
  rows: number;
  mixed: boolean;
  disabled: boolean;
  onChange: (columns: number, rows: number, meta: ScrubInputChangeMeta) => void;
}) {
  const [hovered, setHovered] = useState<{
    columns: number;
    rows: number;
  } | null>(null);
  const shown = hovered ?? { columns, rows };
  const columnCount = gridMatrixExtent(Math.max(shown.columns, columns));
  const rowCount = gridMatrixExtent(Math.max(shown.rows, rows));

  return (
    <div
      className={cn(
        "relative w-full max-w-[96px] select-none",
        disabled && "pointer-events-none opacity-40",
      )}
      onPointerLeave={() => setHovered(null)}
    >
      <div
        className="grid overflow-hidden rounded-md border border-border/70 bg-[var(--design-editor-control-bg)]"
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: columnCount * rowCount }, (_, index) => {
          const cellColumn = (index % columnCount) + 1;
          const cellRow = Math.floor(index / columnCount) + 1;
          const covered =
            cellColumn <= shown.columns && cellRow <= shown.rows && !mixed;
          return (
            <button
              key={`${cellColumn}:${cellRow}`}
              type="button"
              disabled={disabled}
              aria-label={
                `${cellColumn} × ${cellRow}` /* i18n-ignore design inspector label */
              }
              className={cn(
                "aspect-square border-[0.5px] border-border/50",
                covered
                  ? "bg-[var(--design-editor-accent-color)]/25"
                  : "bg-transparent hover:bg-foreground/10",
              )}
              onPointerEnter={() =>
                setHovered({ columns: cellColumn, rows: cellRow })
              }
              onClick={() => {
                setHovered(null);
                onChange(cellColumn, cellRow, {
                  source: "commit",
                  phase: "commit",
                });
              }}
            />
          );
        })}
      </div>
      <span
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[var(--design-editor-panel-bg)]/90 px-1 !text-[10px] tabular-nums text-foreground"
        data-grid-track-readout
      >
        {mixed
          ? "Mixed" /* i18n-ignore design mixed value */
          : `${Math.round(shown.columns)} × ${Math.round(shown.rows)}`}
      </span>
    </div>
  );
}

function GridGapField({
  icon,
  label,
  value,
  mixed,
  disabled,
  onChange,
}: {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  value: number;
  mixed?: boolean;
  disabled: boolean;
  onChange: (value: number, meta: ScrubInputChangeMeta) => void;
}) {
  return (
    <ScrubInput
      label={label}
      ariaLabel={label}
      tooltipLabel={label}
      icon={icon}
      value={value}
      mixed={mixed}
      onChange={onChange}
      unit="px"
      min={0}
      step={1}
      precision={0}
      disabled={disabled}
      className="min-w-0 gap-0 rounded-md bg-[var(--design-editor-control-bg)]"
      labelClassName="h-6 w-6 shrink-0 justify-center gap-0 rounded-l-md rounded-r-none text-muted-foreground [&>span]:hidden"
      inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
    />
  );
}

function GridAdvancedPopover({
  value,
  update,
  alignment,
  alignmentMixed,
  onAlignmentChange,
  direction,
  disabled,
}: {
  value: AutoLayoutGridValue;
  update: (
    patch: Partial<AutoLayoutGridValue>,
    meta?: ScrubInputChangeMeta,
  ) => void;
  alignment: AlignmentMatrixValue;
  alignmentMixed?: boolean;
  onAlignmentChange: (alignment: AlignmentMatrixValue) => void;
  direction: AutoLayoutDirection;
  disabled: boolean;
}) {
  const settingsLabel = "Grid settings" /* i18n-ignore inspector tooltip */;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={settingsLabel}
              className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
            >
              <IconAdjustmentsHorizontal className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{settingsLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={6} className="w-56 space-y-2 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <GridNumberField
            label={"Columns" /* i18n-ignore design inspector label */}
            value={value.columns}
            mixed={value.columnsMixed}
            min={1}
            max={24}
            onChange={(columns, meta) => update({ columns }, meta)}
            disabled={
              disabled ||
              Boolean(value.columnSizingUnknown) ||
              value.columnSizing === "custom"
            }
          />
          <GridNumberField
            label={"Rows" /* i18n-ignore design inspector label */}
            value={value.rows}
            mixed={value.rowsMixed}
            min={1}
            max={24}
            onChange={(rows, meta) => update({ rows }, meta)}
            disabled={
              disabled ||
              Boolean(value.rowSizingUnknown) ||
              value.rowSizing === "custom"
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <GridTrackPicker
            label={"Column sizing" /* i18n-ignore design inspector label */}
            value={value.columnSizing}
            fixedSize={value.columnSize}
            disabled={
              disabled ||
              Boolean(value.columnsMixed && value.columnSizingUnknown)
            }
            onChange={(columnSizing) => update({ columnSizing })}
            onFixedSizeChange={(columnSize, meta) =>
              update({ columnSize }, meta)
            }
          />
          <GridTrackPicker
            label={"Row sizing" /* i18n-ignore design inspector label */}
            value={value.rowSizing}
            fixedSize={value.rowSize}
            disabled={
              disabled || Boolean(value.rowsMixed && value.rowSizingUnknown)
            }
            onChange={(rowSizing) => update({ rowSizing })}
            onFixedSizeChange={(rowSize, meta) => update({ rowSize }, meta)}
          />
        </div>
        <div className="space-y-1.5">
          <ControlLabel>
            {"Cell alignment" /* i18n-ignore design inspector label */}
          </ControlLabel>
          <CompactAlignmentMatrix
            value={alignment}
            mixed={alignmentMixed}
            onChange={onAlignmentChange}
            direction={direction}
            disabled={disabled}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GridNumberField({
  label,
  value,
  mixed,
  min,
  max,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  mixed?: boolean;
  min: number;
  max?: number;
  unit?: string;
  onChange: (value: number, meta: ScrubInputChangeMeta) => void;
  disabled: boolean;
}) {
  return (
    <ScrubInput
      label={label}
      ariaLabel={label}
      tooltipLabel={label}
      value={value}
      mixed={mixed}
      onChange={onChange}
      unit={unit}
      min={min}
      max={max}
      step={1}
      precision={0}
      disabled={disabled}
      className="w-full min-w-0 gap-0 rounded-md bg-[var(--design-editor-control-bg)]"
      labelClassName="h-6 max-w-[56px] justify-start overflow-hidden px-1.5 !text-[10px] text-muted-foreground [&>svg]:hidden"
      inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
    />
  );
}

function GridTrackPicker({
  label,
  value,
  fixedSize = 100,
  disabled,
  onChange,
  onFixedSizeChange,
}: {
  label: string;
  value: AutoLayoutGridTrackSizing;
  fixedSize?: number;
  disabled: boolean;
  onChange: (value: AutoLayoutGridTrackSizing) => void;
  onFixedSizeChange: (value: number, meta: ScrubInputChangeMeta) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="block truncate !text-[10px] text-muted-foreground">
        {label}
      </span>
      <div className="flex h-6 w-full min-w-0 rounded-md bg-[var(--design-editor-control-bg)]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={label}
              className="h-6 min-w-0 flex-1 justify-start rounded-md px-2 !text-[11px] font-normal capitalize"
            >
              {value}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(["fill", "hug", "fixed", "custom"] as const).map((option) => (
              <DropdownMenuItem key={option} onSelect={() => onChange(option)}>
                <span className="capitalize">{option}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {value === "fixed" ? (
          <ScrubInput
            label={label}
            ariaLabel={`${label} size`}
            value={fixedSize}
            onChange={onFixedSizeChange}
            unit="px"
            min={0}
            precision={0}
            disabled={disabled}
            className="h-6 w-14 min-w-0 gap-0"
            labelClassName="hidden"
            inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
          />
        ) : null}
      </div>
    </div>
  );
}

function CompactAlignmentMatrix({
  value,
  mixed = false,
  onChange,
  direction,
  disabled,
  onDistribute,
}: {
  value: AlignmentMatrixValue;
  mixed?: boolean;
  onChange: (value: AlignmentMatrixValue) => void;
  direction: AutoLayoutDirection;
  disabled: boolean;
  onDistribute?: (axis: DistributionAxis) => void;
}) {
  return (
    <div
      className={cn("space-y-1", disabled && "pointer-events-none opacity-40")}
    >
      <div className="grid w-full max-w-[92px] grid-cols-3 rounded-md bg-[var(--design-editor-control-bg)] p-1">
        {ALIGNMENT_CELLS.map((cell) => {
          const active =
            !mixed &&
            cell.horizontal === value.horizontal &&
            cell.vertical === value.vertical;
          return (
            <button
              key={`${cell.horizontal}-${cell.vertical}`}
              type="button"
              aria-label={`${cell.vertical} ${cell.horizontal}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() =>
                onChange({
                  horizontal: cell.horizontal,
                  vertical: cell.vertical,
                })
              }
              className={cn(
                "flex h-4 min-w-0 w-full items-center justify-center rounded-[3px] transition-colors",
                "hover:bg-[var(--design-editor-control-bg)]",
              )}
            >
              {active ? (
                <AlignmentBars
                  horizontal={cell.horizontal}
                  vertical={cell.vertical}
                  direction={direction}
                />
              ) : (
                <span
                  className="block size-[3px] rounded-full bg-current opacity-25"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
      {onDistribute != null ? (
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  "Distribute horizontal spacing" /* i18n-ignore design inspector tooltip */
                }
                disabled={disabled}
                onClick={() => onDistribute("horizontal")}
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-[3px] transition-colors",
                  "text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  "disabled:pointer-events-none disabled:opacity-40",
                )}
              >
                <IconLayoutDistributeHorizontal className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {
                "Distribute horizontal spacing" /* i18n-ignore design inspector tooltip */
              }
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  "Distribute vertical spacing" /* i18n-ignore design inspector tooltip */
                }
                disabled={disabled}
                onClick={() => onDistribute("vertical")}
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-[3px] transition-colors",
                  "text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  "disabled:pointer-events-none disabled:opacity-40",
                )}
              >
                <IconLayoutDistributeVertical className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {
                "Distribute vertical spacing" /* i18n-ignore design inspector tooltip */
              }
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

function AlignmentBars({
  horizontal,
  vertical,
  direction,
}: {
  horizontal: AlignmentHorizontal;
  vertical: AlignmentVertical;
  direction: AutoLayoutDirection;
}) {
  const accent = "var(--design-editor-accent-color, #18a0fb)";
  const stack = direction === "vertical";
  const box = 14;
  const pad = 2.5;
  const thickness = 2;
  const length = 5;
  const shortLength = 3.5;
  const gap = 1.5;

  const total = stack
    ? thickness * 2 + gap
    : thickness * 2 + gap;

  const along = (h: AlignmentHorizontal | AlignmentVertical, size: number) => {
    if (h === "left" || h === "top") return pad;
    if (h === "right" || h === "bottom") return box - pad - size;
    return (box - size) / 2;
  };

  const bars = [length, shortLength];

  return (
    <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
      {bars.map((len, i) => {
        if (stack) {
          const y = along(vertical, total) + i * (thickness + gap);
          const x = along(horizontal, len);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={len}
              height={thickness}
              rx={1}
              fill={accent}
            />
          );
        }
        const x = along(horizontal, total) + i * (thickness + gap);
        const y = along(vertical, len);
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={thickness}
            height={len}
            rx={1}
            fill={accent}
          />
        );
      })}
    </svg>
  );
}

function ControlLabel({ children }: { children: ReactNode }) {
  return (
    <span className="design-sidebar-field-label block text-muted-foreground">
      {children}
    </span>
  );
}

function FlowButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
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
            "flex h-6 flex-1 items-center justify-center rounded-[5px] transition-colors",
            "text-muted-foreground hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-40",
            active
              ? [
                  "bg-[var(--design-editor-panel-bg)] text-foreground",
                  "shadow-[0_0_0_1px_var(--design-editor-control-border,hsl(var(--border))),0_1px_2px_rgba(0,0,0,0.25)]",
                ]
              : "hover:bg-[var(--design-editor-panel-raised-bg)]",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function GapField({
  value,
  mixed = false,
  onGapChange,
  onDistribute,
  onGapModeChange,
  label,
  disabled,
  direction,
  gapMode = "fixed",
  gapModeMixed = false,
}: {
  value: number;
  mixed?: boolean;
  onGapChange: (gap: number, meta?: ScrubInputChangeMeta) => void;
  onDistribute?: (axis: DistributionAxis) => void;
  onGapModeChange?: (mode: "fixed" | "auto", axis: DistributionAxis) => void;
  label: string;
  disabled: boolean;
  direction: AutoLayoutDirection;
  gapMode?: "fixed" | "auto";
  gapModeMixed?: boolean;
}) {
  const handleShortcut = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      disabled ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== "a"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (onGapModeChange) {
      onGapModeChange("auto", direction);
    } else {
      onDistribute?.(direction);
    }
  };

  return (
    <InspectorGrid
      className="items-center"
      layout="field-action"
      onKeyDown={handleShortcut}
    >
      <InspectorGridCell span={24}>
        {/* [gap-icon] value [▾] in one control surface */}
        <div
          className={cn(
            "flex h-6 w-full min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)]",
            disabled && "opacity-40",
          )}
        >
          <ScrubInput
            label={label}
            ariaLabel={label}
            tooltipLabel={label}
            icon={IconGap}
            value={value}
            mixed={mixed}
            onChange={(next, meta) => onGapChange(next, meta)}
            unit="px"
            min={0}
            step={1}
            precision={1}
            disabled={disabled}
            className="min-w-0 flex-1 gap-0"
            labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none text-muted-foreground [&>span]:hidden"
            inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
          />
          {onDistribute != null ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={
                        gapModeMixed
                          ? "Gap mode: Mixed" /* i18n-ignore inspector tooltip */
                          : "Gap mode" /* i18n-ignore inspector tooltip */
                      }
                      disabled={disabled}
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-r-md",
                        "text-muted-foreground hover:text-foreground",
                        "disabled:pointer-events-none disabled:opacity-40",
                        "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color,hsl(var(--primary)))]",
                      )}
                    >
                      <IconChevronDown className="size-2 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {"Gap mode" /* i18n-ignore inspector tooltip */}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="min-w-[110px] text-[12px]"
                sideOffset={4}
              >
                <DropdownMenuCheckboxItem
                  checked={!gapModeMixed && gapMode !== "auto"}
                  className="text-[12px]"
                  onSelect={() => onGapModeChange?.("fixed", direction)}
                >
                  {"Fixed" /* i18n-ignore design gap mode label */}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={!gapModeMixed && gapMode === "auto"}
                  className="text-[12px]"
                  onSelect={() => {
                    if (onGapModeChange) {
                      onGapModeChange("auto", direction);
                      return;
                    }
                    onDistribute?.(direction);
                  }}
                >
                  {"Auto" /* i18n-ignore design gap mode label */}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </InspectorGridCell>
      {/* Sliders / advanced spacing icon (the design editor's tune control) */}
      <InspectorGridCell span={4} className="flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={
                "Advanced gap settings" /* i18n-ignore inspector tooltip */
              }
              onClick={() => onDistribute?.(direction)}
              className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
            >
              <IconAdjustmentsHorizontal className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {"Advanced gap settings" /* i18n-ignore inspector tooltip */}
          </TooltipContent>
        </Tooltip>
      </InspectorGridCell>
    </InspectorGrid>
  );
}

interface FourSideSpacingPropertiesProps {
  label: string;
  value: AutoLayoutPadding;
  mixed?: AutoLayoutSidesMixed;
  textValues?: AutoLayoutMarginTextValues;
  linked: boolean;
  linkLabel: string;
  unlinkLabel: string;
  sideLabels: Record<keyof AutoLayoutPadding, string>;
  min?: number;
  disabled: boolean;
  onLinkedChange: (linked: boolean) => void;
  onChange: (
    value: AutoLayoutPadding,
    meta: ScrubInputChangeMeta | undefined,
    changedSides: Array<keyof AutoLayoutPadding>,
  ) => void;
  mirrorOppositeOnAlt?: boolean;
}

function FourSideSpacingProperties({
  label,
  value,
  mixed,
  textValues,
  linked,
  linkLabel,
  unlinkLabel,
  sideLabels,
  min = 0,
  disabled,
  onLinkedChange,
  onChange,
  mirrorOppositeOnAlt = false,
}: FourSideSpacingPropertiesProps) {
  const horizontalValue = value.left;
  const verticalValue = value.top;
  const horizontalMixed = Boolean(mixed?.left || mixed?.right);
  const verticalMixed = Boolean(mixed?.top || mixed?.bottom);

  const update = (
    side: keyof AutoLayoutPadding,
    next: AutoLayoutPadding,
    meta?: PaddingChangeMeta,
  ) => {
    const changedSides = new Set<keyof AutoLayoutPadding>([side]);
    if (linked || (mirrorOppositeOnAlt && meta?.altKey)) {
      changedSides.add(OPPOSITE_PADDING_SIDE[side]);
    }
    onChange(
      mirrorOppositeOnAlt ? mirrorSpacingChange(next, side, meta) : next,
      meta,
      [...changedSides],
    );
  };

  return (
    <div className="design-sidebar-property-group">
      <ControlLabel>{label}</ControlLabel>
      {linked ? (
        <InspectorGrid className="items-center" layout="action-pair">
          <InspectorGridCell span={11}>
            <SpacingField
              icon={IconPaddingHorizontal}
              ariaLabel={sideLabels.left + " / " + sideLabels.right}
              value={horizontalValue}
              textValue={textValues?.left}
              mixed={horizontalMixed}
              min={min}
              onChange={(next, meta) =>
                update("left", { ...value, left: next, right: next }, meta)
              }
              disabled={disabled}
            />
          </InspectorGridCell>
          <InspectorGridCell span={1} ariaHidden />
          <InspectorGridCell span={11}>
            <SpacingField
              icon={IconPaddingVertical}
              ariaLabel={sideLabels.top + " / " + sideLabels.bottom}
              value={verticalValue}
              textValue={textValues?.top}
              mixed={verticalMixed}
              min={min}
              onChange={(next, meta) =>
                update("top", { ...value, top: next, bottom: next }, meta)
              }
              disabled={disabled}
            />
          </InspectorGridCell>
          <InspectorGridCell span={1} ariaHidden />
          <InspectorGridCell span={4} className="flex justify-center">
            <SpacingLinkButton
              linked
              disabled={disabled}
              linkLabel={linkLabel}
              unlinkLabel={unlinkLabel}
              onToggle={() => onLinkedChange(false)}
            />
          </InspectorGridCell>
        </InspectorGrid>
      ) : (
        <InspectorGrid className="items-center" layout="field-action">
          <InspectorGridCell span={24}>
            <InspectorGrid className="items-center" layout="pair">
              {(
                [
                  ["top", IconBorderTop],
                  ["right", IconBorderRight],
                  ["bottom", IconBorderBottom],
                  ["left", IconBorderLeft],
                ] as const
              ).map(([side, icon], index) => (
                <Fragment key={side}>
                  {index % 2 === 1 ? (
                    <InspectorGridCell
                      span={INSPECTOR_GRID_PAIR_GUTTER_SPAN}
                      ariaHidden
                    />
                  ) : null}
                  <InspectorGridCell span={INSPECTOR_GRID_ACTION_PAIR_SPAN}>
                    <SpacingField
                      icon={icon}
                      ariaLabel={sideLabels[side]}
                      value={value[side]}
                      textValue={textValues?.[side]}
                      mixed={mixed?.[side]}
                      min={min}
                      onChange={(next, meta) =>
                        update(side, { ...value, [side]: next }, meta)
                      }
                      disabled={disabled}
                    />
                  </InspectorGridCell>
                </Fragment>
              ))}
            </InspectorGrid>
          </InspectorGridCell>
          <InspectorGridCell span={4} className="flex justify-center">
            <SpacingLinkButton
              linked={false}
              disabled={disabled}
              linkLabel={linkLabel}
              unlinkLabel={unlinkLabel}
              onToggle={() => onLinkedChange(true)}
            />
          </InspectorGridCell>
        </InspectorGrid>
      )}
    </div>
  );
}

export function MarginProperties({
  value,
  mixed,
  textValues,
  labels,
  onChange,
  disabled = false,
}: {
  value: AutoLayoutMargin;
  mixed?: AutoLayoutSidesMixed;
  textValues?: AutoLayoutMarginTextValues;
  labels?: Partial<AutoLayoutMatrixLabels>;
  onChange: (
    margin: AutoLayoutMargin,
    meta: ScrubInputChangeMeta | undefined,
    changedSides: Array<keyof AutoLayoutMargin>,
  ) => void;
  disabled?: boolean;
}) {
  const copy = { ...DEFAULT_AUTO_LAYOUT_LABELS, ...labels };
  const [linked, setLinked] = useState(() => {
    const sides = ["top", "right", "bottom", "left"] as const;
    if (sides.some((side) => mixed?.[side])) return false;
    const first = textValues?.top ?? String(value.top);
    return sides.every(
      (side) => (textValues?.[side] ?? String(value[side])) === first,
    );
  });

  return (
    <FourSideSpacingProperties
      label={copy.margin}
      value={value}
      mixed={mixed}
      textValues={textValues}
      linked={linked}
      linkLabel={copy.linkMargin}
      unlinkLabel={copy.unlinkMargin}
      sideLabels={{
        top: copy.marginTop,
        right: copy.marginRight,
        bottom: copy.marginBottom,
        left: copy.marginLeft,
      }}
      min={-999}
      disabled={disabled}
      onLinkedChange={setLinked}
      onChange={onChange}
      mirrorOppositeOnAlt
    />
  );
}

function SpacingField({
  icon: Icon,
  ariaLabel,
  value,
  textValue,
  mixed = false,
  min = 0,
  onChange,
  disabled,
}: {
  icon: (props: { className?: string }) => ReactNode;
  ariaLabel: string;
  value: number;
  textValue?: string;
  mixed?: boolean;
  min?: number;
  onChange: (value: number, meta?: ScrubInputChangeMeta) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-6 min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)]",
        disabled && "opacity-40",
      )}
    >
      <ScrubInput
        label={ariaLabel}
        ariaLabel={ariaLabel}
        tooltipLabel={ariaLabel}
        icon={Icon}
        value={value}
        textValue={textValue}
        mixed={mixed}
        onChange={(next, meta) => onChange(next, meta)}
        unit="px"
        min={min}
        step={1}
        precision={1}
        disabled={disabled}
        className="w-full min-w-0 flex-1 gap-0"
        labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none text-muted-foreground [&>span]:hidden"
        inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

function SpacingLinkButton({
  linked,
  disabled,
  linkLabel,
  unlinkLabel,
  onToggle,
}: {
  linked: boolean;
  disabled: boolean;
  linkLabel: string;
  unlinkLabel: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={linked ? unlinkLabel : linkLabel}
          onClick={onToggle}
          className={cn(
            "size-6 shrink-0 rounded-md hover:bg-[var(--design-editor-control-bg)]",
            linked
              ? "text-[var(--design-editor-accent-color,hsl(var(--primary)))] hover:text-[var(--design-editor-accent-color,hsl(var(--primary)))]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {linked ? (
            <IconBoxPadding className="size-4" />
          ) : (
            <IconBoxModel2 className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{linked ? unlinkLabel : linkLabel}</TooltipContent>
    </Tooltip>
  );
}

interface SizingFieldMinMax {
  min?: number | null;
  max?: number | null;
}

export interface SizingFieldProps {
  axis: string;
  sizingAxis: AutoLayoutSizingAxis;
  value: AutoLayoutSizing;
  resolvedSize?: number | null;
  mixed?: boolean;
  minMax?: SizingFieldMinMax;
  options?: AutoLayoutSizing[];
  autoMode?: { active: boolean; label: string; onSelect: () => void };
  showAdvancedOptions?: boolean;
  labels?: Partial<AutoLayoutMatrixLabels>;
  disabled: boolean;
  onChange: (value: AutoLayoutSizing) => void;
  onSizeChange?: (px: number, meta?: ScrubInputChangeMeta) => void;
  onMinMaxChange?: (
    axis: AutoLayoutSizingAxis,
    kind: "min" | "max",
    value: number | null,
    meta?: ScrubInputChangeMeta,
  ) => void;
  onApplyVariable?: (axis: AutoLayoutSizingAxis) => void;
}

export function SizingField({
  axis,
  sizingAxis,
  value,
  resolvedSize,
  mixed = false,
  minMax,
  options = SIZING_OPTIONS,
  autoMode,
  showAdvancedOptions = true,
  labels: labelOverrides,
  disabled,
  onChange,
  onSizeChange,
  onMinMaxChange,
  onApplyVariable,
}: SizingFieldProps) {
  const labels = { ...DEFAULT_AUTO_LAYOUT_LABELS, ...labelOverrides };
  const isWidth = sizingAxis === "horizontal";

  const minValue = minMax?.min ?? null;
  const maxValue = minMax?.max ?? null;
  const hasMin = minValue != null;
  const hasMax = maxValue != null;

  const canHug = options.includes("hug");
  const canFill = options.includes("fill");

  const showWord = Boolean(autoMode?.active) || value !== "fixed";
  const modeLabel = autoMode?.active ? autoMode.label : labels[value];
  const sizeText = mixed
    ? "Mixed"
    : resolvedSize == null
      ? ""
      : String(roundToOneDecimal(resolvedSize));

  const addMinLabel = isWidth ? labels.addMinWidth : labels.addMinHeight;
  const addMaxLabel = isWidth ? labels.addMaxWidth : labels.addMaxHeight;
  const minLabel = isWidth ? labels.minWidth : labels.minHeight;
  const maxLabel = isWidth ? labels.maxWidth : labels.maxHeight;

  const isEditableFixed = value === "fixed" && onSizeChange != null;

  const handleShortcut = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      disabled ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    const next =
      key === "f" && canFill ? "fill" : key === "h" && canHug ? "hug" : null;
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(next);
  };

  const openEditor = (kind: "min" | "max") => {
    const seed = Math.max(0, roundToOneDecimal(resolvedSize ?? 0));
    const seedValue = kind === "min" ? seed : seed || 1;
    onMinMaxChange?.(sizingAxis, kind, seedValue);
  };

  const dropdownContent = (
    <DropdownMenuContent
      align="start"
      className="min-w-[180px] text-[12px]"
      sideOffset={4}
    >
      {/* ── Modes ── */}
      <SizingMenuItem
        icon={<IconSizingFixed />}
        label={labels.fixed}
        active={!autoMode?.active && value === "fixed"}
        onSelect={() => onChange("fixed")}
      />
      {canHug ? (
        <SizingMenuItem
          icon={<IconSizingHug />}
          label={labels.hugContents}
          active={!autoMode?.active && value === "hug"}
          onSelect={() => onChange("hug")}
        />
      ) : null}
      {canFill ? (
        <SizingMenuItem
          icon={<IconSizingFill />}
          label={labels.fillContainer}
          active={!autoMode?.active && value === "fill"}
          onSelect={() => onChange("fill")}
        />
      ) : null}
      {autoMode ? (
        <SizingMenuItem
          icon={<IconSizingFixed />}
          label={autoMode.label}
          active={autoMode.active}
          onSelect={autoMode.onSelect}
        />
      ) : null}

      {/* ── Min / Max ── */}
      {showAdvancedOptions && onMinMaxChange ? (
        <>
          <DropdownMenuSeparator />
          <SizingMenuItem
            icon={<IconSizingMin />}
            label={addMinLabel}
            active={hasMin}
            disabled={hasMin}
            onSelect={() => openEditor("min")}
          />
          <SizingMenuItem
            icon={<IconSizingMax />}
            label={addMaxLabel}
            active={hasMax}
            disabled={hasMax}
            onSelect={() => openEditor("max")}
          />
        </>
      ) : null}

      {/* ── Variable ── */}
      {showAdvancedOptions ? (
        <>
          <DropdownMenuSeparator />
          <SizingMenuItem
            icon={<IconSizingVariable />}
            label={labels.applyVariable}
            disabled={!onApplyVariable}
            onSelect={() => onApplyVariable?.(sizingAxis)}
          />
        </>
      ) : null}
    </DropdownMenuContent>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1" onKeyDown={handleShortcut}>
      {isEditableFixed ? (
        <DropdownMenu>
          <div
            className={cn(
              "flex h-6 w-full items-center overflow-hidden rounded-md",
              "bg-[var(--design-editor-control-bg)] !text-[11px]",
              disabled && "pointer-events-none opacity-40",
            )}
          >
            {/* Scrub-editable size value */}
            <ScrubInput
              label={axis}
              ariaLabel={`${axis} size in pixels`}
              tooltipLabel={`${axis} size`}
              icon={null}
              value={mixed ? 0 : roundToOneDecimal(resolvedSize ?? 0)}
              onChange={(next, meta) =>
                onSizeChange!(Math.max(0, roundToOneDecimal(next)), meta)
              }
              mixed={mixed}
              unit="px"
              min={0}
              step={1}
              precision={1}
              disabled={disabled}
              className="min-w-0 flex-1 gap-0"
              labelClassName="h-6 w-5 justify-center gap-0 rounded-l-md rounded-r-none px-0 text-muted-foreground"
              inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
            />
            {/* Caret opens the mode picker */}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${axis} sizing mode — ${modeLabel}`}
                    disabled={disabled}
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-r-md",
                      "text-muted-foreground hover:text-foreground",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color,hsl(var(--primary)))]",
                    )}
                  >
                    <IconChevronDown className="size-2 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {`${axis} · ${modeLabel} — click to change sizing mode`}
              </TooltipContent>
            </Tooltip>
          </div>
          {dropdownContent}
        </DropdownMenu>
      ) : (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${axis} ${sizeText} ${modeLabel}`}
                  disabled={disabled}
                  className={cn(
                    "flex h-6 w-full items-center gap-1 overflow-hidden rounded-md px-1.5",
                    "bg-[var(--design-editor-control-bg)] !text-[11px]",
                    "hover:bg-[var(--design-editor-panel-raised-bg)]",
                    "disabled:pointer-events-none disabled:opacity-40",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color,hsl(var(--primary)))]",
                  )}
                >
                  {/* Axis letter */}
                  <span className="shrink-0 text-muted-foreground">{axis}</span>
                  {/* Resolved size */}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left tabular-nums",
                      mixed ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {sizeText}
                  </span>
                  {/* Mode word (Hug/Fill only) */}
                  {showWord ? (
                    <span className="shrink-0 truncate text-muted-foreground">
                      {modeLabel}
                    </span>
                  ) : null}
                  {/* Caret */}
                  <span className="flex shrink-0 items-center text-muted-foreground">
                    <IconChevronDown className="size-2 opacity-70" />
                  </span>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{`${axis} · ${modeLabel} — click to change sizing mode`}</TooltipContent>
          </Tooltip>
          {dropdownContent}
        </DropdownMenu>
      )}

      {/* ── Constraint sub-rows ── */}
      {hasMin ? (
        <ConstraintSubRow
          label={minLabel}
          icon={IconSizingMin}
          value={minValue ?? 0}
          disabled={disabled}
          removeLabel={labels.removeConstraint}
          onChange={(next, meta) =>
            onMinMaxChange?.(sizingAxis, "min", next, meta)
          }
          onRemove={() => {
            onMinMaxChange?.(sizingAxis, "min", null);
          }}
        />
      ) : null}
      {hasMax ? (
        <ConstraintSubRow
          label={maxLabel}
          icon={IconSizingMax}
          value={maxValue ?? 0}
          disabled={disabled}
          removeLabel={labels.removeConstraint}
          onChange={(next, meta) =>
            onMinMaxChange?.(sizingAxis, "max", next, meta)
          }
          onRemove={() => {
            onMinMaxChange?.(sizingAxis, "max", null);
          }}
        />
      ) : null}
    </div>
  );
}

function SizingMenuItem({
  icon,
  label,
  active = false,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      data-design-sizing-menu-item={label}
      disabled={disabled}
      onSelect={onSelect}
      className="gap-2 pl-2 pr-2 text-[12px]"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-[var(--design-editor-accent-color,hsl(var(--primary)))]">
        {active ? <IconCheck className="size-3" /> : null}
      </span>
    </DropdownMenuItem>
  );
}

function ConstraintSubRow({
  label,
  icon,
  value,
  disabled,
  removeLabel,
  onChange,
  onRemove,
}: {
  label: string;
  icon: NonNullable<ScrubInputProps["icon"]>;
  value: number;
  disabled: boolean;
  removeLabel: string;
  onChange: (value: number, meta?: ScrubInputChangeMeta) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-6 min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)] pl-1.5",
        disabled && "opacity-40",
      )}
    >
      <ScrubInput
        label={label}
        ariaLabel={label}
        icon={icon}
        prefix="icon"
        value={value}
        onChange={(next, meta) =>
          onChange(Math.max(0, roundToOneDecimal(next)), meta)
        }
        unit="px"
        min={0}
        step={1}
        precision={1}
        disabled={disabled}
        className="min-w-0 flex-1 gap-0"
        labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none px-0 text-muted-foreground [&>span]:sr-only"
        inputClassName="h-5 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={removeLabel}
            disabled={disabled}
            onClick={onRemove}
            className={cn(
              "flex h-6 w-5 shrink-0 items-center justify-center rounded-r-md",
              "text-muted-foreground hover:text-foreground",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color,hsl(var(--primary)))]",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <IconSizingRemove className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{removeLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
