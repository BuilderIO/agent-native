import { useT } from "@agent-native/core/client";
import {
  composeTransform3D,
  isTransform3DActive,
  parseTransform3DParts,
  type Transform3DParts,
} from "@shared/canvas-math";
import {
  IconAngle,
  IconAxisX,
  IconAxisY,
  IconFlipHorizontal,
  IconFlipVertical,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconPerspective,
  IconRotate3d,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  ConstraintsPreview,
  ConstraintsWidget,
  ScrubInput,
  type AlignmentMatrixValue,
  type ConstraintsValue,
  type ScrubInputChangeMeta,
} from "../inspector";
import type { ElementInfo } from "../types";
import {
  AppearanceScrubField,
  CornerRadiusControl,
} from "./appearance-properties";
import { FieldTrailer, ScrubStyleInput } from "./field-primitives";
import {
  InspectorIconButton,
  InspectorSegment,
  SectionIconToggle,
} from "./inspector-controls";
import { authoredStyleValue } from "./interaction-state-helpers";
import { PanelSection, SubsectionLabel } from "./panel-primitives";
import { roundToOneDecimal } from "./position-helpers";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
} from "./style-change-types";
import {
  mergeRotationValue,
  mergeTranslateFunction,
  parseRotationValue,
  parseScaleValue,
} from "./transform-helpers";

