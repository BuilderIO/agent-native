import { useT } from "@agent-native/core/client";
import {
  IconLayoutGrid,
  IconLink,
  IconLinkOff,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  AutoLayoutMatrix,
  ScrubInput,
  SizingField,
  type AutoLayoutFlow,
  type AutoLayoutGridTrackSizing,
  type AutoLayoutGridValue,
  type AutoLayoutMatrixValue,
  type ScrubInputChangeMeta,
} from "../inspector";
import type { ElementInfo } from "../types";
import {
  autoLayoutAlignmentFromStyles,
  availableSizingForElement,
  commitElementMinMax,
  commitElementSizing,
  cssElementSize,
  horizontalToJustify,
  inferElementSizing,
  isContainerElement,
  isParentFlex,
  isParentGrid,
  readElementMinMax,
  verticalToAlign,
} from "./element-classification";
import {
  deriveLockedAspectSize,
  elementStableKey,
  useAspectRatioLock,
} from "./element-identity";
import { FieldTrailer, ScrubStyleInput } from "./field-primitives";
import { joinCssLayers, splitCssLayers } from "./fill-gradient-helpers";
import { SectionIconButton } from "./inspector-controls";
import {
  PanelSection,
  PropInput,
  PropSelect,
  SubsectionLabel,
} from "./panel-primitives";
import { compactCssValue, fourValuesEqual } from "./position-helpers";
import { isMixedValue } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";
import {
  ALIGN_SELF_OPTIONS,
  optionValue,
  parseNumericValue,
} from "./style-options";

/**
 * The `justifyContent` to write when the primary-axis gap-mode toggle
 * changes. "Auto" gap mode IS `justify-content: space-between` (see
 * `spaceBetween` on `AutoLayoutMatrixValue`); switching back to "Fixed"
 * should restore whichever packed alignment (flex-start/center/flex-end) was
 * in effect before "Auto" was turned on, not hard-reset to flex-start —
 * mirrors Figma, where turning off "Space between" returns to the
 * previously chosen start/center/end packing instead of silently
 * re-aligning everything to the start. `lastPackedJustify` is the caller's
 * best-known non-"space-between" `justifyContent` (see
 * `lastPackedJustifyRef` at the call site). Exported for tests.
 */
export function justifyContentForGapMode(
  gapMode: "auto" | "fixed",
  lastPackedJustify: string,
): string {
  return gapMode === "auto" ? "space-between" : lastPackedJustify;
}

export function autoLayoutStylesForFlow(
  flow: AutoLayoutFlow,
  currentStyles: Record<string, string> = {},
): Record<string, string> {
  if (flow === "normal") return { display: "block" };
  if (flow === "vertical") {
    return { display: "flex", flexDirection: "column", flexWrap: "nowrap" };
  }
  if (flow === "grid") {
    const authoredColumns = currentStyles.gridTemplateColumns;
    const authoredRows = currentStyles.gridTemplateRows;
    return {
      display: "grid",
      gridTemplateColumns:
        authoredColumns && authoredColumns !== "none"
          ? authoredColumns
          : "repeat(2, minmax(0, 1fr))",
      gridTemplateRows:
        authoredRows && authoredRows !== "none"
          ? authoredRows
          : "repeat(1, max-content)",
      gridAutoFlow: currentStyles.gridAutoFlow || "row",
    };
  }
  return { display: "flex", flexDirection: "row", flexWrap: "nowrap" };
}

function splitGridTracks(template: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < template.length; index += 1) {
    const character = template[index];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      const track = template.slice(start, index).trim();
      if (track) tracks.push(track);
      start = index + 1;
    }
  }
  const last = template.slice(start).trim();
  if (last) tracks.push(last);
  return tracks;
}

