import { IconArrowBackUp } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";

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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  AlignmentHorizontal,
  AlignmentMatrixValue,
  AlignmentVertical,
  DistributionAxis,
} from "./AlignmentMatrix";
import {
  IconFlowGrid,
  IconFlowHorizontal,
  IconFlowVertical,
  IconGap,
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
import { ScrubInput } from "./ScrubInput";

export type AutoLayoutDirection = "horizontal" | "vertical";
export type AutoLayoutWrap = "nowrap" | "wrap";
export type AutoLayoutSizing = "hug" | "fill" | "fixed";
export type AutoLayoutSizingAxis = "horizontal" | "vertical";

/**
 * The active flow option. "normal" represents block / normal-flow layout for
 * non-flex containers; the other four map to flex direction + wrap state.
 */
export type AutoLayoutFlow = "normal" | "vertical" | "horizontal" | "grid";

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
  mixedSize?: {
    horizontal?: boolean;
    vertical?: boolean;
  };
  childSizing: {
    horizontal: AutoLayoutSizing;
    vertical: AutoLayoutSizing;
  };
  /**
   * Currently-set min/max constraints per axis, in px. `null` means the
   * constraint is not set (the design editor shows the "Add min/max…" menu item instead of
   * a sub-row). Optional so existing callers are unaffected.
   */
  childMinMax?: {
    horizontal?: { min?: number | null; max?: number | null };
    vertical?: { min?: number | null; max?: number | null };
  };
  /**
   * Optional layout-mode hint. When "block" the control renders the
   * normal-flow (non-flex) state — the first flow icon is active and gap is
   * treated as disabled. Defaults to flex when omitted so existing callers are
   * unaffected.
   */
  display?: "flex" | "block";
  /**
   * When true, the gap mode is "Auto" (CSS `justify-content: space-between`).
   * When false or omitted, gap mode is "Fixed" (a numeric gap value).
   * Drives the checked state of the Fixed/Auto items in the gap dropdown.
   */
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
  onGapChange: (gap: number) => void;
  onPaddingChange: (padding: AutoLayoutPadding) => void;
  onPaddingLinkedChange: (linked: boolean) => void;
  onClipContentChange?: (clipContent: boolean) => void;
  onDistribute?: (axis: DistributionAxis) => void;
  onGapModeChange?: (mode: "fixed" | "auto", axis: DistributionAxis) => void;
  onChildSizingChange: (
    axis: AutoLayoutSizingAxis,
    sizing: AutoLayoutSizing,
  ) => void;
  /**
   * Invoked when the user directly edits the resolved size (scrub or type) in
   * fixed-sizing mode. `value` is the new size in CSS pixels. Optional —
   * when omitted the resolved-size display is read-only (mode-picker only).
   */
  onChildSizeChange?: (axis: AutoLayoutSizingAxis, value: number) => void;
  /**
   * Set or clear a min/max constraint on an axis. `value === null` clears it.
   * Optional — when omitted the "Add min/max…" rows and constraint sub-rows are
   * hidden, so existing callers are unaffected.
   */
  onChildMinMaxChange?: (
    axis: AutoLayoutSizingAxis,
    kind: "min" | "max",
    value: number | null,
  ) => void;
  /**
   * Invoked when the user picks "Apply variable…". Optional — when omitted the
   * variable row is still shown but disabled (placeholder), matching the design editor when
   * no variable collections exist.
   */
  onApplyVariable?: (axis: AutoLayoutSizingAxis) => void;
  /**
   * Emitted when the user picks a flow that changes the layout mode between
   * normal-flow (block) and flex. Pass this so selecting the first ("normal")
   * flow icon can turn auto layout off, and selecting a flex flow can turn it
   * on. Optional — when omitted the control still works in pure-flex mode.
   */
  onDisplayChange?: (display: "flex" | "block") => void;
  availableChildSizing?: Partial<
    Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>
  >;
  showChildLayoutControls?: boolean;
  labels?: Partial<AutoLayoutMatrixLabels>;
  disabled?: boolean;
  className?: string;
}

/** Default English labels for the auto-layout matrix and SizingField. */
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

