import { useT } from "@agent-native/core/client";
import {
  IconLayoutGrid,
  IconLink,
  IconLinkOff,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

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
  elementHasLayoutChildren,
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
  elementIdentityKey,
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
  const isFlex = element.isFlexContainer || display.includes("flex");
  const displayMode: AutoLayoutMatrixValue["display"] = isFlex
    ? "flex"
    : "block";
  const hasLayoutChildren = elementHasLayoutChildren(element);
  const flexDirection: AutoLayoutMatrixValue["direction"] =
    styles.flexDirection?.includes("column") ? "vertical" : "horizontal";
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
  const handleDisplayChange = (nextDisplay: "flex" | "block") => {
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
    alignment: autoLayoutAlignmentFromStyles(styles, flexDirection),
    gap: parseNumericValue(styles.gap || "0"),
    padding,
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
    resolvedSize: {
      horizontal: cssElementSize(element, "horizontal"),
      vertical: cssElementSize(element, "vertical"),
    },
    mixedSize: {
      horizontal: isMixedValue(styles.width),
      vertical: isMixedValue(styles.height),
    },
    display: displayMode,
    spaceBetween: styles.justifyContent === "space-between",
  };

  return (
    <div className="space-y-2">
      <AutoLayoutMatrix
        value={autoLayoutValue}
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
        onAlignmentChange={(alignment) => {
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
          if (!linked) return;
          const avg = Math.round(
            (padding.top + padding.right + padding.bottom + padding.left) / 4,
          );
          onStyleChange("paddingTop", `${avg}px`);
          onStyleChange("paddingRight", `${avg}px`);
          onStyleChange("paddingBottom", `${avg}px`);
          onStyleChange("paddingLeft", `${avg}px`);
        }}
        onClipContentChange={(clipContent) =>
          onStyleChange("overflow", clipContent ? "hidden" : "visible")
        }
        onDistribute={(axis) => {
          if (axis === mainGapAxis) {
            onStyleChange("justifyContent", "space-between");
          } else if (autoLayoutValue.wrap === "wrap") {
            onStyleChange("alignContent", "space-between");
          }
        }}
        onGapModeChange={(gapMode, axis) => {
          if (axis !== mainGapAxis) return;
          ensureFlex();
          onStyleChange(
            "justifyContent",
            gapMode === "auto" ? "space-between" : "flex-start",
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
        showChildLayoutControls={hasLayoutChildren}
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
          ExportSettingsPanel. */}
      <FlexContainerControls
        key={elementIdentityKey(element)}
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
