import { useT } from "@agent-native/core/client/i18n";
import {
  IconLayoutGrid,
  IconLink,
  IconLinkOff,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  AutoLayoutMatrix,
  MarginProperties,
  SizingField,
  type AutoLayoutFlow,
  type AutoLayoutGridTrackSizing,
  type AutoLayoutGridValue,
  type AutoLayoutMargin,
  type AutoLayoutMarginTextValues,
  type AutoLayoutMatrixLabels,
  type AutoLayoutMatrixValue,
  type AutoLayoutSidesMixed,
  type ScrubInputChangeMeta,
} from "../inspector";
import { IconLayoutSettings } from "../inspector/design-icons";
import type { ElementInfo } from "../types";
import {
  autoLayoutAlignmentFromStyles,
  availableSizingForElement,
  commitFixedElementSizes,
  commitElementMinMax,
  commitElementSizing,
  horizontalToJustify,
  inferElementSizing,
  measuredElementSize,
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
import { FieldTrailer } from "./field-primitives";
import { joinCssLayers, splitCssLayers } from "./fill-gradient-helpers";
import { SectionIconButton } from "./inspector-controls";
import {
  INSPECTOR_GRID_ACTION_GUTTER_SPAN,
  INSPECTOR_GRID_ACTION_PAIR_SPAN,
  INSPECTOR_GRID_ACTION_SPAN,
  InspectorGrid,
  InspectorGridCell,
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
  ApplyLayoutFlowHandler,
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
  // True when the element is already a grid (see elementIsGrid). Nothing
  // about `currentStyles` is trustworthy to write back in that case: the
  // caller merges computed styles under inline ones, so an unauthored (or
  // stylesheet/class-authored) template reads as its computed, browser-
  // resolved px list, and a multi-selection's differing values read as the
  // MIXED_VALUE sentinel — either would serialize a fabricated or literally
  // invalid value into an inline style. Re-committing Grid on an existing
  // grid is therefore a pure no-op (see the `isExistingGrid` branch below);
  // only a genuine conversion needs the full defaults.
  isExistingGrid = false,
): Record<string, string> {
  if (flow === "normal") return { display: "block" };
  if (flow === "vertical") {
    return { display: "flex", flexDirection: "column", flexWrap: "nowrap" };
  }
  if (flow === "grid") {
    // isExistingGrid (see above) is already true for an inline-grid
    // element — the call site's isGrid check treats display:inline-grid as
    // "already a grid" — so this branch is only ever reached converting a
    // non-grid element, where display is always "grid" (never inline-grid).
    if (isExistingGrid) return {};
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
      gridAutoFlow: "row",
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

/**
 * Template properties to write for a grid change. An axis the user did not
 * touch is left out: a stylesheet rule has no inline template to read back,
 * so rewriting it would replace hug/fixed/custom tracks with the fill default.
 */
export function gridTemplatePatchForChange(
  previous: AutoLayoutGridValue | undefined,
  next: AutoLayoutGridValue,
): Partial<Record<"gridTemplateColumns" | "gridTemplateRows", string>> {
  const patch: Partial<
    Record<"gridTemplateColumns" | "gridTemplateRows", string>
  > = {};
  const changed = (axis: "column" | "row") =>
    !previous ||
    previous[axis === "column" ? "columns" : "rows"] !==
      next[axis === "column" ? "columns" : "rows"] ||
    previous[`${axis}Sizing`] !== next[`${axis}Sizing`] ||
    previous[`${axis}Size`] !== next[`${axis}Size`];
  // A *mixed* axis (differing templates across a multi-selection — see
  // gridAxisValue's `mixed`) is refused unconditionally, even with an
  // explicit sizing pick: the track count is unknowable per element, so any
  // write would fabricate one repeat(N, …) template over every selected
  // element regardless of what each already has.
  //
  // A "custom" axis staying "custom" — whether unknown (stylesheet/class
  // authored, no inline template to read) or a KNOWN non-uniform inline
  // template ("96px 1fr minmax(0, 200px)") — has no formula to regenerate a
  // new track count from: gridTemplateForTracks falls back to a fabricated
  // repeat(N, minmax(0, 1fr)) default, discarding whatever tracks are
  // really authored. Refuse a bare count edit on it. Picking a sizing
  // (fill/hug/fixed) is explicit user intent and writes as usual.
  const skipAxis = (axis: "column" | "row") => {
    if (previous?.[axis === "column" ? "columnsMixed" : "rowsMixed"]) {
      return true;
    }
    const countKey = axis === "column" ? "columns" : "rows";
    return (
      previous?.[`${axis}Sizing`] === "custom" &&
      next[`${axis}Sizing`] === "custom" &&
      previous?.[countKey] !== next[countKey]
    );
  };
  if (changed("column") && !skipAxis("column")) {
    patch.gridTemplateColumns = gridTemplateForTracks(
      next.columns,
      next.columnSizing,
      next.columnSize,
      next.columnSizing === "custom" && previous?.columns === next.columns
        ? next.columnTemplate
        : undefined,
    );
  }
  if (changed("row") && !skipAxis("row")) {
    patch.gridTemplateRows = gridTemplateForTracks(
      next.rows,
      next.rowSizing,
      next.rowSize,
      next.rowSizing === "custom" && previous?.rows === next.rows
        ? next.rowTemplate
        : undefined,
    );
  }
  return patch;
}

// The bridge sets `isGridContainer` off the element's own computed display,
// which stays trustworthy even where `computedStyles.display` itself is
// absent or the MIXED_VALUE sentinel (a multi-selection where display
// differs per element) — so it's checked first, ahead of the string.
function elementIsGrid(element: ElementInfo): boolean {
  const display = (element.computedStyles.display || "").toLowerCase();
  return (
    element.isGridContainer === true ||
    display === "grid" ||
    display === "inline-grid"
  );
}

// A computed grid template is the browser's resolved px list ("50px 50px"),
// so it can only say how many tracks exist, never how they were sized.
// Treating it as authored turned fill/hug tracks into fixed px the moment a
// matrix or sizing change committed against a stale inline snapshot. When
// nothing is inline but the element already renders as a grid, tracks are
// authored somewhere this inspector cannot read (a stylesheet rule, a
// class) — only the computed track COUNT is browser-resolved fact, so the
// sizing is reported "custom" + `unknown` rather than guessed as "fill".
function gridAxisValue(
  element: ElementInfo,
  property: "gridTemplateColumns" | "gridTemplateRows",
): ReturnType<typeof parseGridTemplate> & {
  template: string;
  unknown?: boolean;
  mixed?: boolean;
} {
  const authored = element.inlineStyles?.[property] || "";
  const computed = element.computedStyles[property] || "";
  // mixedElementFromSelection puts the MIXED_VALUE sentinel ("Mixed") in
  // inlineStyles when a multi-selection's AUTHORED templates differ.
  // Parsing that string as a template would fabricate a bogus single-track
  // custom grid, so it's reported unknown+mixed instead — the count is
  // unknowable per element too, so it falls back to 1 unless the computed
  // template alone (not itself mixed) still gives a real count.
  if (isMixedValue(authored)) {
    const count =
      !isMixedValue(computed) && computed
        ? parseGridTemplate(computed).count
        : 1;
    return {
      count,
      sizing: "custom",
      template: "",
      unknown: true,
      mixed: true,
    };
  }
  // A shared, non-Mixed inline template is trusted first — even across a
  // multi-selection whose COMPUTED templates differ (the same authored
  // "repeat(2, minmax(0, 1fr))" resolves to a different px list at a
  // different width). That per-element resolved difference doesn't make the
  // AUTHORED template mixed, so computed is only consulted once there is no
  // inline template to trust.
  if (authored) return { ...parseGridTemplate(authored), template: authored };
  if (isMixedValue(computed)) {
    return {
      count: 1,
      sizing: "custom",
      template: "",
      unknown: true,
      mixed: true,
    };
  }
  const count = computed ? parseGridTemplate(computed).count : 1;
  if (elementIsGrid(element)) {
    return { count, sizing: "custom", template: "", unknown: true };
  }
  // Not yet a grid — nothing authored exists to preserve, and "fill" is the
  // same default autoLayoutStylesForFlow writes for a brand-new grid.
  return { count, sizing: "fill", template: "" };
}

export function gridValueForElement(element: ElementInfo): AutoLayoutGridValue {
  const columns = gridAxisValue(element, "gridTemplateColumns");
  const rows = gridAxisValue(element, "gridTemplateRows");
  return {
    columns: columns.count,
    rows: rows.count,
    columnSizing: columns.sizing,
    rowSizing: rows.sizing,
    columnSize: columns.fixedSize,
    rowSize: rows.fixedSize,
    columnSizingUnknown: columns.unknown,
    rowSizingUnknown: rows.unknown,
    columnTemplate: columns.template,
    rowTemplate: rows.template,
    columnGap: parseNumericValue(element.computedStyles.columnGap || "0"),
    rowGap: parseNumericValue(element.computedStyles.rowGap || "0"),
    columnsMixed: columns.mixed,
    rowsMixed: rows.mixed,
    columnGapMixed: isMixedValue(element.computedStyles.columnGap),
    rowGapMixed: isMixedValue(element.computedStyles.rowGap),
  };
}

function marginValuesForStyles(
  styles: Record<string, string>,
  inlineStyles?: Record<string, string>,
) {
  const marginValue = (property: string) => {
    const authored = inlineStyles?.[property];
    return (
      (isMixedValue(authored) || authored?.trim().toLowerCase() === "auto"
        ? authored
        : styles[property]) || "0"
    );
  };
  const raw = {
    top: marginValue("marginTop"),
    right: marginValue("marginRight"),
    bottom: marginValue("marginBottom"),
    left: marginValue("marginLeft"),
  };
  const value: AutoLayoutMargin = {
    top: parseNumericValue(raw.top),
    right: parseNumericValue(raw.right),
    bottom: parseNumericValue(raw.bottom),
    left: parseNumericValue(raw.left),
  };
  const mixed: AutoLayoutSidesMixed = {
    top: isMixedValue(raw.top),
    right: isMixedValue(raw.right),
    bottom: isMixedValue(raw.bottom),
    left: isMixedValue(raw.left),
  };
  const textValues: AutoLayoutMarginTextValues = {
    top: !mixed.top && raw.top.trim() === "auto" ? "auto" : undefined,
    right: !mixed.right && raw.right.trim() === "auto" ? "auto" : undefined,
    bottom: !mixed.bottom && raw.bottom.trim() === "auto" ? "auto" : undefined,
    left: !mixed.left && raw.left.trim() === "auto" ? "auto" : undefined,
  };
  return { value, mixed, textValues };
}

function marginStylesForSides(
  margin: AutoLayoutMargin,
  sides: Array<keyof AutoLayoutMargin>,
): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const side of sides) {
    const property = `margin${side[0].toUpperCase()}${side.slice(1)}`;
    styles[property] = `${margin[side]}px`;
  }
  return styles;
}

function marginInspectorLabels(
  t: ReturnType<typeof useT>,
): Partial<AutoLayoutMatrixLabels> {
  return {
    margin: t("editPanel.labels.margin"),
    linkMargin: t("editPanel.labels.linkMarginSides"),
    unlinkMargin: t("editPanel.labels.unlinkMarginSides"),
    marginTop: t("editPanel.labels.marginTop"),
    marginRight: t("editPanel.labels.marginRight"),
    marginBottom: t("editPanel.labels.marginBottom"),
    marginLeft: t("editPanel.labels.marginLeft"),
  };
}

/**
 * Style patch for a Grid-control change: template writes plus gap, with
 * `gridAutoFlow: "row"` included only when converting a non-grid element
 * into a grid for the first time. An element that is already a grid may
 * have an authored gridAutoFlow (e.g. "dense") that a track/gap edit must
 * not clobber.
 */
export function gridChangePatch(
  element: ElementInfo,
  previous: AutoLayoutGridValue | undefined,
  next: AutoLayoutGridValue,
): Record<string, string> {
  const isGrid = elementIsGrid(element);
  return {
    ...(isGrid ? {} : { display: "grid" }),
    ...gridTemplatePatchForChange(previous, next),
    ...(isGrid ? {} : { gridAutoFlow: "row" }),
    columnGap: `${next.columnGap}px`,
    rowGap: `${next.rowGap}px`,
  };
}

/** Flex container properties */
function FlexContainerControls({
  element,
  onStyleChange,
  onStylesChange,
  onDisableAutoLayout,
  onApplyLayoutFlow,
  showSizingControls,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onDisableAutoLayout?: (nodeId: string) => void;
  onApplyLayoutFlow?: ApplyLayoutFlowHandler;
  showSizingControls: boolean;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const marginLabels = marginInspectorLabels(t);
  const marginProperties = marginValuesForStyles(styles, element.inlineStyles);
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
  // Grid-track and gap mixedness are tracked per-axis on
  // gridValueForElement's own columnsMixed/rowsMixed/*GapMixed — they must
  // not also gate the FLOW bucket itself. Two multi-selected grids with the
  // SAME authored template at different widths resolve to different
  // computed px lists (sameOrMixed collapses that to the MIXED_VALUE
  // sentinel), which is not a flow mismatch, so gridTemplateColumns/Rows are
  // never compared here.
  //
  // `isGrid` above already trusts the selection's aggregated
  // isGridContainer (mixedElementFromSelection: true only when EVERY
  // selected element is a grid container) over the raw `display` string.
  // Once isGrid says every element is a grid, flow IS "grid" — full stop.
  // An unrelated property that happens to differ per element (a leftover
  // inline flexDirection/flexWrap from before conversion, or `display`
  // itself reading Mixed for a reason that has nothing to do with layout)
  // must not fall through to a "mixed" flow bucket once grid-ness is
  // already settled; only consult those when isGrid could NOT resolve it.
  const flowMixed =
    !isGrid &&
    [styles.display, styles.flexDirection, styles.flexWrap].some(isMixedValue);
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
    margin: marginProperties.value,
    marginMixed: marginProperties.mixed,
    marginTextValues: marginProperties.textValues,
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
      horizontal: measuredElementSize(element, "horizontal"),
      vertical: measuredElementSize(element, "vertical"),
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
        labels={marginLabels}
        onFlowChange={(flow) => {
          const nodeId = element.sourceId ?? element.pendingNodeId;
          // A raw display:block leaves the children in flow, so they re-stack
          // and stop being draggable. The command measures and pins them.
          if (flow === "normal" && onDisableAutoLayout && nodeId) {
            onDisableAutoLayout(nodeId);
            return;
          }
          // Re-selecting Grid on an element that's already a grid is a
          // no-op at the style level (autoLayoutStylesForFlow returns {}
          // for isExistingGrid — see its comment), but an EMPTY patch is
          // not itself a safe no-op to hand to a command: apply-layout-flow
          // forwards it to applyVisualEdit, and the code-layer patcher
          // treats an empty style declaration as unresolvable
          // ("needsAgent"), surfacing an error toast for what should be a
          // silent click. Stop before invoking any command at all.
          if (flow === "grid" && isGrid) return;
          const patch = autoLayoutStylesForFlow(
            flow,
            { ...styles, ...element.inlineStyles },
            isGrid,
          );
          // Children drawn on canvas are absolutely positioned, so the
          // container styles alone would render no layout at all — only a
          // selection this editor cannot rewrite falls through to them.
          if (
            onApplyLayoutFlow &&
            onApplyLayoutFlow(nodeId ?? null, patch) !== "unsupported"
          ) {
            return;
          }
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
          const patch = gridChangePatch(
            element,
            autoLayoutValue.grid,
            nextGrid,
          );
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
        onMarginChange={(nextMargin, meta, changedSides) => {
          const patch = marginStylesForSides(nextMargin, changedSides);
          const changeMeta =
            meta &&
            (meta.relativeDelta !== undefined || meta.relativeExpression)
              ? { ...meta, relativeDeltaProperties: Object.keys(patch) }
              : meta;
          if (onStylesChange) {
            onStylesChange(patch, changeMeta);
            return;
          }
          Object.entries(patch).forEach(([property, value]) =>
            onStyleChange(property, value, changeMeta),
          );
        }}
        onClipContentChange={(clipContent) =>
          onStyleChange("overflow", clipContent ? "hidden" : "visible")
        }
        // Only containers own clipping: a drawn frame, or the screen's own
        // document. Do not widen this to `isContainerElement`: board-drawn
        // primitives reach this panel with no `primitiveKind`, so every drawn
        // rectangle reads as a plain container `div` and gets the control back.
        clipContentSupported={
          element.primitiveKind === "frame" ||
          element.tagName?.toLowerCase() === "body"
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
        showSizingControls={showSizingControls}
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
          commitFixedElementSizes(
            element,
            { [axis]: px },
            onStyleChange,
            onStylesChange,
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
    <div className="design-sidebar-property-group">
      <SubsectionLabel>{t("editPanel.layoutContext.child")}</SubsectionLabel>
      <div className="flex flex-col gap-2">
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
    <div className="design-sidebar-property-group">
      <SubsectionLabel>
        {t("editPanel.layoutContext.gridChild")}
      </SubsectionLabel>
      <div className="flex flex-col gap-2">
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
    </div>
  );
}

function LayoutAdvancedPopover({
  element,
  onStyleChange,
  flexChild,
  gridChild,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  flexChild: boolean;
  gridChild: boolean;
}) {
  const t = useT();
  const label = t(
    flexChild
      ? "editPanel.layoutContext.flexChild"
      : "editPanel.layoutContext.gridChild",
  );

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={label}
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
            >
              <IconLayoutSettings className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        data-design-chrome-region="right-panel"
        className="w-72 space-y-3 p-3 !text-[11px]"
      >
        {flexChild ? (
          <FlexChildControls element={element} onStyleChange={onStyleChange} />
        ) : null}
        {gridChild ? (
          <GridChildControls element={element} onStyleChange={onStyleChange} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function LayoutContextProperties({
  element,
  onStyleChange,
  onStylesChange,
  onDisableAutoLayout,
  onApplyLayoutFlow,
  showContainerSizing = true,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onDisableAutoLayout?: (nodeId: string) => void;
  onApplyLayoutFlow?: ApplyLayoutFlowHandler;
  showContainerSizing?: boolean;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const flexChild = isParentFlex(element);
  const gridChild = isParentGrid(element);
  const availableSizing = availableSizingForElement(element);
  const isContainer = isContainerElement(element);
  const aspectLock = useAspectRatioLock(element);
  const marginLabels = marginInspectorLabels(t);
  const marginProperties = marginValuesForStyles(
    element.computedStyles,
    element.inlineStyles,
  );

  const childActions =
    flexChild || gridChild ? (
      <LayoutAdvancedPopover
        element={element}
        onStyleChange={onStyleChange}
        flexChild={flexChild}
        gridChild={gridChild}
      />
    ) : undefined;

  // Leaf elements (text, img, svg, etc.) never get auto layout — show the plain
  // design W/H sizing block instead.
  if (!isContainer) {
    const widthSizing = inferElementSizing(element, "horizontal");
    const heightSizing = inferElementSizing(element, "vertical");
    // The aspect lock only makes sense between two fixed numeric dimensions —
    // hug/fill don't have an independent px value to scale. Match Figma: the
    // toggle is disabled (not hidden) otherwise, so its state/affordance stays
    // visible but inert.
    const resolvedWidth = measuredElementSize(element, "horizontal");
    const resolvedHeight = measuredElementSize(element, "vertical");
    const canLockAspect =
      widthSizing === "fixed" &&
      heightSizing === "fixed" &&
      resolvedWidth != null &&
      resolvedHeight != null;

    const toggleAspectLock = () => {
      if (!canLockAspect) return;
      aspectLock.setLocked(
        !aspectLock.locked,
        resolvedWidth != null && resolvedHeight != null && resolvedHeight > 0
          ? resolvedWidth / resolvedHeight
          : undefined,
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
        commitFixedElementSizes(
          element,
          { horizontal: px, vertical: nextHeight },
          onStyleChange,
          onStylesChange,
          meta,
        );
        return;
      }
      commitFixedElementSizes(
        element,
        { horizontal: px },
        onStyleChange,
        onStylesChange,
        meta,
      );
    };
    const commitHeight = (px: number, meta?: ScrubInputChangeMeta) => {
      if (aspectLock.locked && canLockAspect && aspectLock.ratio) {
        const nextWidth = deriveLockedAspectSize(
          "height",
          px,
          aspectLock.ratio,
        );
        commitFixedElementSizes(
          element,
          { horizontal: nextWidth, vertical: px },
          onStyleChange,
          onStylesChange,
          meta,
        );
        return;
      }
      commitFixedElementSizes(
        element,
        { vertical: px },
        onStyleChange,
        onStylesChange,
        meta,
      );
    };

    return (
      <PanelSection
        title={t("editPanel.sections.layout")}
        actions={childActions}
      >
        {/* design-editor single-row-per-axis: [W | value | Fixed/Hug/Fill ▾]
            with the full sizing menu (modes + min/max + variable) per axis,
            plus a chain-link aspect-ratio lock at the FAR RIGHT of the row
            (Figma parity — the constrain-proportions link sits after both W
            and H, not between them). */}
        <InspectorGrid className="items-start" layout="action-pair">
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
            className="group/field relative"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex h-4 items-center justify-between gap-1">
                <SubsectionLabel>{t("editPanel.labels.width")}</SubsectionLabel>
                <FieldTrailer
                  element={element}
                  overrideProperty="width"
                  motionKeyframeContext={motionKeyframeContext}
                  breakpointOverrideContext={breakpointOverrideContext}
                />
              </div>
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
            </div>
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
            className="group/field relative"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex h-4 items-center justify-between gap-1">
                <SubsectionLabel>
                  {t("editPanel.labels.height")}
                </SubsectionLabel>
                <FieldTrailer
                  element={element}
                  overrideProperty="height"
                  motionKeyframeContext={motionKeyframeContext}
                  breakpointOverrideContext={breakpointOverrideContext}
                />
              </div>
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
            </div>
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_SPAN}
            className="flex items-center justify-center"
          >
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
                    "mt-5 flex size-6 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground transition-colors",
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
          </InspectorGridCell>
        </InspectorGrid>
        <MarginProperties
          key={elementStableKey(element)}
          value={marginProperties.value}
          mixed={marginProperties.mixed}
          textValues={marginProperties.textValues}
          labels={marginLabels}
          onChange={(margin, meta, changedSides) => {
            const patch = marginStylesForSides(margin, changedSides);
            const changeMeta =
              meta &&
              (meta.relativeDelta !== undefined || meta.relativeExpression)
                ? { ...meta, relativeDeltaProperties: Object.keys(patch) }
                : meta;
            if (onStylesChange) {
              onStylesChange(patch, changeMeta);
              return;
            }
            Object.entries(patch).forEach(([property, value]) =>
              onStyleChange(property, value, changeMeta),
            );
          }}
        />
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
    <PanelSection
      title={t("editPanel.sections.autoLayout")}
      actions={childActions}
    >
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
        onDisableAutoLayout={onDisableAutoLayout}
        onApplyLayoutFlow={onApplyLayoutFlow}
        showSizingControls={showContainerSizing}
      />
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
        <InspectorGrid layout="paint-row">
          <InspectorGridCell span={20}>
            <div className="flex h-6 items-center gap-2 rounded-md bg-[var(--design-editor-control-bg)] px-2 !text-[11px] text-muted-foreground">
              <IconLayoutGrid className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {"Columns" /* i18n-ignore design inspector label */}
              </span>
              <span className="shrink-0 tabular-nums">12</span>
            </div>
          </InspectorGridCell>
          <InspectorGridCell span={4} ariaHidden />
          <InspectorGridCell span={4} ariaHidden />
        </InspectorGrid>
      ) : null}
    </PanelSection>
  );
}