/** Parse the common uniform grid forms while preserving arbitrary authored CSS. */
export function parseGridTemplate(template: string): {
  count: number;
  sizing: AutoLayoutGridTrackSizing;
  fixedSize?: number;
} {
  const normalized = template.trim();
  const repeat = normalized.match(/^repeat\(\s*(\d+)\s*,\s*(.+)\)$/i);
  const count = repeat
    ? Math.max(1, Number.parseInt(repeat[1], 10))
    : Math.max(1, splitGridTracks(normalized).length);
  const tracks = repeat ? [repeat[2].trim()] : splitGridTracks(normalized);
  const first = tracks[0] || "";
  const uniform = tracks.every((track) => track === first);
  if (!uniform) return { count, sizing: "custom" };
  if (/^(?:minmax\(\s*0(?:px)?\s*,\s*)?1fr\)?$/i.test(first)) {
    return { count, sizing: "fill" };
  }
  if (/^(?:max-content|min-content|auto)$/i.test(first)) {
    return { count, sizing: "hug" };
  }
  const fixed = first.match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (fixed) {
    return { count, sizing: "fixed", fixedSize: Number(fixed[1]) };
  }
  return { count, sizing: "custom" };
}

export function gridTemplateForTracks(
  count: number,
  sizing: AutoLayoutGridTrackSizing,
  fixedSize: number | undefined,
  authoredTemplate: string | undefined,
): string {
  const safeCount = Math.max(1, Math.round(count));
  if (sizing === "custom" && authoredTemplate) return authoredTemplate;
  if (sizing === "hug") return `repeat(${safeCount}, max-content)`;
  if (sizing === "fixed") {
    return `repeat(${safeCount}, ${Math.max(0, fixedSize ?? 100)}px)`;
  }
  return `repeat(${safeCount}, minmax(0, 1fr))`;
}

function authoredGridTemplate(
  element: ElementInfo,
  property: "gridTemplateColumns" | "gridTemplateRows",
): string {
  return (
    element.inlineStyles?.[property] || element.computedStyles[property] || ""
  );
}

export function gridValueForElement(element: ElementInfo): AutoLayoutGridValue {
  const columnsTemplate = authoredGridTemplate(element, "gridTemplateColumns");
  const rowsTemplate = authoredGridTemplate(element, "gridTemplateRows");
  const columns = parseGridTemplate(columnsTemplate);
  const rows = parseGridTemplate(rowsTemplate);
  return {
    columns: columns.count,
    rows: rows.count,
    columnSizing: columns.sizing,
    rowSizing: rows.sizing,
    columnSize: columns.fixedSize,
    rowSize: rows.fixedSize,
    columnTemplate: columnsTemplate,
    rowTemplate: rowsTemplate,
    columnGap: parseNumericValue(element.computedStyles.columnGap || "0"),
    rowGap: parseNumericValue(element.computedStyles.rowGap || "0"),
    columnsMixed: isMixedValue(columnsTemplate),
    rowsMixed: isMixedValue(rowsTemplate),
    columnGapMixed: isMixedValue(element.computedStyles.columnGap),
    rowGapMixed: isMixedValue(element.computedStyles.rowGap),
  };
}