/** Derive the active flow option from display + direction + wrap state. */
function getFlowOption(value: AutoLayoutMatrixValue): AutoLayoutFlow {
  if (value.display === "block") return "normal";
  if (value.wrap === "wrap") return "grid";
  if (value.direction === "vertical") return "vertical";
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
  onGapModeChange,
  onChildSizingChange,
  onChildMinMaxChange,
  onApplyVariable,
  onDisplayChange,
  onChildSizeChange,
  availableChildSizing,
  showChildLayoutControls = true,
  labels,
  disabled = false,
  className,
}: AutoLayoutMatrixProps) {
  const copy = { ...DEFAULT_AUTO_LAYOUT_LABELS, ...labels };

  // Show left/top as the representative value when padding is linked.
  // Averaging the two sides would silently destroy asymmetric padding on the
  // next edit — the onChange handler sets both sides to the same number, so
  // whatever is displayed becomes the new value for both sides. Using the
  // left/top value means scrubbing up/down from the current value preserves
  // the user's intent without a silent lossy round-trip through the average.
  const horizontalPaddingValue = value.padding.left;
  const verticalPaddingValue = value.padding.top;

  const activeFlow = getFlowOption(value);
  const isBlock = activeFlow === "normal";

  /** Apply a flow choice, coordinating display + direction + wrap. */
  const selectFlow = (flow: AutoLayoutFlow) => {
    if (flow === "normal") {
      onDisplayChange?.("block");
      return;
    }
    // Any flex flow turns auto layout on.
    onDisplayChange?.("flex");
    if (flow === "vertical") {
      onDirectionChange("vertical");
      onWrapChange("nowrap");
    } else if (flow === "horizontal") {
      onDirectionChange("horizontal");
      onWrapChange("nowrap");
    } else {
      // grid → horizontal direction with wrap
      onDirectionChange("horizontal");
      onWrapChange("wrap");
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("space-y-3", className)}>
        {/* ── Flow ── */}
        {showChildLayoutControls ? (
          <div className="space-y-1.5">
            <ControlLabel>
              {"Flow" /* i18n-ignore design inspector label */}
            </ControlLabel>
            <div className="flex items-center gap-1.5">
              {/* 4-segment flow bar: normal / vertical / horizontal / grid */}
              <div className="flex h-7 flex-1 items-center gap-0.5 rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
                <FlowButton
                  label={"Normal flow" /* i18n-ignore design inspector label */}
                  active={activeFlow === "normal"}
                  disabled={disabled}
                  onClick={() => selectFlow("normal")}
                >
                  <IconFlowNormal />
                </FlowButton>
                <FlowButton
                  label={copy.vertical}
                  active={activeFlow === "vertical"}
                  disabled={disabled}
                  onClick={() => selectFlow("vertical")}
                >
                  <IconFlowVertical className="size-3.5" />
                </FlowButton>
                <FlowButton
                  label={copy.horizontal}
                  active={activeFlow === "horizontal"}
                  disabled={disabled}
                  onClick={() => selectFlow("horizontal")}
                >
                  <IconFlowHorizontal className="size-3.5" />
                </FlowButton>
                <FlowButton
                  label={"Grid" /* i18n-ignore design inspector label */}
                  active={activeFlow === "grid"}
                  disabled={disabled}
                  onClick={() => selectFlow("grid")}
                >
                  <IconFlowGrid className="size-3.5" />
                </FlowButton>
              </div>
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
                    className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                  >
                    <IconArrowBackUp className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {"Swap flow direction" /* i18n-ignore inspector tooltip */}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : null}

        {/* ── Resizing ── */}
        <div className="space-y-1.5">
          <ControlLabel>
            {"Resizing" /* i18n-ignore design inspector label */}
          </ControlLabel>
          <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-1.5">
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
                  ? (px) => onChildSizeChange("horizontal", px)
                  : undefined
              }
              onMinMaxChange={onChildMinMaxChange}
              onApplyVariable={onApplyVariable}
            />
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
                  ? (px) => onChildSizeChange("vertical", px)
                  : undefined
              }
              onMinMaxChange={onChildMinMaxChange}
              onApplyVariable={onApplyVariable}
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
                  className="size-7 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
                >
                  <IconResizeToFitMini />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {"Resize to fit" /* i18n-ignore inspector tooltip */}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {showChildLayoutControls && !isBlock ? (
          <div className="grid grid-cols-[78px_1fr] items-start gap-3">
            <div className="space-y-1.5">
              <ControlLabel>
                {"Alignment" /* i18n-ignore design inspector label */}
              </ControlLabel>
              <CompactAlignmentMatrix
                value={value.alignment}
                onChange={onAlignmentChange}
                direction={value.direction}
                disabled={disabled}
                onDistribute={onDistribute}
              />
            </div>

            <div className="space-y-1.5">
              <ControlLabel>{copy.gap}</ControlLabel>
              <GapField
                value={value.gap}
                onGapChange={onGapChange}
                onDistribute={onDistribute}
                onGapModeChange={onGapModeChange}
                label={copy.gap}
                disabled={disabled}
                direction={value.direction}
                gapMode={value.spaceBetween ? "auto" : "fixed"}
              />
            </div>
          </div>
        ) : null}

        {/* ── Padding ── */}
        {showChildLayoutControls ? (
          <div className="space-y-1.5">
            <ControlLabel>{copy.padding}</ControlLabel>
            {value.paddingLinked ? (
              /* Default linked state: 2 compact fields + link toggle */
              <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                <PaddingField
                  icon={IconPaddingHorizontal}
                  ariaLabel={copy.paddingLeft + " / " + copy.paddingRight}
                  value={horizontalPaddingValue}
                  onChange={(next) =>
                    onPaddingChange({
                      top: value.padding.top,
                      bottom: value.padding.bottom,
                      left: next,
                      right: next,
                    })
                  }
                  disabled={disabled}
                />
                <PaddingField
                  icon={IconPaddingVertical}
                  ariaLabel={copy.paddingTop + " / " + copy.paddingBottom}
                  value={verticalPaddingValue}
                  onChange={(next) =>
                    onPaddingChange({
                      top: next,
                      bottom: next,
                      left: value.padding.left,
                      right: value.padding.right,
                    })
                  }
                  disabled={disabled}
                />
                <PaddingLinkButton
                  linked
                  disabled={disabled}
                  linkLabel={copy.linkPadding}
                  unlinkLabel={copy.unlinkPadding}
                  onToggle={() => onPaddingLinkedChange(false)}
                />
              </div>
            ) : (
              /* Unlinked state: expand to 4 separate T / R / B / L fields */
              <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                <div className="col-span-2 grid grid-cols-2 gap-1.5">
                  <PaddingField
                    icon={IconPaddingTopMini}
                    ariaLabel={copy.paddingTop}
                    value={value.padding.top}
                    onChange={(next) =>
                      onPaddingChange({ ...value.padding, top: next })
                    }
                    disabled={disabled}
                  />
                  <PaddingField
                    icon={IconPaddingRightMini}
                    ariaLabel={copy.paddingRight}
                    value={value.padding.right}
                    onChange={(next) =>
                      onPaddingChange({ ...value.padding, right: next })
                    }
                    disabled={disabled}
                  />
                  <PaddingField
                    icon={IconPaddingBottomMini}
                    ariaLabel={copy.paddingBottom}
                    value={value.padding.bottom}
                    onChange={(next) =>
                      onPaddingChange({ ...value.padding, bottom: next })
                    }
                    disabled={disabled}
                  />
                  <PaddingField
                    icon={IconPaddingLeftMini}
                    ariaLabel={copy.paddingLeft}
                    value={value.padding.left}
                    onChange={(next) =>
                      onPaddingChange({ ...value.padding, left: next })
                    }
                    disabled={disabled}
                  />
                </div>
                <PaddingLinkButton
                  linked={false}
                  disabled={disabled}
                  linkLabel={copy.linkPadding}
                  unlinkLabel={copy.unlinkPadding}
                  onToggle={() => onPaddingLinkedChange(true)}
                />
              </div>
            )}
          </div>
        ) : null}

        {/* ── Clip content ── */}
        {showChildLayoutControls ? (
          <label className="flex h-6 cursor-pointer items-center gap-2 !text-[11px] text-foreground">
            <Checkbox
              checked={Boolean(value.clipContent)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onClipContentChange?.(checked === true)
              }
              className="size-3.5 rounded-[3px]"
            />
            <span>{copy.clipContent}</span>
          </label>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

/** Keep the current value selectable even if it's not in the available list. */
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

// ─────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────

/**
 * Compact 3×3 alignment grid (no border box). Inactive cells show a faint dot;
 * the active cell shows accent bars oriented by flow — horizontal bars for a
 * vertical flow, vertical bars for a horizontal flow (editor convention).
 * When `onDistribute` is provided, two distribute buttons (H + V) are rendered
 * below the grid, matching the design editor's inspector layout.
 */
function CompactAlignmentMatrix({
  value,
  onChange,
  direction,
  disabled,
  onDistribute,
}: {
  value: AlignmentMatrixValue;
  onChange: (value: AlignmentMatrixValue) => void;
  direction: AutoLayoutDirection;
  disabled: boolean;
  onDistribute?: (axis: DistributionAxis) => void;
}) {
  return (
    <div
      className={cn("space-y-1", disabled && "pointer-events-none opacity-40")}
    >
      <div className={cn("grid w-fit grid-cols-3 rounded-md")}>
        {ALIGNMENT_CELLS.map((cell) => {
          const active =
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
                "flex size-[22px] items-center justify-center rounded-[3px] transition-colors",
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
                <IconDistributeH />
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
                <IconDistributeV />
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

/** Accent bars showing items packed toward the active edge, oriented by flow. */
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
  // Vertical flow → children stack vertically → render horizontal bars.
  // Horizontal flow → children sit in a row → render vertical bars.
  const stack = direction === "vertical";
  const box = 14;
  const pad = 2.5;
  const thickness = 2;
  const length = 5;
  const shortLength = 3.5;
  const gap = 1.5;

  // Position the group of two bars toward the active edge.
  const total = stack
    ? thickness * 2 + gap // height when bars are horizontal
    : thickness * 2 + gap; // width when bars are vertical

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
          // Horizontal bars: vary X by horizontal align, stack along Y.
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
        // Vertical bars: vary Y by vertical align, distribute along X.
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

/** Small uppercase muted section label, 11px. */
function ControlLabel({ children }: { children: ReactNode }) {
  return (
    <span className="block !text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** A single segment in the flow segmented control. */
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

/**
 * Gap field: [icon] value [▾] with a sliders icon to the right.
 * The chevron dropdown offers Fixed (numeric gap) vs Auto (space-between).
 */
function GapField({
  value,
  onGapChange,
  onDistribute,
  onGapModeChange,
  label,
  disabled,
  direction,
  gapMode = "fixed",
}: {
  value: number;
  onGapChange: (gap: number) => void;
  onDistribute?: (axis: DistributionAxis) => void;
  onGapModeChange?: (mode: "fixed" | "auto", axis: DistributionAxis) => void;
  label: string;
  disabled: boolean;
  direction: AutoLayoutDirection;
  gapMode?: "fixed" | "auto";
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* [gap-icon] value [▾] in one control surface */}
      <div
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center rounded-md bg-[var(--design-editor-control-bg)]",
          disabled && "opacity-40",
        )}
      >
        <ScrubInput
          label={label}
          ariaLabel={label}
          tooltipLabel={label}
          icon={IconGap}
          value={value}
          onChange={(next) => onGapChange(next)}
          unit="px"
          min={0}
          step={1}
          precision={1}
          disabled={disabled}
          className="min-w-0 flex-1 gap-0"
          labelClassName="h-7 w-6 justify-center gap-0 rounded-l-md rounded-r-none text-muted-foreground [&>span]:hidden"
          inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
        />
        {onDistribute != null ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={"Gap mode" /* i18n-ignore inspector tooltip */}
                    disabled={disabled}
                    className={cn(
                      "flex h-7 w-6 shrink-0 items-center justify-center rounded-r-md",
                      "text-muted-foreground hover:text-foreground",
                      "disabled:pointer-events-none disabled:opacity-40",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color,hsl(var(--primary)))]",
                    )}
                  >
                    <ChevronDownMini />
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
                checked={gapMode !== "auto"}
                className="text-[12px]"
                onSelect={() => onGapModeChange?.("fixed", direction)}
              >
                {"Fixed" /* i18n-ignore design gap mode label */}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={gapMode === "auto"}
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
      {/* Sliders / advanced spacing icon (the design editor's tune control) */}
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
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
          >
            <IconSlidersMini />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {"Advanced gap settings" /* i18n-ignore inspector tooltip */}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** A compact padding field: [icon] value. */
function PaddingField({
  icon: Icon,
  ariaLabel,
  value,
  onChange,
  disabled,
}: {
  icon: (props: { className?: string }) => ReactNode;
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)]",
        disabled && "opacity-40",
      )}
    >
      <ScrubInput
        label={ariaLabel}
        ariaLabel={ariaLabel}
        tooltipLabel={ariaLabel}
        icon={Icon}
        value={value}
        onChange={(next) => onChange(next)}
        unit="px"
        min={0}
        step={1}
        precision={1}
        disabled={disabled}
        className="min-w-0 flex-1 gap-0"
        labelClassName="h-7 w-6 justify-center gap-0 rounded-l-md rounded-r-none text-muted-foreground [&>span]:hidden"
        inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

/** Link / unlink padding toggle button. */
function PaddingLinkButton({
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
            "size-7 shrink-0 rounded-md hover:bg-[var(--design-editor-control-bg)]",
            linked
              ? "text-[var(--design-editor-accent-color,hsl(var(--primary)))] hover:text-[var(--design-editor-accent-color,hsl(var(--primary)))]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {linked ? <IconPaddingLinked /> : <IconPaddingUnlinked />}
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
  /** Display letter ("W" / "H"). */
  axis: string;
  /** Logical axis used by min/max + variable callbacks. */
  sizingAxis: AutoLayoutSizingAxis;
  value: AutoLayoutSizing;
  resolvedSize?: number;
  mixed?: boolean;
  /** Currently-set min/max constraints (px). */
  minMax?: SizingFieldMinMax;
  options?: AutoLayoutSizing[];
  /** Optional label overrides; English defaults are used for any omitted key. */
  labels?: Partial<AutoLayoutMatrixLabels>;
  disabled: boolean;
  onChange: (value: AutoLayoutSizing) => void;
  /**
   * Invoked when the user directly scrubs or types a new pixel value while in
   * "fixed" sizing mode. When omitted the numeric display is read-only and the
   * entire trigger is a mode-picker dropdown (legacy behaviour).
   */
  onSizeChange?: (px: number) => void;
  onMinMaxChange?: (
    axis: AutoLayoutSizingAxis,
    kind: "min" | "max",
    value: number | null,
  ) => void;
  onApplyVariable?: (axis: AutoLayoutSizingAxis) => void;
}

/**
 * design-editor sizing field. Trigger renders `[axis | value | mode ▾]`; the menu
 * is the full design resizing dropdown:
 *   Fixed · Hug contents · Fill container
 *   ──────────────────────
 *   Add min … · Add max …
 *   ──────────────────────
 *   Apply variable …
 * "Add min/max" reveals an inline number input; set constraints render as a
 * small sub-row below the trigger with a remove (×). Hug/Fill rows are gated by
 * the `options` list (per-axis availability); Fixed is always present.
 */
export function SizingField({
  axis,
  sizingAxis,
  value,
  resolvedSize,
  mixed = false,
  minMax,
  options = SIZING_OPTIONS,
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

  // design rule: when Fixed, show ONLY the numeric value + chevron (no word).
  // When Hug / Fill, show value + the mode word.
  const showWord = value !== "fixed";

  const addMinLabel = isWidth ? labels.addMinWidth : labels.addMinHeight;
  const addMaxLabel = isWidth ? labels.addMaxWidth : labels.addMaxHeight;
  const minLabel = isWidth ? labels.minWidth : labels.minHeight;
  const maxLabel = isWidth ? labels.maxWidth : labels.maxHeight;

  // Whether we're in editable fixed mode (ScrubInput shown for size).
  const isEditableFixed = value === "fixed" && onSizeChange != null;

  const openEditor = (kind: "min" | "max") => {
    // Commit immediately so the shown row always reflects real state and
    // persists across selection changes, remounts, and parent re-renders.
    const seed = Math.max(0, Math.round(resolvedSize ?? 0));
    const seedValue = kind === "min" ? seed : seed || 1;
    onMinMaxChange?.(sizingAxis, kind, seedValue);
  };

  // Shared dropdown content (mode picker menu).
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
        active={value === "fixed"}
        onSelect={() => onChange("fixed")}
      />
      {canHug ? (
        <SizingMenuItem
          icon={<IconSizingHug />}
          label={labels.hugContents}
          active={value === "hug"}
          onSelect={() => onChange("hug")}
        />
      ) : null}
      {canFill ? (
        <SizingMenuItem
          icon={<IconSizingFill />}
          label={labels.fillContainer}
          active={value === "fill"}
          onSelect={() => onChange("fill")}
        />
      ) : null}

      {/* ── Min / Max ── */}
      {onMinMaxChange ? (
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
      <DropdownMenuSeparator />
      <SizingMenuItem
        icon={<IconSizingVariable />}
        label={labels.applyVariable}
        disabled={!onApplyVariable}
        onSelect={() => onApplyVariable?.(sizingAxis)}
      />
    </DropdownMenuContent>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {isEditableFixed ? (
        /*
         * Editable fixed mode: split the trigger into two zones —
         *   [axis letter | ScrubInput (numeric) | ▾ mode-picker caret]
         * The ScrubInput occupies the center and lets the user type or
         * drag-to-scrub the size in px. The chevron opens the mode dropdown.
         */
        <DropdownMenu>
          <div
            className={cn(
              "flex h-7 w-full items-center overflow-hidden rounded-md",
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
              value={mixed ? 0 : Math.round(resolvedSize ?? 0)}
              onChange={(next) => onSizeChange!(Math.max(0, Math.round(next)))}
              mixed={mixed}
              unit="px"
              min={0}
              step={1}
              precision={0}
              disabled={disabled}
              className="min-w-0 flex-1 gap-0"
              labelClassName="h-7 w-5 justify-center gap-0 rounded-l-md rounded-r-none px-0 text-muted-foreground"
              inputClassName="h-6 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
            />
            {/* Caret opens the mode picker */}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${axis} sizing mode — ${labels[value]}`}
                    disabled={disabled}
                    className={cn(
                      "flex h-7 w-6 shrink-0 items-center justify-center rounded-r-md",
                      "text-muted-foreground hover:text-foreground",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color,hsl(var(--primary)))]",
                    )}
                  >
                    <ChevronDownMini />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {`${axis} · ${labels[value]} — click to change sizing mode`}
              </TooltipContent>
            </Tooltip>
          </div>
          {dropdownContent}
        </DropdownMenu>
      ) : (
        /*
         * Non-editable / hug / fill mode: keep the original single-button
         * dropdown trigger showing [axis | resolved size | mode word | ▾].
         */
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${axis} ${mixed ? "Mixed" : Math.round(resolvedSize ?? 0)} ${labels[value]}`}
                  disabled={disabled}
                  className={cn(
                    "flex h-7 w-full items-center gap-1 overflow-hidden rounded-md px-1.5",
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
                    {mixed ? "Mixed" : Math.round(resolvedSize ?? 0)}
                  </span>
                  {/* Mode word (Hug/Fill only) */}
                  {showWord ? (
                    <span className="shrink-0 truncate text-muted-foreground">
                      {labels[value]}
                    </span>
                  ) : null}
                  {/* Caret */}
                  <span className="flex shrink-0 items-center text-muted-foreground">
                    <ChevronDownMini />
                  </span>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{`${axis} · ${labels[value]} — click to change sizing mode`}</TooltipContent>
          </Tooltip>
          {dropdownContent}
        </DropdownMenu>
      )}

      {/* ── Constraint sub-rows ── */}
      {hasMin ? (
        <ConstraintSubRow
          label={minLabel}
          value={minValue ?? 0}
          disabled={disabled}
          removeLabel={labels.removeConstraint}
          onChange={(next) => onMinMaxChange?.(sizingAxis, "min", next)}
          onRemove={() => {
            onMinMaxChange?.(sizingAxis, "min", null);
          }}
        />
      ) : null}
      {hasMax ? (
        <ConstraintSubRow
          label={maxLabel}
          value={maxValue ?? 0}
          disabled={disabled}
          removeLabel={labels.removeConstraint}
          onChange={(next) => onMinMaxChange?.(sizingAxis, "max", next)}
          onRemove={() => {
            onMinMaxChange?.(sizingAxis, "max", null);
          }}
        />
      ) : null}
    </div>
  );
}

/** A single icon + label row in the sizing menu, with an active checkmark. */
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
      disabled={disabled}
      onSelect={onSelect}
      className="gap-2 pl-2 pr-2 text-[12px]"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-[var(--design-editor-accent-color,hsl(var(--primary)))]">
        {active ? <CheckMini /> : null}
      </span>
    </DropdownMenuItem>
  );
}

/** Inline min/max constraint editor row with a remove (×) affordance. */
function ConstraintSubRow({
  label,
  value,
  disabled,
  removeLabel,
  onChange,
  onRemove,
}: {
  label: string;
  value: number;
  disabled: boolean;
  removeLabel: string;
  onChange: (value: number) => void;
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
        value={value}
        onChange={(next) => onChange(Math.max(0, Math.round(next)))}
        unit="px"
        min={0}
        step={1}
        precision={1}
        disabled={disabled}
        className="min-w-0 flex-1 gap-0"
        labelClassName="hidden"
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
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <IconSizingRemove />
          </button>
        </TooltipTrigger>
        <TooltipContent>{removeLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Small check glyph for the active menu row. */
function CheckMini() {
  return (
    <svg
      viewBox="0 0 14 14"
      width={12}
      height={12}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 7.5 L5.5 10.5 L11.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────
// Inline SVG glyphs (Tabler-weight, 24px viewBox)
// ─────────────────────────────────────────────────

/** Minimal downward chevron — matches the design caret weight. */
function ChevronDownMini() {
  return (
    <svg
      viewBox="0 0 8 8"
      width={8}
      height={8}
      fill="none"
      aria-hidden="true"
      className="opacity-70"
    >
      <path
        d="M1.5 3 L4 5.5 L6.5 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Normal / free-flow layout glyph — loosely placed small rects. */
function IconFlowNormal() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="6" width="6" height="6" rx="1.5" />
      <rect x="6" y="14" width="6" height="6" rx="1.5" />
    </svg>
  );
}

/** Resize-to-fit diagonal arrows. */
function IconResizeToFitMini() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4 H5 a1 1 0 0 0 -1 1 V9" />
      <path d="M15 4 H19 a1 1 0 0 1 1 1 V9" />
      <path d="M9 20 H5 a1 1 0 0 1 -1 -1 V15" />
      <path d="M15 20 H19 a1 1 0 0 0 1 -1 V15" />
    </svg>
  );
}

/** Sliders / tune icon for advanced gap settings. */
function IconSlidersMini() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="8" y1="4" x2="8" y2="20" />
      <line x1="16" y1="4" x2="16" y2="20" />
      <circle cx="8" cy="9" r="2.2" fill="var(--design-editor-panel-bg)" />
      <circle cx="16" cy="15" r="2.2" fill="var(--design-editor-panel-bg)" />
    </svg>
  );
}

/** Padding linked (all four sides) glyph. */
function IconPaddingLinked() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

/** Padding unlinked glyph (dashed inner frame). */
function IconPaddingUnlinked() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

/** Per-side padding glyphs — frame with one thick edge. */
function IconPaddingTopMini({ className }: { className?: string }) {
  return <PaddingSideGlyph className={className} side="top" />;
}
function IconPaddingRightMini({ className }: { className?: string }) {
  return <PaddingSideGlyph className={className} side="right" />;
}
function IconPaddingBottomMini({ className }: { className?: string }) {
  return <PaddingSideGlyph className={className} side="bottom" />;
}
function IconPaddingLeftMini({ className }: { className?: string }) {
  return <PaddingSideGlyph className={className} side="left" />;
}

type PaddingSide = "top" | "right" | "bottom" | "left";

const PADDING_EDGE: Record<PaddingSide, [number, number, number, number]> = {
  top: [4, 4, 20, 4],
  right: [20, 4, 20, 20],
  bottom: [4, 20, 20, 20],
  left: [4, 4, 4, 20],
};

function PaddingSideGlyph({
  side,
  className,
}: {
  side: PaddingSide;
  className?: string;
}) {
  const [x1, y1, x2, y2] = PADDING_EDGE[side];
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-3.5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" opacity="0.4" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="3" />
    </svg>
  );
}

/** Distribute horizontal spacing (space-between on main/cross axis). */
function IconDistributeH() {
  return (
    <svg
      viewBox="0 0 14 14"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* left edge line */}
      <line x1="1.5" y1="2" x2="1.5" y2="12" />
      {/* right edge line */}
      <line x1="12.5" y1="2" x2="12.5" y2="12" />
      {/* center block */}
      <rect
        x="4.5"
        y="4"
        width="5"
        height="6"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.5"
      />
    </svg>
  );
}

/** Distribute vertical spacing (space-between on cross/main axis). */
function IconDistributeV() {
  return (
    <svg
      viewBox="0 0 14 14"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* top edge line */}
      <line x1="2" y1="1.5" x2="12" y2="1.5" />
      {/* bottom edge line */}
      <line x1="2" y1="12.5" x2="12" y2="12.5" />
      {/* center block */}
      <rect
        x="4"
        y="4.5"
        width="6"
        height="5"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.5"
      />
    </svg>
  );
}