/** Position, size, and spacing properties */
export function PositionLayoutProperties({
  element,
  onStyleChange,
  onAlignSelection,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  /**
   * Moves the selection itself (Figma's real "Alignment" row semantics):
   * aligns to the combined selection bounding box for a 2+ multi-selection,
   * or to the parent for a single selected object. When provided, the
   * alignment row's six buttons call this instead of writing flex-alignment
   * properties on the selected element. See the `onAlignSelection` contract
   * note above `PositionLayoutProperties` usage in this file for the exact
   * edge semantics the caller (DesignEditor) must implement.
   */
  onAlignSelection?: (
    edge: "left" | "center-h" | "right" | "top" | "center-v" | "bottom",
  ) => void;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const constrainedPosition =
    styles.position === "absolute" || styles.position === "fixed";
  // NOTE: this row used to also write flex alignment (justifyContent/
  // alignItems) on the selected element when it was a flex container —
  // i.e. it aligned the element's own children. That duplicated exactly
  // what FlexContainerControls' AutoLayoutMatrix already offers via its
  // CompactAlignmentMatrix (onAlignmentChange, wired a few hundred lines
  // up in this file) and was never real Figma behavior: Figma's Alignment
  // row in the Position section always moves the selected object(s), not
  // their children. That fallback has been removed — flex child alignment
  // now lives exclusively in the auto-layout section's alignment matrix.
  const handlePositionAlignH = (value: AlignmentMatrixValue["horizontal"]) => {
    onAlignSelection?.(
      value === "left" ? "left" : value === "right" ? "right" : "center-h",
    );
  };
  const handlePositionAlignV = (value: AlignmentMatrixValue["vertical"]) => {
    onAlignSelection?.(
      value === "top" ? "top" : value === "bottom" ? "bottom" : "center-v",
    );
  };
  // Authored (not computed) offsets: when inlineStyles is present, "auto"/absent
  // is treated as truly unset instead of the computed px fallback, so a plain
  // top-left-anchored element reads as "left" rather than always "left-right".
  const authoredLeft = authoredStyleValue(element, "left");
  const authoredRight = authoredStyleValue(element, "right");
  const authoredTop = authoredStyleValue(element, "top");
  const authoredBottom = authoredStyleValue(element, "bottom");
  const authoredWidth = authoredStyleValue(element, "width");
  const authoredHeight = authoredStyleValue(element, "height");
  const authoredTransform = authoredStyleValue(element, "transform");
  const constraintsValue: ConstraintsValue = {
    horizontal:
      // Check scale before left+right: "scale" writes width:100% and clears
      // left/right to auto, but legacy data may have 0px values that are truthy.
      authoredWidth === "100%"
        ? "scale"
        : authoredLeft && authoredRight
          ? "left-right"
          : authoredRight
            ? "right"
            : authoredTransform?.includes("translateX(-50%)")
              ? "center"
              : "left",
    vertical:
      authoredHeight === "100%"
        ? "scale"
        : authoredTop && authoredBottom
          ? "top-bottom"
          : authoredBottom
            ? "bottom"
            : authoredTransform?.includes("translateY(-50%)")
              ? "center"
              : "top",
  };
  const [constraintsExpanded, setConstraintsExpanded] = useState(false);
  // 3D rotation/perspective progressive-disclosure expander — mirrors
  // CornerRadiusControl's showIndependentCorners pattern. Default-expanded
  // when the authored transform already has non-zero X/Y rotation or
  // perspective, so an element edited elsewhere (e.g. by the agent) doesn't
  // hide its active 3D state behind a collapsed control.
  const initialTransform3DParts = parseTransform3DParts(
    isMixedValue(authoredTransform) ? undefined : authoredTransform,
  );
  const [rotation3DExpanded, setRotation3DExpanded] = useState(
    () =>
      initialTransform3DParts !== null &&
      isTransform3DActive(initialTransform3DParts),
  );

  const handleConstraintsChange = useCallback(
    (value: ConstraintsValue) => {
      onStyleChange("position", "absolute");

      // Compute the desired translateX/Y for each axis independently, then
      // compose both into a single transform write so the two axes don't
      // overwrite each other when both change simultaneously.
      const txValue = value.horizontal === "center" ? "-50%" : null;
      const tyValue = value.vertical === "center" ? "-50%" : null;
      // Start from the current transform, apply X, then apply Y on top.
      const transformAfterX = mergeTranslateFunction(
        authoredTransform,
        "X",
        txValue,
      );
      const transformAfterXY = mergeTranslateFunction(
        transformAfterX,
        "Y",
        tyValue,
      );

      if (value.horizontal === "left") {
        onStyleChange(
          "left",
          authoredLeft || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "auto");
      } else if (value.horizontal === "right") {
        onStyleChange("right", "0px");
        onStyleChange("left", "auto");
      } else if (value.horizontal === "left-right") {
        onStyleChange(
          "left",
          authoredLeft || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "0px");
      } else if (value.horizontal === "center") {
        onStyleChange("left", "50%");
        onStyleChange("right", "auto");
      } else {
        // scale: use auto (not 0px) so the left && right truthiness check
        // in the reader does not misidentify this as "left-right".
        onStyleChange("left", "auto");
        onStyleChange("right", "auto");
        onStyleChange("width", "100%");
      }

      if (value.vertical === "top") {
        onStyleChange(
          "top",
          authoredTop || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "auto");
      } else if (value.vertical === "bottom") {
        onStyleChange("bottom", "0px");
        onStyleChange("top", "auto");
      } else if (value.vertical === "top-bottom") {
        onStyleChange(
          "top",
          authoredTop || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "0px");
      } else if (value.vertical === "center") {
        onStyleChange("top", "50%");
        onStyleChange("bottom", "auto");
      } else {
        // scale
        onStyleChange("top", "auto");
        onStyleChange("bottom", "auto");
        onStyleChange("height", "100%");
      }

      // Write the composed transform once, after both axes are resolved.
      onStyleChange("transform", transformAfterXY);
    },
    [
      element.boundingRect.x,
      element.boundingRect.y,
      onStyleChange,
      authoredLeft,
      authoredTop,
      authoredTransform,
    ],
  );

  return (
    <PanelSection
      title={t("editPanel.sections.positionLayout")}
      actions={
        <SectionIconToggle
          label={"Absolute position" /* i18n-ignore design inspector action */}
          active={constrainedPosition}
          onClick={() =>
            onStyleChange(
              "position",
              constrainedPosition ? "relative" : "absolute",
            )
          }
        >
          <IconLayoutDistributeHorizontal className="size-3.5" />
        </SectionIconToggle>
      }
    >
      <div className="space-y-1.5">
        <SubsectionLabel>
          {"Alignment" /* i18n-ignore design inspector label */}
        </SubsectionLabel>
        <div className="flex items-center gap-3">
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.textAligns.left")}
              shortcut="⌥A"
              onClick={() => handlePositionAlignH("left")}
            >
              <IconLayoutAlignLeft className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.textAligns.center")}
              shortcut="⌥H"
              onClick={() => handlePositionAlignH("center")}
            >
              <IconLayoutAlignCenter className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.textAligns.right")}
              shortcut="⌥D"
              onClick={() => handlePositionAlignH("right")}
            >
              <IconLayoutAlignRight className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.start")}
              shortcut="⌥W"
              onClick={() => handlePositionAlignV("top")}
            >
              <IconLayoutAlignTop className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.center")}
              shortcut="⌥V"
              onClick={() => handlePositionAlignV("middle")}
            >
              <IconLayoutAlignMiddle className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.end")}
              shortcut="⌥S"
              onClick={() => handlePositionAlignV("bottom")}
            >
              <IconLayoutAlignBottom className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
        </div>
      </div>

      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] gap-2">
          <div className="group/field relative min-w-0">
            <ScrubStyleInput
              label="X"
              ariaLabel="X-position"
              tooltipLabel="X-position"
              value={
                isMixedValue(authoredLeft) ? MIXED_VALUE : authoredLeft || ""
              }
              placeholder={element.boundingRect.x}
              inputClassName="h-6"
              onChange={(v, meta) => {
                // Typing X/Y on a static (non-positioned) element is a no-op on
                // canvas unless we first give it a position to offset from —
                // mirror handleConstraintsChange, which always sets
                // position:absolute (the convention canvas drag/resize and
                // primitive creation both use) before writing left/top.
                if (!constrainedPosition) onStyleChange("position", "absolute");
                onStyleChange("left", `${roundToOneDecimal(v)}px`, meta);
              }}
            />
            <FieldTrailer
              element={element}
              motionCssProperty="translate"
              overrideProperty="left"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
              hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
            />
          </div>
          <div className="group/field relative min-w-0">
            <ScrubStyleInput
              label="Y"
              ariaLabel="Y-position"
              tooltipLabel="Y-position"
              value={
                isMixedValue(authoredTop) ? MIXED_VALUE : authoredTop || ""
              }
              placeholder={element.boundingRect.y}
              inputClassName="h-6"
              onChange={(v, meta) => {
                if (!constrainedPosition) onStyleChange("position", "absolute");
                onStyleChange("top", `${roundToOneDecimal(v)}px`, meta);
              }}
            />
            <FieldTrailer
              element={element}
              motionCssProperty="translate"
              overrideProperty="top"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              className="absolute -top-3.5 right-0"
              hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  "Constraints" /* i18n-ignore design inspector action */
                }
                aria-pressed={constraintsExpanded}
                onClick={() => setConstraintsExpanded((expanded) => !expanded)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  constraintsExpanded
                    ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]"
                    : "text-muted-foreground",
                )}
              >
                <ConstraintsPreview value={constraintsValue} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {"Constraints" /* i18n-ignore design inspector tooltip */}
            </TooltipContent>
          </Tooltip>
        </div>
        {constraintsExpanded ? (
          <ConstraintsWidget
            value={constraintsValue}
            onChange={handleConstraintsChange}
            className="pt-1"
          />
        ) : null}
      </div>

      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.rotation")}</SubsectionLabel>
        <div className="group flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ScrubStyleInput
              label="Rotation"
              ariaLabel={t("editPanel.labels.rotation")}
              tooltipLabel={t("editPanel.labels.rotation")}
              hideIcon={false}
              icon={IconAngle}
              labelClassName="[&>span]:sr-only"
              // Detect the Mixed sentinel BEFORE parsing: parseRotationValue
              // would silently turn "Mixed" into 0 and render "0deg" instead
              // of the mixed state (mirrors the opacity field's guard).
              value={
                isMixedValue(styles.transform)
                  ? MIXED_VALUE
                  : `${parseRotationValue(styles.transform)}deg`
              }
              unit="deg"
              inputClassName="h-6"
              onChange={(v, meta) =>
                onStyleChange(
                  "transform",
                  // From a mixed selection the sentinel is not a transform —
                  // treat it as absent so the typed value applies cleanly to
                  // every selected object instead of producing
                  // "Mixed rotate(…)". This field always writes the Z
                  // rotation — back-compat: existing designs'
                  // `transform: rotate()` is the Z axis. When the 3D
                  // expander below is active (non-zero X/Y/perspective),
                  // mergeRotationValue's plain rotate() slot still round-
                  // trips correctly since composeTransform3D always emits a
                  // trailing rotateZ() once 3D is active, which
                  // ROTATE_FN_PATTERN also matches.
                  mergeRotationValue(
                    isMixedValue(styles.transform)
                      ? undefined
                      : styles.transform,
                    v,
                  ),
                  meta,
                )
              }
            />
          </div>
          <FieldTrailer
            element={element}
            motionCssProperty="rotate"
            overrideProperty="transform"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.labels.flipHorizontal")}
              onClick={() => {
                const [sx, sy] = parseScaleValue(styles.scale);
                onStyleChange("scale", `${sx === -1 ? 1 : -1} ${sy}`);
              }}
            >
              <IconFlipHorizontal className="size-4" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.labels.flipVertical")}
              onClick={() => {
                const [sx, sy] = parseScaleValue(styles.scale);
                onStyleChange("scale", `${sx} ${sy === -1 ? 1 : -1}`);
              }}
            >
              <IconFlipVertical className="size-4" />
            </InspectorIconButton>
          </InspectorSegment>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("editPanel.labels.rotation3d")}
                aria-pressed={rotation3DExpanded}
                onClick={() => setRotation3DExpanded((expanded) => !expanded)}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  rotation3DExpanded
                    ? "bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]"
                    : "text-muted-foreground",
                )}
              >
                <IconRotate3d className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editPanel.labels.rotation3d")}</TooltipContent>
          </Tooltip>
        </div>
        {rotation3DExpanded ? (
          <Rotation3DControls styles={styles} onStyleChange={onStyleChange} />
        ) : null}
      </div>
    </PanelSection>
  );
}