/** Flex container properties */
function FlexContainerControls({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  // The element's CURRENT layout flow as authored in code, read from its own
  // computed `display`: block/flow-root/grid/etc. = "normal flow",
  // flex/inline-flex = auto layout. We forward it so the AutoLayoutMatrix Flow
  // control can show the right state (normal vs horizontal/vertical/wrap)
  // instead of an empty "add" affordance.
  const display = (styles.display || "").toLowerCase();
  const isGrid = element.isGridContainer || display.includes("grid");
  const isFlex = element.isFlexContainer || display.includes("flex");
  const displayMode: AutoLayoutMatrixValue["display"] = isGrid
    ? "grid"
    : isFlex
      ? "flex"
      : "block";
  const flowMixed = [
    styles.display,
    styles.flexDirection,
    styles.flexWrap,
    styles.gridTemplateColumns,
    styles.gridTemplateRows,
  ].some(isMixedValue);
  const flexDirection: AutoLayoutMatrixValue["direction"] =
    styles.flexDirection?.includes("column") ? "vertical" : "horizontal";
  // `justifyContent` is always the main-axis property in flexbox regardless
  // of direction, so it doubles as the "packed" (start/center/end) main-axis
  // alignment AND the gap-mode signal ("space-between" = Auto gap, see
  // `spaceBetween` below). Remember the last non-"space-between" value here
  // so turning gap mode back to Fixed can restore the user's chosen packed
  // alignment (see onGapModeChange) instead of hard-resetting to flex-start
  // — mirrors Figma, where switching a container's primary-axis distribution
  // away from "Space between" returns to whichever start/center/end packing
  // was previously selected.
  const lastPackedJustifyRef = useRef(
    styles.justifyContent && styles.justifyContent !== "space-between"
      ? styles.justifyContent
      : "flex-start",
  );
  useEffect(() => {
    if (styles.justifyContent && styles.justifyContent !== "space-between") {
      lastPackedJustifyRef.current = styles.justifyContent;
    }
  }, [styles.justifyContent]);
  const mainGapAxis =
    flexDirection === "horizontal" ? "horizontal" : "vertical";
  // When the element is in normal flow (not flex yet), picking any flow option
  // must first turn it into a flex container; otherwise setting flex-direction
  // alone is a no-op against a block element.
  const ensureFlex = () => {
    if (!isFlex) onStyleChange("display", "flex");
  };

  /**
   * Handle the Flow control switching between flex and normal-flow (block).
   *
   * For 'flex': ensures display:flex is set (ensureFlex path).
   * For 'block': sets display:block and leaves children unchanged — mirrors
   * the { kind:"autoLayout", enabled:false } substrate intent exactly.
   */
  const handleDisplayChange = (nextDisplay: "flex" | "grid" | "block") => {
    if (nextDisplay === "grid") {
      onStyleChange("display", "grid");
      return;
    }
    if (nextDisplay === "flex") {
      ensureFlex();
      return;
    }
    // Turn auto-layout off: set display:block, leaving children unchanged.
    // This is the direct equivalent of the autoLayout substrate with enabled:false.
    onStyleChange("display", "block");
  };

  const padding = {
    top: parseNumericValue(styles.paddingTop || "0"),
    right: parseNumericValue(styles.paddingRight || "0"),
    bottom: parseNumericValue(styles.paddingBottom || "0"),
    left: parseNumericValue(styles.paddingLeft || "0"),
  };
  const allPaddingEqual = fourValuesEqual([
    padding.top,
    padding.right,
    padding.bottom,
    padding.left,
  ]);
  // Seeds the linked/unlinked view once per selection (this component is
  // remounted per element via the `key={elementIdentityKey(element)}` at its
  // call site, matching CornerRadiusControl's pattern) and is otherwise a
  // pure user-controlled toggle (see onPaddingLinkedChange below). Do NOT add
  // a useEffect that re-derives this from `allPaddingEqual` on every render:
  // that previously auto-unlinked as soon as the four sides became unequal,
  // which fires mid-drag the instant a user scrubs one axis of the linked
  // horizontal/vertical fields (e.g. changing left/right while top/bottom
  // stay put) — collapsing the linked 2-field view into the unlinked 4-field
  // view *during* the gesture and destroying the drag (STEVE TEST BATCH 4 #4).
  const [paddingLinked, setPaddingLinked] = useState(allPaddingEqual);

  const autoLayoutValue: AutoLayoutMatrixValue = {
    direction: flexDirection,
    wrap: styles.flexWrap === "wrap" ? "wrap" : "nowrap",
    alignment: autoLayoutAlignmentFromStyles(
      isGrid ? { ...styles, justifyContent: styles.justifyItems } : styles,
      isGrid ? "horizontal" : flexDirection,
    ),
    alignmentMixed: [
      styles.justifyContent,
      styles.alignItems,
      styles.alignContent,
      ...(isGrid ? [styles.justifyItems] : []),
    ].some(isMixedValue),
    gap: parseNumericValue(styles.gap || "0"),
    // Multi-selections with differing gap/padding surface the MIXED_VALUE
    // sentinel here; parseNumericValue would silently coerce it to 0 (a
    // real-looking value that would clobber every element on edit), so flag
    // each field so AutoLayoutMatrix renders a "Mixed" placeholder instead.
    gapMixed: isMixedValue(styles.gap),
    gapModeMixed: isMixedValue(styles.justifyContent),
    padding,
    paddingMixed: {
      top: isMixedValue(styles.paddingTop),
      right: isMixedValue(styles.paddingRight),
      bottom: isMixedValue(styles.paddingBottom),
      left: isMixedValue(styles.paddingLeft),
    },
    paddingLinked,
    childSizing: {
      horizontal: inferElementSizing(element, "horizontal"),
      vertical: inferElementSizing(element, "vertical"),
    },
    childMinMax: {
      horizontal: readElementMinMax(element, "horizontal"),
      vertical: readElementMinMax(element, "vertical"),
    },
    clipContent: styles.overflow === "hidden",
    clipContentMixed: isMixedValue(styles.overflow),
    resolvedSize: {
      horizontal: cssElementSize(element, "horizontal"),
      vertical: cssElementSize(element, "vertical"),
    },
    mixedSize: {
      horizontal: isMixedValue(styles.width),
      vertical: isMixedValue(styles.height),
    },
    display: displayMode,
    flowMixed,
    spaceBetween: styles.justifyContent === "space-between",
    grid: isGrid ? gridValueForElement(element) : undefined,
  };

  return (
    <div className="space-y-2">
      <AutoLayoutMatrix
        value={autoLayoutValue}
        onFlowChange={(flow) => {
          const patch = autoLayoutStylesForFlow(flow, {
            ...styles,
            ...element.inlineStyles,
          });
          if (onStylesChange) {
            onStylesChange(patch);
            return;
          }
          Object.entries(patch).forEach(([property, value]) =>
            onStyleChange(property, value),
          );
        }}
        onDisplayChange={handleDisplayChange}
        onDirectionChange={(direction) => {
          ensureFlex();
          onStyleChange(
            "flexDirection",
            direction === "vertical" ? "column" : "row",
          );
        }}
        onWrapChange={(wrap) => {
          ensureFlex();
          onStyleChange("flexWrap", wrap);
        }}
        onGridChange={(nextGrid, meta) => {
          const previousGrid = autoLayoutValue.grid;
          const columnTemplate = gridTemplateForTracks(
            nextGrid.columns,
            nextGrid.columnSizing,
            nextGrid.columnSize,
            nextGrid.columnSizing === "custom" &&
              previousGrid?.columns === nextGrid.columns
              ? nextGrid.columnTemplate
              : undefined,
          );
          const rowTemplate = gridTemplateForTracks(
            nextGrid.rows,
            nextGrid.rowSizing,
            nextGrid.rowSize,
            nextGrid.rowSizing === "custom" &&
              previousGrid?.rows === nextGrid.rows
              ? nextGrid.rowTemplate
              : undefined,
          );
          const patch = {
            display: "grid",
            gridTemplateColumns: columnTemplate,
            gridTemplateRows: rowTemplate,
            gridAutoFlow: "row",
            columnGap: `${nextGrid.columnGap}px`,
            rowGap: `${nextGrid.rowGap}px`,
          };
          if (onStylesChange) {
            onStylesChange(patch, meta);
            return;
          }
          Object.entries(patch).forEach(([property, value]) =>
            onStyleChange(property, value, meta),
          );
        }}
        onAlignmentChange={(alignment) => {
          if (displayMode === "grid") {
            onStyleChange(
              "justifyItems",
              horizontalToJustify(alignment.horizontal),
            );
            onStyleChange("alignItems", verticalToAlign(alignment.vertical));
            return;
          }
          if (autoLayoutValue.direction === "vertical") {
            onStyleChange(
              "alignItems",
              horizontalToJustify(alignment.horizontal),
            );
            onStyleChange(
              "justifyContent",
              verticalToAlign(alignment.vertical),
            );
            return;
          }
          onStyleChange(
            "justifyContent",
            horizontalToJustify(alignment.horizontal),
          );
          onStyleChange("alignItems", verticalToAlign(alignment.vertical));
        }}
        onGapChange={(gap, meta) => onStyleChange("gap", `${gap}px`, meta)}
        onPaddingChange={(nextPadding, meta) => {
          // Forward ScrubInput's gesture meta so preview ticks ride the host's
          // live fast path and only the release commit persists (B5-14:
          // dropping it here made padding scrubs invisible until reselect).
          // Batch all four sides into one styles change when the host
          // supports it so each tick/commit is a single message instead of
          // four.
          const patch = {
            paddingTop: `${nextPadding.top}px`,
            paddingRight: `${nextPadding.right}px`,
            paddingBottom: `${nextPadding.bottom}px`,
            paddingLeft: `${nextPadding.left}px`,
          };
          if (onStylesChange) {
            onStylesChange(patch, meta);
            return;
          }
          Object.entries(patch).forEach(([property, value]) =>
            onStyleChange(property, value, meta),
          );
        }}
        onPaddingLinkedChange={(linked) => {
          setPaddingLinked(linked);
          // Linking is a display-mode choice, not a style edit. Figma keeps
          // asymmetric padding intact when the sides are linked and only
          // equalizes an axis after the user edits that linked field. The old
          // eager average destroyed all four authored values immediately and
          // produced four source commits/undo entries just from clicking the
          // link icon. AutoLayoutMatrix intentionally displays left/top as
          // each linked axis's representative value and applies both sides on
          // the next real field edit, so no style write belongs here.
        }}
        onClipContentChange={(clipContent) =>
          onStyleChange("overflow", clipContent ? "hidden" : "visible")
        }
        onDistribute={
          displayMode === "grid"
            ? undefined
            : (axis) => {
                if (axis === mainGapAxis) {
                  onStyleChange("justifyContent", "space-between");
                } else if (autoLayoutValue.wrap === "wrap") {
                  onStyleChange("alignContent", "space-between");
                }
              }
        }
        onGapModeChange={(gapMode, axis) => {
          if (axis !== mainGapAxis) return;
          ensureFlex();
          onStyleChange(
            "justifyContent",
            justifyContentForGapMode(gapMode, lastPackedJustifyRef.current),
          );
        }}
        availableChildSizing={availableSizingForElement(element)}
        onChildSizingChange={(axis, sizing) => {
          commitElementSizing(
            element,
            axis,
            sizing,
            onStyleChange,
            onStylesChange,
          );
        }}
        onChildSizeChange={(axis, px, meta) =>
          onStyleChange(
            axis === "horizontal" ? "width" : "height",
            `${px}px`,
            meta,
          )
        }
        onChildMinMaxChange={(axis, kind, val, meta) =>
          commitElementMinMax(axis, kind, val, onStyleChange, meta)
        }
        // Empty frames/rectangles still need the complete Flow + Padding
        // surface: users must be able to turn auto layout on before adding a
        // first child, just as they can for an empty frame in Figma. The old
        // child-count gate left an "Auto layout" section containing only
        // Resizing, with no way to enable auto layout from the inspector.
        showChildLayoutControls
      />
    </div>
  );
}

function FlexChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const alignSelfOptions = ALIGN_SELF_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignSelfOptions.${option.key}`),
  }));

  return (
    <div className="space-y-2">
      <SubsectionLabel>{t("editPanel.layoutContext.child")}</SubsectionLabel>
      <PropInput
        label={t("editPanel.labels.flexGrow")}
        value={styles.flexGrow || ""}
        onChange={(v) => onStyleChange("flexGrow", v)}
        placeholder="0"
      />
      <PropInput
        label={t("editPanel.labels.flexShrink")}
        value={styles.flexShrink || ""}
        onChange={(v) => onStyleChange("flexShrink", v)}
        placeholder="1"
      />
      <PropInput
        label={t("editPanel.labels.flexBasis")}
        value={styles.flexBasis || ""}
        onChange={(v) => onStyleChange("flexBasis", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropInput
        label={t("editPanel.labels.order")}
        value={styles.order || ""}
        onChange={(v) => onStyleChange("order", v)}
        placeholder="0"
      />
      <PropSelect
        label={t("editPanel.labels.alignSelf")}
        value={optionValue(ALIGN_SELF_OPTIONS, styles.alignSelf, "auto")}
        onChange={(v) => onStyleChange("alignSelf", v)}
        options={alignSelfOptions}
      />
    </div>
  );
}

function GridChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const alignSelfOptions = ALIGN_SELF_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignSelfOptions.${option.key}`),
  }));

  return (
    <div className="space-y-2">
      <SubsectionLabel>
        {t("editPanel.layoutContext.gridChild")}
      </SubsectionLabel>
      <PropInput
        label={t("editPanel.labels.gridColumn")}
        value={styles.gridColumn || ""}
        onChange={(v) => onStyleChange("gridColumn", v)}
        placeholder="auto"
      />
      <PropInput
        label={t("editPanel.labels.gridRow")}
        value={styles.gridRow || ""}
        onChange={(v) => onStyleChange("gridRow", v)}
        placeholder="auto"
      />
      <PropSelect
        label={t("editPanel.labels.alignSelf")}
        value={optionValue(ALIGN_SELF_OPTIONS, styles.alignSelf, "auto")}
        onChange={(v) => onStyleChange("alignSelf", v)}
        options={alignSelfOptions}
      />
    </div>
  );
}

