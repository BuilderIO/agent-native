import { useT } from "@agent-native/core/client/i18n";
import {
  composeTransform3D,
  isTransform3DActive,
  parseTransform3DParts,
  quantizeToStep,
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

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
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
import { AppearanceScrubField } from "./appearance-properties";
import {
  commitStylePatch,
  FieldTrailer,
  ScrubStyleInput,
} from "./field-primitives";
import {
  InspectorIconButton,
  InspectorSegment,
  SectionIconToggle,
} from "./inspector-controls";
import { authoredStyleValue } from "./interaction-state-helpers";
import { useLiveDragPosition } from "./live-drag-position";
import {
  INSPECTOR_GRID_ACTION_GUTTER_SPAN,
  INSPECTOR_GRID_ACTION_PAIR_SPAN,
  INSPECTOR_GRID_ACTION_SPAN,
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  InspectorActionPairGrid,
  InspectorGrid,
  InspectorGridCell,
  PanelSection,
  SubsectionLabel,
} from "./panel-primitives";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";
import {
  mergeRotationValue,
  mergeTranslateFunction,
  parseRotationValue,
  parseScaleValue,
} from "./transform-helpers";

export function definiteAuthoredOffset(
  raw: string | undefined,
): string | undefined {
  if (!raw || raw === "auto" || isMixedValue(raw)) return undefined;
  return raw;
}

export function measuredPositionOffset(
  element: Pick<
    ElementInfo,
    | "boundingRect"
    | "parentBoundingRect"
    | "parentAutoLayout"
    | "positionReferenceRect"
    | "positionContainingBlockOrigin"
  >,
  axis: "x" | "y",
): number {
  const referenceBounds =
    element.positionReferenceRect ??
    element.parentBoundingRect ??
    element.parentAutoLayout?.boundingRect;
  const childOffset = element.boundingRect[axis];
  return referenceBounds ? childOffset - referenceBounds[axis] : childOffset;
}

function numericPositionOffset(raw: string | undefined): number | undefined {
  if (
    !raw ||
    raw === "auto" ||
    isMixedValue(raw) ||
    !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/u.test(raw.trim())
  ) {
    return undefined;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function authoredPositionPatch(
  element: Pick<
    ElementInfo,
    | "boundingRect"
    | "computedStyles"
    | "inlineStyles"
    | "parentBoundingRect"
    | "parentAutoLayout"
    | "positionReferenceRect"
    | "positionContainingBlockOrigin"
    | "positionContainingBlockTransform"
  >,
  axis: "x" | "y",
  referenceOffset: number,
): Partial<Record<"left" | "top", string>> {
  const parentBounds =
    element.parentBoundingRect ?? element.parentAutoLayout?.boundingRect;
  const referenceBounds = element.positionReferenceRect ?? parentBounds;
  const matrix =
    element.positionContainingBlockTransform ??
    ({ a: 1, b: 0, c: 0, d: 1 } as const);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return {};
  }

  const deltaX =
    axis === "x" ? referenceOffset - measuredPositionOffset(element, "x") : 0;
  const deltaY =
    axis === "y" ? referenceOffset - measuredPositionOffset(element, "y") : 0;
  const leftDelta = (matrix.d * deltaX - matrix.c * deltaY) / determinant;
  const topDelta = (-matrix.b * deltaX + matrix.a * deltaY) / determinant;
  const containingBlockOffset = (coordinate: "x" | "y") =>
    element.positionContainingBlockOrigin && referenceBounds
      ? element.positionContainingBlockOrigin[coordinate] -
        referenceBounds[coordinate]
      : parentBounds && referenceBounds
        ? parentBounds[coordinate] - referenceBounds[coordinate]
        : 0;
  const authoredOffset = (coordinate: "x" | "y") => {
    const property = coordinate === "x" ? "left" : "top";
    return (
      numericPositionOffset(element.computedStyles[property]) ??
      numericPositionOffset(element.inlineStyles?.[property])
    );
  };
  const currentOffset = (coordinate: "x" | "y") =>
    authoredOffset(coordinate) ??
    measuredPositionOffset(element, coordinate) -
      containingBlockOffset(coordinate);
  const patch: Partial<Record<"left" | "top", string>> = {};
  const writeLeft =
    axis === "x" || Math.abs(leftDelta) > 1e-8 || Math.abs(matrix.c) > 1e-8;
  const writeTop =
    axis === "y" || Math.abs(topDelta) > 1e-8 || Math.abs(matrix.b) > 1e-8;
  if (writeLeft || authoredOffset("x") === undefined) {
    patch.left = `${Number((currentOffset("x") + leftDelta).toFixed(2))}px`;
  }
  if (writeTop || authoredOffset("y") === undefined) {
    patch.top = `${Number((currentOffset("y") + topDelta).toFixed(2))}px`;
  }
  return patch;
}

export function measuredPositionValue(
  element: ElementInfo,
  axis: "x" | "y",
  livePosition?: { left: string; top: string },
): string {
  let referenceOffset = measuredPositionOffset(element, axis);
  const liveLeft = livePosition
    ? numericPositionOffset(livePosition.left)
    : undefined;
  const liveTop = livePosition
    ? numericPositionOffset(livePosition.top)
    : undefined;
  const authoredLeft =
    numericPositionOffset(element.computedStyles.left) ??
    numericPositionOffset(element.inlineStyles?.left);
  const authoredTop =
    numericPositionOffset(element.computedStyles.top) ??
    numericPositionOffset(element.inlineStyles?.top);

  if (
    liveLeft !== undefined &&
    liveTop !== undefined &&
    authoredLeft !== undefined &&
    authoredTop !== undefined
  ) {
    const transform =
      element.positionContainingBlockTransform ??
      ({ a: 1, b: 0, c: 0, d: 1 } as const);
    const deltaLeft = liveLeft - authoredLeft;
    const deltaTop = liveTop - authoredTop;
    referenceOffset +=
      axis === "x"
        ? transform.a * deltaLeft + transform.c * deltaTop
        : transform.b * deltaLeft + transform.d * deltaTop;
  }

  return `${Number(referenceOffset.toFixed(2))}px`;
}

function percentageLength(raw: string | undefined): boolean {
  return !!raw && /^-?(?:\d+\.?\d*|\.\d+)%$/.test(raw.trim());
}

function geometryPercent(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return "0%";
  }
  return `${Number(((value / total) * 100).toFixed(6))}%`;
}

function geometryPx(value: number): string {
  return `${quantizeToStep(value)}px`;
}

function authoredConstraintValue(
  element: ElementInfo,
  property: string,
): string | undefined {
  if (element.inlineStyles !== undefined) {
    const value = element.inlineStyles[property];
    return value === "auto" ? "" : value;
  }
  return element.computedStyles[property];
}

export function deriveConstraintsValue(element: ElementInfo): ConstraintsValue {
  const authoredLeft = authoredConstraintValue(element, "left");
  const authoredRight = authoredConstraintValue(element, "right");
  const authoredTop = authoredConstraintValue(element, "top");
  const authoredBottom = authoredConstraintValue(element, "bottom");
  const authoredWidth = authoredConstraintValue(element, "width");
  const authoredHeight = authoredConstraintValue(element, "height");
  const authoredTransform = authoredConstraintValue(element, "transform");
  const definiteLeft = definiteAuthoredOffset(authoredLeft);
  const definiteRight = definiteAuthoredOffset(authoredRight);
  const definiteTop = definiteAuthoredOffset(authoredTop);
  const definiteBottom = definiteAuthoredOffset(authoredBottom);
  const horizontalMixed = [
    authoredLeft,
    authoredRight,
    authoredWidth,
    authoredTransform,
  ].some(isMixedValue);
  const verticalMixed = [
    authoredTop,
    authoredBottom,
    authoredHeight,
    authoredTransform,
  ].some(isMixedValue);
  return {
    horizontal: horizontalMixed
      ? "mixed"
      : authoredWidth === "100%" ||
          (percentageLength(authoredWidth) && percentageLength(definiteLeft))
        ? "scale"
        : definiteLeft && definiteRight
          ? "left-right"
          : definiteRight
            ? "right"
            : authoredTransform?.includes("translateX(-50%)")
              ? "center"
              : "left",
    vertical: verticalMixed
      ? "mixed"
      : authoredHeight === "100%" ||
          (percentageLength(authoredHeight) && percentageLength(definiteTop))
        ? "scale"
        : definiteTop && definiteBottom
          ? "top-bottom"
          : definiteBottom
            ? "bottom"
            : authoredTransform?.includes("translateY(-50%)")
              ? "center"
              : "top",
  };
}

export function constraintsStylePatch(
  element: ElementInfo,
  value: ConstraintsValue,
): Record<string, string> {
  const authoredTransform = authoredConstraintValue(element, "transform");
  const currentValue = deriveConstraintsValue(element);
  const patch: Record<string, string> = {};
  let transform = isMixedValue(authoredTransform)
    ? undefined
    : authoredTransform;
  let transformChanged = false;
  const parentBounds =
    element.parentBoundingRect ?? element.parentAutoLayout?.boundingRect;
  const childBounds = element.boundingRect;
  const relativeLeft = parentBounds
    ? childBounds.x - parentBounds.x
    : childBounds.x;
  const relativeTop = parentBounds
    ? childBounds.y - parentBounds.y
    : childBounds.y;
  const rightGap = parentBounds
    ? parentBounds.width - relativeLeft - childBounds.width
    : 0;
  const bottomGap = parentBounds
    ? parentBounds.height - relativeTop - childBounds.height
    : 0;

  if (
    value.horizontal !== "mixed" &&
    value.horizontal !== currentValue.horizontal
  ) {
    patch.position = "absolute";
    transform = mergeTranslateFunction(
      transform,
      "X",
      value.horizontal === "center" ? "-50%" : null,
    );
    transformChanged = true;
    if (value.horizontal === "left") {
      patch.left = geometryPx(relativeLeft);
      patch.right = "auto";
      patch.width = geometryPx(childBounds.width);
    } else if (value.horizontal === "right") {
      patch.right = geometryPx(rightGap);
      patch.left = "auto";
      patch.width = geometryPx(childBounds.width);
    } else if (value.horizontal === "left-right") {
      patch.left = geometryPx(relativeLeft);
      patch.right = geometryPx(rightGap);
      patch.width = "auto";
    } else if (value.horizontal === "center") {
      const centerOffset = parentBounds
        ? relativeLeft + childBounds.width / 2 - parentBounds.width / 2
        : 0;
      patch.left =
        Math.abs(centerOffset) < 0.0005
          ? "50%"
          : `calc(50% + ${geometryPx(centerOffset)})`;
      patch.right = "auto";
      patch.width = geometryPx(childBounds.width);
    } else {
      patch.left = parentBounds
        ? geometryPercent(relativeLeft, parentBounds.width)
        : "0%";
      patch.right = "auto";
      patch.width = parentBounds
        ? geometryPercent(childBounds.width, parentBounds.width)
        : "100%";
    }
  }

  if (value.vertical !== "mixed" && value.vertical !== currentValue.vertical) {
    patch.position = "absolute";
    transform = mergeTranslateFunction(
      transform,
      "Y",
      value.vertical === "center" ? "-50%" : null,
    );
    transformChanged = true;
    if (value.vertical === "top") {
      patch.top = geometryPx(relativeTop);
      patch.bottom = "auto";
      patch.height = geometryPx(childBounds.height);
    } else if (value.vertical === "bottom") {
      patch.bottom = geometryPx(bottomGap);
      patch.top = "auto";
      patch.height = geometryPx(childBounds.height);
    } else if (value.vertical === "top-bottom") {
      patch.top = geometryPx(relativeTop);
      patch.bottom = geometryPx(bottomGap);
      patch.height = "auto";
    } else if (value.vertical === "center") {
      const centerOffset = parentBounds
        ? relativeTop + childBounds.height / 2 - parentBounds.height / 2
        : 0;
      patch.top =
        Math.abs(centerOffset) < 0.0005
          ? "50%"
          : `calc(50% + ${geometryPx(centerOffset)})`;
      patch.bottom = "auto";
      patch.height = geometryPx(childBounds.height);
    } else {
      patch.top = parentBounds
        ? geometryPercent(relativeTop, parentBounds.height)
        : "0%";
      patch.bottom = "auto";
      patch.height = parentBounds
        ? geometryPercent(childBounds.height, parentBounds.height)
        : "100%";
    }
  }

  if (transformChanged) patch.transform = transform || "none";
  return patch;
}

export function PositionLayoutProperties({
  element,
  onStyleChange,
  onStylesChange,
  onAlignSelection,
  alignSelectionDisabled = false,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onAlignSelection?: (
    edge: "left" | "center-h" | "right" | "top" | "center-v" | "bottom",
  ) => void;
  alignSelectionDisabled?: boolean;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const applePlatform = useApplePlatform();
  const shortcut = (binding: string) =>
    formatShortcutLabel(binding, applePlatform);
  const styles = element.computedStyles;
  const constrainedPosition =
    styles.position === "absolute" || styles.position === "fixed";
  const alignmentDisabled = alignSelectionDisabled || !onAlignSelection;
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
  const liveDragPosition = useLiveDragPosition(element.selector);
  const authoredLeft = authoredStyleValue(element, "left");
  const authoredTop = authoredStyleValue(element, "top");
  const authoredTransform = authoredStyleValue(element, "transform");
  const rotationTransform = isMixedValue(styles.transform)
    ? undefined
    : (authoredTransform ?? styles.transform);
  const constraintsValue = deriveConstraintsValue(element);
  const [constraintsExpanded, setConstraintsExpanded] = useState(false);
  const constraintsSuppressed =
    element.isFlexChild &&
    !["absolute", "fixed"].includes(
      (element.computedStyles?.position ?? "").toLowerCase(),
    );
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
      commitStylePatch(
        constraintsStylePatch(element, value),
        onStyleChange,
        onStylesChange,
      );
    },
    [element, onStyleChange, onStylesChange],
  );

  return (
    <PanelSection
      title={t("editPanel.sections.positionLayout")}
      actions={
        <SectionIconToggle
          label={"Absolute position" /* i18n-ignore design inspector action */}
          active={constrainedPosition}
          onClick={() =>
            commitStylePatch(
              constrainedPosition
                ? {
                    position: "relative",
                    inset: "auto",
                    left: "auto",
                    right: "auto",
                    top: "auto",
                    bottom: "auto",
                  }
                : { position: "absolute" },
              onStyleChange,
              onStylesChange,
            )
          }
        >
          <IconLayoutDistributeHorizontal className="size-3.5" />
        </SectionIconToggle>
      }
    >
      <div className="design-sidebar-property-group">
        <SubsectionLabel>
          {"Alignment" /* i18n-ignore design inspector label */}
        </SubsectionLabel>
        <InspectorActionPairGrid
          className="items-center"
          left={
            <InspectorSegment className="w-full">
              <InspectorIconButton
                label={t("editPanel.positionAligns.left")}
                shortcut={shortcut("alt+a")}
                disabled={alignmentDisabled}
                onClick={() => handlePositionAlignH("left")}
              >
                <IconLayoutAlignLeft className="size-3.5" />
              </InspectorIconButton>
              <InspectorIconButton
                label={t("editPanel.positionAligns.centerHorizontal")}
                shortcut={shortcut("alt+h")}
                disabled={alignmentDisabled}
                onClick={() => handlePositionAlignH("center")}
              >
                <IconLayoutAlignCenter className="size-3.5" />
              </InspectorIconButton>
              <InspectorIconButton
                label={t("editPanel.positionAligns.right")}
                shortcut={shortcut("alt+d")}
                disabled={alignmentDisabled}
                onClick={() => handlePositionAlignH("right")}
              >
                <IconLayoutAlignRight className="size-3.5" />
              </InspectorIconButton>
            </InspectorSegment>
          }
          right={
            <InspectorSegment className="w-full">
              <InspectorIconButton
                label={t("editPanel.positionAligns.top")}
                shortcut={shortcut("alt+w")}
                disabled={alignmentDisabled}
                onClick={() => handlePositionAlignV("top")}
              >
                <IconLayoutAlignTop className="size-3.5" />
              </InspectorIconButton>
              <InspectorIconButton
                label={t("editPanel.positionAligns.centerVertical")}
                shortcut={shortcut("alt+v")}
                disabled={alignmentDisabled}
                onClick={() => handlePositionAlignV("middle")}
              >
                <IconLayoutAlignMiddle className="size-3.5" />
              </InspectorIconButton>
              <InspectorIconButton
                label={t("editPanel.positionAligns.bottom")}
                shortcut={shortcut("alt+s")}
                disabled={alignmentDisabled}
                onClick={() => handlePositionAlignV("bottom")}
              >
                <IconLayoutAlignBottom className="size-3.5" />
              </InspectorIconButton>
            </InspectorSegment>
          }
        />
      </div>

      <div className="design-sidebar-property-group">
        <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
        <InspectorGrid className="items-center" layout="action-pair">
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
            className="group/field relative"
          >
            <ScrubStyleInput
              label="X"
              ariaLabel="X-position"
              tooltipLabel="X-position"
              precision={2}
              value={
                isMixedValue(authoredLeft) || isMixedValue(styles.left)
                  ? MIXED_VALUE
                  : measuredPositionValue(
                      element,
                      "x",
                      liveDragPosition ?? undefined,
                    )
              }
              inputClassName="h-6"
              onChange={(v, meta) => {
                commitStylePatch(
                  {
                    ...(!constrainedPosition
                      ? { position: "absolute" }
                      : undefined),
                    ...authoredPositionPatch(element, "x", v),
                  },
                  onStyleChange,
                  onStylesChange,
                  meta,
                );
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
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
            className="group/field relative"
          >
            <ScrubStyleInput
              label="Y"
              ariaLabel="Y-position"
              tooltipLabel="Y-position"
              precision={2}
              value={
                isMixedValue(authoredTop) || isMixedValue(styles.top)
                  ? MIXED_VALUE
                  : measuredPositionValue(
                      element,
                      "y",
                      liveDragPosition ?? undefined,
                    )
              }
              inputClassName="h-6"
              onChange={(v, meta) => {
                commitStylePatch(
                  {
                    ...(!constrainedPosition
                      ? { position: "absolute" }
                      : undefined),
                    ...authoredPositionPatch(element, "y", v),
                  },
                  onStyleChange,
                  onStylesChange,
                  meta,
                );
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
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_SPAN}
            className="flex items-center justify-center"
          >
            {/* Auto-layout containers position in-flow children. An absolutely
              positioned descendant leaves that flow and can still use anchors. */}
            {constraintsSuppressed ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={
                      "Constraints" /* i18n-ignore design inspector action */
                    }
                    aria-pressed={constraintsExpanded}
                    onClick={() =>
                      setConstraintsExpanded((expanded) => !expanded)
                    }
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md transition-colors",
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
            )}
          </InspectorGridCell>
        </InspectorGrid>
        {constraintsExpanded && !constraintsSuppressed ? (
          <ConstraintsWidget
            value={constraintsValue}
            onChange={handleConstraintsChange}
            className="pt-1"
          />
        ) : null}
      </div>

      <div className="design-sidebar-property-group">
        <SubsectionLabel>{t("editPanel.labels.rotation")}</SubsectionLabel>
        <InspectorGrid className="items-center" layout="action-pair">
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_PAIR_SPAN}
            className="group relative"
          >
            <ScrubStyleInput
              label="Rotation"
              ariaLabel={t("editPanel.labels.rotation")}
              tooltipLabel={t("editPanel.labels.rotation")}
              hideIcon={false}
              icon={IconAngle}
              labelClassName="[&>span]:sr-only"
              value={
                isMixedValue(styles.transform)
                  ? MIXED_VALUE
                  : `${-parseRotationValue(rotationTransform)}deg`
              }
              unit="deg"
              inputClassName="h-6"
              onChange={(v, meta) => {
                const mixedRotation = isMixedValue(styles.transform);
                const hasPerTargetOperation =
                  typeof meta?.relativeDelta === "number" ||
                  meta?.relativeExpression !== undefined;
                const perTargetMeta =
                  mixedRotation && !hasPerTargetOperation
                    ? {
                        ...meta,
                        relativeExpression: {
                          expression: `Mixed*0+${v}`,
                          unit: "deg",
                        },
                      }
                    : meta;
                onStyleChange(
                  mixedRotation &&
                    (hasPerTargetOperation || perTargetMeta?.relativeExpression)
                    ? "rotation"
                    : "transform",
                  mergeRotationValue(rotationTransform, -v),
                  perTargetMeta,
                );
              }}
            />
            <FieldTrailer
              element={element}
              motionCssProperty="rotate"
              overrideProperty="transform"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              hoverRevealClassName="opacity-0 group-hover:opacity-100"
            />
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell span={INSPECTOR_GRID_ACTION_PAIR_SPAN}>
            <InspectorSegment className="w-full">
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
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell
            span={INSPECTOR_GRID_ACTION_SPAN}
            className="flex justify-center"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("editPanel.labels.rotation3d")}
                  aria-pressed={rotation3DExpanded}
                  onClick={() => setRotation3DExpanded((expanded) => !expanded)}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
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
              <TooltipContent>
                {t("editPanel.labels.rotation3d")}
              </TooltipContent>
            </Tooltip>
          </InspectorGridCell>
        </InspectorGrid>
        {rotation3DExpanded ? (
          <Rotation3DControls styles={styles} onStyleChange={onStyleChange} />
        ) : null}
      </div>
    </PanelSection>
  );
}

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
    <div className="space-y-2 pt-1">
      {isCustomTransform ? (
        <p className="!text-[11px] text-muted-foreground">
          {t("editPanel.labels.customTransform")}
        </p>
      ) : null}
      <InspectorGrid className="items-center" layout="pair">
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
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
        </InspectorGridCell>
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_GUTTER_SPAN} ariaHidden />
        <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
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
        </InspectorGridCell>
        <InspectorGridCell span={28}>
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
            className="w-full gap-0"
            labelClassName="h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] [&>span]:sr-only"
            inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
          />
        </InspectorGridCell>
      </InspectorGrid>
    </div>
  );
}