/**
 * Progressive-disclosure X/Y/Z rotation + perspective controls, revealed by
 * the 3D-rotation expander next to the plain (Z-axis) rotation field. See
 * `composeTransform3D`/`parseTransform3DParts` (shared/canvas-math.ts) for
 * the parse/compose contract this wraps.
 *
 * - Transform composition order: `perspective(Npx) rotateX(Xdeg)
 *   rotateY(Ydeg) rotateZ(Zdeg) <preserved translate/scale/etc>` — see the
 *   `composeTransform3D` doc comment for the full rationale (X→Y→Z is a
 *   common 3D-engine Euler convention; Figma hasn't published a composition
 *   order since 3D transforms are unshipped there as of this build).
 * - When X, Y, and Perspective are all zero/empty, the composed transform is
 *   the plain 2D `rotate(Zdeg)` form — zero output churn for existing
 *   designs that never touch this expander.
 * - `transform-style: preserve-3d` is intentionally NOT applied here:
 *   defaulting to flattened (no preserve-3d) matches the conservative,
 *   minimal-footprint choice for this first pass — see the build report for
 *   the preserve-3d-on-children tradeoff.
 */
function Rotation3DControls({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
}) {
  const t = useT();
  const transformMixed = isMixedValue(styles.transform);
  const parts = transformMixed ? null : parseTransform3DParts(styles.transform);
  // `parts === null` (and not mixed) means the authored transform is a
  // matrix()/matrix3d()/rotate3d() composite (or an unrecognized token) that
  // parseTransform3DParts can't safely invert into independent X/Y/Z/
  // perspective fields — show the fields disabled with a note instead of
  // guessing, matching how Mixed values disable commit rather than silently
  // defaulting to 0. See parseTransform3DParts's doc comment.
  const isCustomTransform = !transformMixed && parts === null;
  const disabled = transformMixed || isCustomTransform;
  const displayParts: Transform3DParts = parts ?? {
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    perspective: 0,
  };

  const commitPart = (
    patch: Partial<Transform3DParts>,
    meta?: ScrubInputChangeMeta,
  ) => {
    if (disabled) return;
    const nextParts: Transform3DParts = { ...displayParts, ...patch };
    onStyleChange(
      "transform",
      composeTransform3D(styles.transform, nextParts),
      meta,
    );
  };

  return (
    <div className="space-y-1.5 pt-1">
      {isCustomTransform ? (
        <p className="!text-[11px] text-muted-foreground">
          {t("editPanel.labels.customTransform")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        <AppearanceScrubField
          label={t("editPanel.labels.rotationX")}
          icon={IconAxisX}
          value={transformMixed ? 0 : displayParts.rotateX}
          onChange={(value, meta) => commitPart({ rotateX: value }, meta)}
          mixed={transformMixed}
          disabled={isCustomTransform}
          step={1}
          unit="deg"
          precision={1}
        />
        <AppearanceScrubField
          label={t("editPanel.labels.rotationY")}
          icon={IconAxisY}
          value={transformMixed ? 0 : displayParts.rotateY}
          onChange={(value, meta) => commitPart({ rotateY: value }, meta)}
          mixed={transformMixed}
          disabled={isCustomTransform}
          step={1}
          unit="deg"
          precision={1}
        />
        <ScrubInput
          label={t("editPanel.labels.perspective")}
          ariaLabel={t("editPanel.labels.perspective")}
          tooltipLabel={t("editPanel.labels.perspectiveHint")}
          icon={IconPerspective}
          value={transformMixed ? 0 : displayParts.perspective}
          onChange={(value, meta) =>
            commitPart({ perspective: Math.max(0, value) }, meta)
          }
          mixed={transformMixed}
          disabled={isCustomTransform}
          min={0}
          step={10}
          unit="px"
          precision={0}
          className="col-span-2 gap-0"
          labelClassName="h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] [&>span]:sr-only"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>
    </div>
  );
}