export function LayoutContextProperties({
  element,
  onStyleChange,
  onStylesChange,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const flexChild = isParentFlex(element);
  const gridChild = isParentGrid(element);
  const availableSizing = availableSizingForElement(element);
  const isContainer = isContainerElement(element);
  const aspectLock = useAspectRatioLock(element);

  const childControls = (
    <>
      {flexChild ? (
        <div className="border-t border-border/70 pt-2">
          <FlexChildControls element={element} onStyleChange={onStyleChange} />
        </div>
      ) : null}
      {gridChild ? (
        <div className="border-t border-border/70 pt-2">
          <GridChildControls element={element} onStyleChange={onStyleChange} />
        </div>
      ) : null}
    </>
  );

  // Leaf elements (text, img, svg, etc.) never get auto layout — show the plain
  // design W/H sizing block instead.
  if (!isContainer) {
    const widthSizing = inferElementSizing(element, "horizontal");
    const heightSizing = inferElementSizing(element, "vertical");
    // The aspect lock only makes sense between two fixed numeric dimensions —
    // hug/fill don't have an independent px value to scale. Match Figma: the
    // toggle is disabled (not hidden) otherwise, so its state/affordance stays
    // visible but inert.
    const canLockAspect = widthSizing === "fixed" && heightSizing === "fixed";
    const resolvedWidth = cssElementSize(element, "horizontal");
    const resolvedHeight = cssElementSize(element, "vertical");

    const toggleAspectLock = () => {
      if (!canLockAspect) return;
      aspectLock.setLocked(
        !aspectLock.locked,
        resolvedHeight > 0 ? resolvedWidth / resolvedHeight : undefined,
      );
    };

    // Shared W/H commit path: when locked, derive the other axis from the
    // captured ratio and commit both in one patch/history step; otherwise
    // fall back to the existing single-property write. `meta` is the
    // ScrubInput gesture-coalescing metadata forwarded from SizingField's
    // onSizeChange (see AutoLayoutMatrix.tsx) — threading it through here,
    // exactly like the X/Y ScrubStyleInput fields already do, is what lets a
    // W/H drag-scrub coalesce into one undo step instead of one per tick.
    // When locked, the same single `meta` describes the *one* combined
    // gesture driving both axes, so it's forwarded unchanged to whichever
    // commit call carries the patch (StylesChangeHandler/StyleChangeHandler
    // both accept an optional meta already).
    const commitWidth = (px: number, meta?: ScrubInputChangeMeta) => {
      if (aspectLock.locked && canLockAspect && aspectLock.ratio) {
        const nextHeight = deriveLockedAspectSize(
          "width",
          px,
          aspectLock.ratio,
        );
        const patch = { width: `${px}px`, height: `${nextHeight}px` };
        if (onStylesChange) onStylesChange(patch, meta);
        else {
          onStyleChange("width", patch.width, meta);
          onStyleChange("height", patch.height, meta);
        }
        return;
      }
      onStyleChange("width", `${px}px`, meta);
    };
    const commitHeight = (px: number, meta?: ScrubInputChangeMeta) => {
      if (aspectLock.locked && canLockAspect && aspectLock.ratio) {
        const nextWidth = deriveLockedAspectSize(
          "height",
          px,
          aspectLock.ratio,
        );
        const patch = { width: `${nextWidth}px`, height: `${px}px` };
        if (onStylesChange) onStylesChange(patch, meta);
        else {
          onStyleChange("width", patch.width, meta);
          onStyleChange("height", patch.height, meta);
        }
        return;
      }
      onStyleChange("height", `${px}px`, meta);
    };

    return (
      <PanelSection title={t("editPanel.sections.layout")}>
        {/* design-editor single-row-per-axis: [W | value | Fixed/Hug/Fill ▾]
            with the full sizing menu (modes + min/max + variable) per axis,
            plus a chain-link aspect-ratio lock at the FAR RIGHT of the row
            (Figma parity — the constrain-proportions link sits after both W
            and H, not between them). */}
        <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-1.5">
          <div className="group/field relative min-w-0">
            <SizingField
              axis="W"
              sizingAxis="horizontal"
              value={widthSizing}
              resolvedSize={resolvedWidth}
              mixed={isMixedValue(element.computedStyles.width)}
              minMax={readElementMinMax(element, "horizontal")}
              options={availableSizing.horizontal ?? ["fixed"]}
              disabled={false}
              onChange={(mode) =>
                commitElementSizing(
                  element,
                  "horizontal",
                  mode,
                  onStyleChange,
                  onStylesChange,
                )
              }
              onSizeChange={commitWidth}
              onMinMaxChange={(axis, kind, val, meta) =>
                commitElementMinMax(axis, kind, val, onStyleChange, meta)
              }
            />
            <FieldTrailer
              element={element}
              overrideProperty="width"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
            />
          </div>
          <div className="group/field relative min-w-0">
            <SizingField
              axis="H"
              sizingAxis="vertical"
              value={heightSizing}
              resolvedSize={resolvedHeight}
              mixed={isMixedValue(element.computedStyles.height)}
              minMax={readElementMinMax(element, "vertical")}
              options={availableSizing.vertical ?? ["fixed"]}
              disabled={false}
              onChange={(mode) =>
                commitElementSizing(
                  element,
                  "vertical",
                  mode,
                  onStyleChange,
                  onStylesChange,
                )
              }
              onSizeChange={commitHeight}
              onMinMaxChange={(axis, kind, val, meta) =>
                commitElementMinMax(axis, kind, val, onStyleChange, meta)
              }
            />
            <FieldTrailer
              element={element}
              overrideProperty="height"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  aspectLock.locked
                    ? t("editPanel.labels.unlockAspectRatio")
                    : t("editPanel.labels.lockAspectRatio")
                }
                aria-pressed={aspectLock.locked}
                disabled={!canLockAspect}
                onClick={toggleAspectLock}
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground transition-colors",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  aspectLock.locked &&
                    "text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
                  !canLockAspect && "pointer-events-none opacity-40",
                )}
              >
                {aspectLock.locked ? (
                  <IconLink className="size-3.5" />
                ) : (
                  <IconLinkOff className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {aspectLock.locked
                ? t("editPanel.labels.unlockAspectRatio")
                : t("editPanel.labels.lockAspectRatio")}
            </TooltipContent>
          </Tooltip>
        </div>
        {childControls}
      </PanelSection>
    );
  }

  // Any container element ALREADY has a layout in code — normal flow (block) by
  // default, or flex when it uses flexbox. the design editor never makes you "add" auto
  // layout for a frame, so we always render the full layout controls and let
  // the Flow control reflect/switch the element's current `display`. Choosing a
  // horizontal/vertical/wrap/grid flow applies `display:flex`; choosing the
  // normal-flow option resets to `display:block`.
  return (
    <PanelSection title={t("editPanel.sections.autoLayout")}>
      {/* Selection-stable key so per-selection UI state (paddingLinked, which
          must not silently flip while the user is mid-scrub — see the
          FlexContainerControls comment) resets on selection change instead of
          leaking to the next element — same pattern as CornerRadiusControl /
          ExportSettingsPanel. Deliberately `elementStableKey`, NOT
          `elementIdentityKey`: the latter folds in the rounded bounding rect,
          which changes on every resize. Resizing a frame on canvas is a very
          common action while its Auto layout section is open, and remounting
          on every such tick would silently reset paddingLinked back to
          allPaddingEqual mid-session — the exact class of bug the comment
          below (STEVE TEST BATCH 4 #4) already fixed for the *value*-driven
          case, reintroduced here via the *key*. */}
      <FlexContainerControls
        key={elementStableKey(element)}
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
      />
      {childControls}
    </PanelSection>
  );
}

/**
 * design layout-guide section. Shown for frame/container
 * elements. Renders an overlay column/row guide by applying a non-destructive
 * `backgroundImage` repeating gradient layer tagged so it can be toggled off
 * without disturbing real fills.
 */
const LAYOUT_GUIDE_MARKER = "/* an-layout-guide */";

function hasLayoutGuide(styles: Record<string, string>): boolean {
  return Boolean(styles.backgroundImage?.includes(LAYOUT_GUIDE_MARKER));
}

export function LayoutGuideProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
}) {
  const styles = element.computedStyles;
  const active = hasLayoutGuide(styles);

  const addGuide = () => {
    // 12-column overlay guide — the design editor's default columns layout grid.
    // The LAYOUT_GUIDE_MARKER comment is embedded so hasLayoutGuide and removeGuide
    // can detect/remove it without touching unrelated repeating-linear-gradient fills.
    const guide = `repeating-linear-gradient(to right, color-mix(in srgb, var(--design-editor-accent-color) 22%, transparent) 0 1px, transparent 1px calc(100% / 12)) ${LAYOUT_GUIDE_MARKER}`;
    const existing = compactCssValue(styles.backgroundImage, "");
    onStyleChange(
      "backgroundImage",
      existing ? `${guide}, ${existing}` : guide,
    );
  };

  const removeGuide = () => {
    const layers = splitCssLayers(styles.backgroundImage || "").filter(
      (layer) => !layer.includes(LAYOUT_GUIDE_MARKER),
    );
    onStyleChange(
      "backgroundImage",
      layers.length ? joinCssLayers(layers) : "none",
    );
  };

  return (
    <PanelSection
      title={"Layout guide" /* i18n-ignore design inspector label */}
      defaultCollapsed
      actions={
        <SectionIconButton
          label={
            active
              ? "Remove layout guide" /* i18n-ignore design inspector action */
              : "Add layout guide" /* i18n-ignore design inspector action */
          }
          onClick={active ? removeGuide : addGuide}
        >
          {active ? (
            <IconMinus className="size-3.5" />
          ) : (
            <IconPlus className="size-3.5" />
          )}
        </SectionIconButton>
      }
    >
      {active ? (
        <div className="flex items-center gap-2 rounded-md bg-[var(--design-editor-control-bg)] px-2 py-1.5 !text-[11px] text-muted-foreground">
          <IconLayoutGrid className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {"Columns" /* i18n-ignore design inspector label */}
          </span>
          <span className="shrink-0 tabular-nums">12</span>
        </div>
      ) : (
        <p className="!text-[11px] text-muted-foreground">
          {"No layout guides" /* i18n-ignore design inspector empty state */}
        </p>
      )}
    </PanelSection>
  );
}
