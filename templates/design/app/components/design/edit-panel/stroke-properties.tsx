import { useT } from "@agent-native/core/client/i18n";
import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import {
  isVectorEndpointStyle,
  isVectorEndpointPrimitiveKind,
  vectorEndpointPairForPrimitive,
  VECTOR_END_ENDPOINT_PROPERTY,
  VECTOR_ENDPOINT_STYLES,
  VECTOR_START_ENDPOINT_PROPERTY,
  type VectorEndpointStyle,
} from "@shared/vector-endpoints";
import {
  IconAdjustments,
  IconArrowsLeftRight,
  IconBorderStyle,
  IconEye,
  IconEyeOff,
  IconLayoutGrid,
  IconMinus,
  IconPlus,
  IconSquare,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ScrubInput } from "../inspector";
import type { DesignPaintType } from "../inspector/DesignColorPicker";
import type { ElementInfo } from "../types";
import { isTextElement, isVectorShapeElement } from "./element-classification";
import { commitStylePatch, FieldTrailer } from "./field-primitives";
import { SectionIconButton } from "./inspector-controls";
import {
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  INSPECTOR_GRID_STROKE_GUTTER_SPAN,
  INSPECTOR_GRID_STROKE_POSITION_SPAN,
  INSPECTOR_GRID_STROKE_WEIGHT_SPAN,
  InspectorGrid,
  InspectorGridCell,
  InspectorPaintRow,
} from "./inspector-grid";
import { ColorInput, PanelSection, SubsectionLabel } from "./panel-primitives";
import {
  cssColorOrFallback,
  cssLengthNumber,
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  readTextStrokeStyle,
  resolveRestoredStrokeStyle,
  resolveTextStrokeColor,
  roundToOneDecimal,
  strokeHiddenByColor,
  strokeIsVisible,
  strokeShowPatch,
  textStrokeAddPatch,
  textStrokeIsVisible,
  vectorStrokeExists,
  vectorStrokeIsVisible,
} from "./position-helpers";
import { isMixedValue } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";
import { STROKE_POSITION_OPTIONS } from "./style-options";
import { vectorEndpointInspectorIdentity } from "./vector-endpoint-inspector";

const SOLID_ONLY_PAINT_TYPES: DesignPaintType[] = ["solid"];
const CSS_BORDER_PAINT_TYPES: DesignPaintType[] = ["solid", "linear"];
const VECTOR_STROKE_PAINT_TYPES: DesignPaintType[] = [
  "solid",
  "linear",
  "radial",
];

// guard:allow-raw-color — authored strokes need a concrete CSS color fallback.
const DEFAULT_STROKE_COLOR = "#000000";

type StrokeLayerKind = "border" | "outline";
type StrokePosition = "inside" | "outside" | "center";

function StrokeLayerControl({
  kind,
  visible,
  color,
  gradient,
  supportsGradient,
  width,
  styleValue,
  outlineOffset,
  onStyleChange,
  onStylesChange,
  onRemove,
  element,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  kind: StrokeLayerKind;
  visible: boolean;
  color: string;
  gradient?: string;
  supportsGradient?: boolean;
  width: string;
  styleValue: string;
  outlineOffset?: string;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onRemove: () => void;
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const strokePositionOptions = STROKE_POSITION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.labels.${option.key}`),
  }));
  const prefix = kind === "border" ? "border" : "outline";
  const position: StrokePosition =
    kind === "border"
      ? "inside"
      : readStrokeOutlinePosition(width, outlineOffset);

  const movePosition = (next: string) => {
    if (next === position) return;
    const nextPosition = next as StrokePosition;
    if (kind === "outline" && nextPosition !== "inside") {
      onStyleChange(
        "outlineOffset",
        outlineOffsetForPosition(nextPosition, width),
      );
      return;
    }
    const nextPrefix = nextPosition === "inside" ? "border" : "outline";
    const patch: Record<string, string> = {
      [`${nextPrefix}Color`]: color,
      [`${nextPrefix}Width`]: width || "1px",
      [`${nextPrefix}Style`]: styleValue || "solid",
    };
    if (nextPrefix === "outline") {
      patch.outlineOffset = outlineOffsetForPosition(
        nextPosition === "center" ? "center" : "outside",
        width || "1px",
      );
    }
    if (kind === "border") {
      patch.borderWidth = "0px";
      patch.borderStyle = "none";
    } else {
      patch.outlineWidth = "0px";
      patch.outlineStyle = "none";
    }
    if (onStylesChange) {
      onStylesChange(patch);
    } else {
      Object.entries(patch).forEach(([property, value]) =>
        onStyleChange(property, value),
      );
    }
  };

  return (
    <div className="space-y-2">
      {/* design stroke row: [swatch+hex trigger (flex-1)] [eye] [remove] */}
      <InspectorPaintRow>
        <InspectorGridCell span={20}>
          <ColorInput
            label=""
            value={gradient || cssColorOrFallback(color, DEFAULT_STROKE_COLOR)}
            onChange={(value, meta) => {
              commitStylePatch(
                { [`${prefix}Color`]: value },
                onStyleChange,
                onStylesChange,
                meta,
              );
            }}
            singlePaint={Boolean(supportsGradient || gradient)}
            supportsLayeredFills={Boolean(supportsGradient || gradient)}
            onSolidToGradientChange={(patch) =>
              onStyleChange(`${prefix}Color`, patch.backgroundImage)
            }
            supportedPaintTypes={
              supportsGradient ? CSS_BORDER_PAINT_TYPES : SOLID_ONLY_PAINT_TYPES
            }
          />
        </InspectorGridCell>
        <InspectorGridCell span={4} className="flex justify-center">
          <SectionIconButton
            label={
              visible
                ? t("editPanel.labels.hideLayer")
                : t("editPanel.labels.showLayer")
            }
            onClick={() => {
              if (kind === "border" && gradient) {
                onStyleChange(
                  `${prefix}Color`,
                  visible ? "transparent" : gradient,
                );
                return;
              }
              if (visible) {
                const parsed = parseCssColor(color);
                onStyleChange(
                  `${prefix}Color`,
                  parsed
                    ? rgbaToCss(withColorOpacity(parsed, 0))
                    : "transparent",
                );
                return;
              }
              commitStylePatch(
                strokeShowPatch(prefix, color, width, styleValue),
                onStyleChange,
                onStylesChange,
              );
            }}
          >
            {visible ? (
              <IconEye className="size-3.5" />
            ) : (
              <IconEyeOff className="size-3.5" />
            )}
          </SectionIconButton>
        </InspectorGridCell>
        <InspectorGridCell span={4} className="flex justify-center">
          <SectionIconButton
            label={t("editPanel.labels.removeLayer")}
            onClick={onRemove}
          >
            <IconMinus className="size-3.5" />
          </SectionIconButton>
        </InspectorGridCell>
        {kind === "border" && element ? (
          <InspectorGridCell span={1} className="flex justify-center">
            <FieldTrailer
              element={element}
              motionCssProperty="border-color"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
              hoverRevealClassName="opacity-0 group-hover:opacity-100"
            />
          </InspectorGridCell>
        ) : null}
      </InspectorPaintRow>
      <div className="design-sidebar-property-group">
        <InspectorGrid
          className="design-sidebar-property-grid items-end"
          layout="stroke-details"
        >
          <InspectorGridCell span={INSPECTOR_GRID_STROKE_POSITION_SPAN}>
            <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_STROKE_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell span={INSPECTOR_GRID_STROKE_WEIGHT_SPAN}>
            <SubsectionLabel>{t("editPanel.labels.weight")}</SubsectionLabel>
          </InspectorGridCell>
        </InspectorGrid>
        <InspectorGrid className="items-center" layout="stroke-details">
          <InspectorGridCell span={INSPECTOR_GRID_STROKE_POSITION_SPAN}>
            <Select value={position} onValueChange={movePosition}>
              <SelectTrigger className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {strokePositionOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="!text-[11px]"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_STROKE_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell span={INSPECTOR_GRID_STROKE_WEIGHT_SPAN}>
            <div className="group/field relative min-w-0">
              <ScrubInput
                label={t("editPanel.labels.weight")}
                ariaLabel={t("editPanel.labels.weight")}
                icon={IconBorderStyle}
                value={cssLengthNumber(width)}
                onChange={(value, meta) => {
                  const nextWidth = `${Math.max(0, roundToOneDecimal(value))}px`;
                  if (kind === "outline" && position === "center") {
                    const patch = {
                      outlineWidth: nextWidth,
                      outlineOffset: outlineOffsetForPosition(
                        "center",
                        nextWidth,
                      ),
                    };
                    if (onStylesChange) onStylesChange(patch, meta);
                    else
                      Object.entries(patch).forEach(([p, v]) =>
                        onStyleChange(p, v, meta),
                      );
                    return;
                  }
                  onStyleChange(`${prefix}Width`, nextWidth, meta);
                }}
                unit="px"
                min={0}
                precision={1}
                className="w-full gap-0"
                labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
                inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
              />
              {kind === "border" && element ? (
                <FieldTrailer
                  element={element}
                  motionCssProperty="border-width"
                  motionKeyframeContext={motionKeyframeContext}
                  breakpointOverrideContext={breakpointOverrideContext}
                  className="absolute -top-3.5 right-0"
                  hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
                />
              ) : null}
            </div>
          </InspectorGridCell>
          <InspectorGridCell span={4} className="flex justify-center">
            <SectionIconButton
              label={"Stroke settings — Coming soon" /* i18n-ignore */}
              disabled
              className="disabled:opacity-100"
            >
              <IconAdjustments className="size-3.5" />
            </SectionIconButton>
          </InspectorGridCell>
          <InspectorGridCell span={4} className="flex justify-center">
            <SectionIconButton
              label={"Individual strokes — Coming soon" /* i18n-ignore */}
              disabled
              className="disabled:opacity-100"
            >
              <IconSquare className="size-3.5" />
            </SectionIconButton>
          </InspectorGridCell>
        </InspectorGrid>
      </div>
    </div>
  );
}

export function StrokeProperties({
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
  const styles = element.computedStyles;
  if (isTextElement(element)) {
    return (
      <TextStrokeProperties
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
      />
    );
  }
  if (isVectorShapeElement(element)) {
    return (
      <VectorStrokeProperties
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
        breakpointOverrideContext={breakpointOverrideContext}
      />
    );
  }
  const borderVisible =
    strokeIsVisible(styles.borderWidth, styles.borderStyle) &&
    !strokeHiddenByColor(styles.borderColor);
  const outlineVisible =
    strokeIsVisible(styles.outlineWidth, styles.outlineStyle) &&
    !strokeHiddenByColor(styles.outlineColor);
  const strokeIsMixed = [
    styles.borderWidth,
    styles.borderStyle,
    styles.borderColor,
    styles.outlineWidth,
    styles.outlineStyle,
    styles.outlineColor,
    styles.outlineOffset,
  ].some(isMixedValue);
  const inlineStyles = element.inlineStyles ?? {};
  const borderGradient = inlineStyles["--an-css-border-gradient"];
  const hasAuthoredSideBorder = Object.keys(inlineStyles).some((property) =>
    /^border(?:Top|Right|Bottom|Left)(?:Width|Style|Color)?$/.test(property),
  );
  const canEditBorderGradient =
    element.tagName?.toLowerCase() === "div" &&
    element.classes.length === 0 &&
    (!element.primitiveKind || element.primitiveKind === "rectangle") &&
    Boolean(
      inlineStyles.border ||
      (inlineStyles.borderWidth &&
        inlineStyles.borderStyle &&
        inlineStyles.borderColor),
    ) &&
    !hasAuthoredSideBorder &&
    [
      styles.borderTopWidth ?? styles.borderWidth,
      styles.borderRightWidth ?? styles.borderWidth,
      styles.borderBottomWidth ?? styles.borderWidth,
      styles.borderLeftWidth ?? styles.borderWidth,
    ].every((width) => width === styles.borderWidth) &&
    [
      styles.borderTopStyle ?? styles.borderStyle,
      styles.borderRightStyle ?? styles.borderStyle,
      styles.borderBottomStyle ?? styles.borderStyle,
      styles.borderLeftStyle ?? styles.borderStyle,
    ].every((style) => style === "solid") &&
    [
      styles.borderTopColor,
      styles.borderRightColor,
      styles.borderBottomColor,
      styles.borderLeftColor,
    ].every((color) => !color || color === styles.borderColor) &&
    [
      styles.borderTopLeftRadius,
      styles.borderTopRightRadius,
      styles.borderBottomRightRadius,
      styles.borderBottomLeftRadius,
    ].every((radius) => !radius || cssLengthNumber(radius) === 0);
  const cssBorderGradientVisible =
    Boolean(borderGradient) && inlineStyles.borderImageSource !== "none";
  const borderExists = strokeIsVisible(styles.borderWidth, styles.borderStyle);
  const outlineExists = strokeIsVisible(
    styles.outlineWidth,
    styles.outlineStyle,
  );
  const hasStrokeContent = strokeIsMixed || borderExists || outlineExists;
  const addStroke = () => {
    if (strokeIsMixed) {
      commitStylePatch(
        {
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: DEFAULT_STROKE_COLOR,
          outlineWidth: "0px",
          outlineStyle: "none",
        },
        onStyleChange,
        onStylesChange,
      );
      return;
    }
    if (!borderVisible) {
      const existingBorderColor = styles.borderColor || styles.color;
      const existingParsed = parseCssColor(existingBorderColor || "");
      const borderColor = cssColorOrFallback(
        existingParsed
          ? rgbaToCss(withColorOpacity(existingParsed, 100))
          : existingBorderColor,
        DEFAULT_STROKE_COLOR,
      );
      commitStylePatch(
        {
          borderWidth: "1px",
          borderStyle: resolveRestoredStrokeStyle(styles.borderStyle),
          borderColor,
        },
        onStyleChange,
        onStylesChange,
      );
      return;
    }
    if (outlineVisible) {
      const outlineWidth = `${Math.max(1, cssLengthNumber(styles.outlineWidth, 1)) + 1}px`;
      const outlineStyle = resolveRestoredStrokeStyle(styles.outlineStyle);
      const outlineColor = cssColorOrFallback(
        styles.outlineColor || styles.borderColor,
        DEFAULT_STROKE_COLOR,
      );
      commitStylePatch(
        {
          outlineWidth,
          outlineStyle,
          outlineColor,
          outlineOffset: styles.outlineOffset || "0px",
        },
        onStyleChange,
        onStylesChange,
      );
      return;
    }
    commitStylePatch(
      {
        outlineWidth: "1px",
        outlineStyle: "solid",
        outlineColor: cssColorOrFallback(
          styles.borderColor,
          DEFAULT_STROKE_COLOR,
        ),
        outlineOffset: "0px",
      },
      onStyleChange,
      onStylesChange,
    );
  };

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      onEmptyTitleClick={addStroke}
      emptyTitleActionLabel={t("editPanel.labels.addStroke")}
      actions={
        <>
          <SectionIconButton
            label={t("editPanel.labels.stylesComingSoon")}
            disabled
          >
            <IconLayoutGrid className="size-3.5" />
          </SectionIconButton>
          <SectionIconButton
            label={t("editPanel.labels.addStroke")}
            onClick={addStroke}
          >
            <IconPlus className="size-3.5" />
          </SectionIconButton>
        </>
      }
    >
      {hasStrokeContent ? (
        <>
          {strokeIsMixed ? (
            <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
              {
                "Click + to replace mixed content" /* i18n-ignore figma mixed stroke hint */
              }
            </p>
          ) : borderExists ? (
            <StrokeLayerControl
              kind="border"
              visible={borderVisible || cssBorderGradientVisible}
              color={
                inlineStyles["--an-css-border-solid-color"] ||
                styles.borderColor ||
                DEFAULT_STROKE_COLOR
              }
              gradient={borderGradient}
              supportsGradient={canEditBorderGradient}
              width={styles.borderWidth || "0px"}
              styleValue={styles.borderStyle || "none"}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
              onRemove={() => {
                if (onStylesChange) {
                  onStylesChange({
                    borderWidth: "0px",
                    borderStyle: "none",
                  });
                } else {
                  onStyleChange("borderWidth", "0px");
                }
              }}
              element={element}
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
            />
          ) : null}
          {outlineExists ? (
            <StrokeLayerControl
              kind="outline"
              visible={outlineVisible}
              color={
                styles.outlineColor ||
                styles.borderColor ||
                DEFAULT_STROKE_COLOR
              }
              width={styles.outlineWidth || "0px"}
              styleValue={styles.outlineStyle || "solid"}
              outlineOffset={styles.outlineOffset || "0px"}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
              onRemove={() => {
                if (onStylesChange) {
                  onStylesChange({
                    outlineWidth: "0px",
                    outlineStyle: "none",
                  });
                } else {
                  onStyleChange("outlineWidth", "0px");
                }
              }}
              element={element}
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
            />
          ) : null}
        </>
      ) : null}
    </PanelSection>
  );
}

function TextStrokeProperties({
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
  const { width, color } = readTextStrokeStyle(styles);
  const isMixed = [
    styles.webkitTextStrokeWidth,
    styles.webkitTextStrokeColor,
    styles["-webkit-text-stroke"],
    styles.WebkitTextStroke,
  ].some(isMixedValue);
  const strokeExists = cssLengthNumber(width) > 0;
  const visible = textStrokeIsVisible(width, color);
  const addStroke = () => {
    commitStylePatch(textStrokeAddPatch(color), onStyleChange, onStylesChange);
  };

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      onEmptyTitleClick={addStroke}
      emptyTitleActionLabel={t("editPanel.labels.addStroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addStroke")}
          onClick={addStroke}
        >
          <IconPlus className="size-3.5" />
        </SectionIconButton>
      }
    >
      {isMixed ? (
        <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
          {
            "Click + to replace mixed content" /* i18n-ignore figma mixed stroke hint */
          }
        </p>
      ) : strokeExists ? (
        <div className="space-y-2">
          <InspectorPaintRow>
            <InspectorGridCell span={20}>
              <ColorInput
                label=""
                value={resolveTextStrokeColor(color)}
                onChange={(value, meta) =>
                  onStyleChange("-webkit-text-stroke-color", value, meta)
                }
                supportedPaintTypes={SOLID_ONLY_PAINT_TYPES}
              />
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              <SectionIconButton
                label={
                  visible
                    ? t("editPanel.labels.hideLayer")
                    : t("editPanel.labels.showLayer")
                }
                onClick={() => {
                  const parsed = parseCssColor(color);
                  if (visible) {
                    onStyleChange(
                      "-webkit-text-stroke-color",
                      parsed
                        ? rgbaToCss(withColorOpacity(parsed, 0))
                        : "transparent",
                    );
                    return;
                  }
                  const restoredColor = parsed
                    ? rgbaToCss(withColorOpacity(parsed, 100))
                    : DEFAULT_STROKE_COLOR;
                  commitStylePatch(
                    {
                      "-webkit-text-stroke-color": restoredColor,
                      "-webkit-text-stroke-width":
                        width === "0px" ? "1px" : width,
                    },
                    onStyleChange,
                    onStylesChange,
                  );
                }}
              >
                {visible ? (
                  <IconEye className="size-3.5" />
                ) : (
                  <IconEyeOff className="size-3.5" />
                )}
              </SectionIconButton>
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              <SectionIconButton
                label={t("editPanel.labels.removeLayer")}
                onClick={() => {
                  commitStylePatch(
                    {
                      "-webkit-text-stroke-width": "0px",
                      "-webkit-text-stroke-color": "transparent",
                    },
                    onStyleChange,
                    onStylesChange,
                  );
                }}
              >
                <IconMinus className="size-3.5" />
              </SectionIconButton>
            </InspectorGridCell>
          </InspectorPaintRow>
          <InspectorGrid className="items-center" layout="pair">
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN} ariaHidden />
            <InspectorGridCell
              span={INSPECTOR_GRID_PAIR_GUTTER_SPAN}
              ariaHidden
            />
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <ScrubInput
                label={t("editPanel.labels.weight")}
                ariaLabel={t("editPanel.labels.weight")}
                icon={IconBorderStyle}
                value={cssLengthNumber(width)}
                onChange={(value, meta) => {
                  const nextWidth = `${Math.max(0, roundToOneDecimal(value))}px`;
                  onStyleChange("-webkit-text-stroke-width", nextWidth, meta);
                }}
                unit="px"
                min={0}
                precision={1}
                className="w-full gap-0"
                labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
                inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
              />
            </InspectorGridCell>
          </InspectorGrid>
        </div>
      ) : null}
    </PanelSection>
  );
}

function VectorEndpointControls({
  element,
  styles,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
}) {
  const t = useT();
  const startStyle = styles[VECTOR_START_ENDPOINT_PROPERTY];
  const endStyle = styles[VECTOR_END_ENDPOINT_PROPERTY];
  const endpoints = vectorEndpointPairForPrimitive(
    element.primitiveKind,
    startStyle,
    endStyle,
  );
  const endpointIdentity = vectorEndpointInspectorIdentity(element);
  const [localEndpointState, setLocalEndpointState] = useState(() => ({
    identity: endpointIdentity,
    endpoints,
  }));
  useEffect(() => {
    setLocalEndpointState((current) => {
      if (current.identity !== endpointIdentity) {
        return { identity: endpointIdentity, endpoints };
      }
      if (
        !isVectorEndpointStyle(startStyle) &&
        !isVectorEndpointStyle(endStyle)
      ) {
        return current;
      }
      const nextEndpoints = {
        startPoint: isVectorEndpointStyle(startStyle)
          ? startStyle
          : current.endpoints.startPoint,
        endPoint: isVectorEndpointStyle(endStyle)
          ? endStyle
          : current.endpoints.endPoint,
      };
      if (
        nextEndpoints.startPoint === current.endpoints.startPoint &&
        nextEndpoints.endPoint === current.endpoints.endPoint
      ) {
        return current;
      }
      return { identity: endpointIdentity, endpoints: nextEndpoints };
    });
  }, [
    endpointIdentity,
    endpoints.endPoint,
    endpoints.startPoint,
    endStyle,
    startStyle,
  ]);
  const currentEndpoints =
    localEndpointState.identity === endpointIdentity
      ? localEndpointState.endpoints
      : endpoints;
  const endpointLabels: Record<VectorEndpointStyle, string> = {
    none: t("designEditor.vectorEndpoints.options.none"),
    round: t("designEditor.vectorEndpoints.options.round"),
    square: t("designEditor.vectorEndpoints.options.square"),
    line: t("designEditor.vectorEndpoints.options.line"),
    triangle: t("designEditor.vectorEndpoints.options.triangle"),
    "reversed-triangle": t(
      "designEditor.vectorEndpoints.options.reversedTriangle",
    ),
    circle: t("designEditor.vectorEndpoints.options.circle"),
    diamond: t("designEditor.vectorEndpoints.options.diamond"),
  };
  const updateEndpoint = (property: string, value: string): void => {
    if (!isVectorEndpointStyle(value)) return;
    setLocalEndpointState((current) => ({
      identity: endpointIdentity,
      endpoints: {
        ...current.endpoints,
        ...(property === VECTOR_START_ENDPOINT_PROPERTY
          ? { startPoint: value }
          : { endPoint: value }),
      },
    }));
    onStyleChange(property, value);
  };
  const swapEndpoints = () => {
    const patch = {
      [VECTOR_START_ENDPOINT_PROPERTY]: currentEndpoints.endPoint,
      [VECTOR_END_ENDPOINT_PROPERTY]: currentEndpoints.startPoint,
    };
    setLocalEndpointState({
      identity: endpointIdentity,
      endpoints: {
        startPoint: currentEndpoints.endPoint,
        endPoint: currentEndpoints.startPoint,
      },
    });
    if (onStylesChange) onStylesChange(patch);
    else {
      onStyleChange(VECTOR_START_ENDPOINT_PROPERTY, currentEndpoints.endPoint);
      onStyleChange(VECTOR_END_ENDPOINT_PROPERTY, currentEndpoints.startPoint);
    }
  };

  const select = (side: "start" | "end", value: VectorEndpointStyle) => (
    <Select
      value={value}
      onValueChange={(next) =>
        updateEndpoint(
          side === "start"
            ? VECTOR_START_ENDPOINT_PROPERTY
            : VECTOR_END_ENDPOINT_PROPERTY,
          next,
        )
      }
    >
      <SelectTrigger
        aria-label={
          side === "start"
            ? t("designEditor.vectorEndpoints.startPoint")
            : t("designEditor.vectorEndpoints.endPoint")
        }
        className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VECTOR_ENDPOINT_STYLES.map((option) => (
          <SelectItem key={option} value={option} className="!text-[11px]">
            {endpointLabels[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1">
      <div className="min-w-0 space-y-1">
        <SubsectionLabel>
          {t("designEditor.vectorEndpoints.startPoint")}
        </SubsectionLabel>
        {select("start", currentEndpoints.startPoint)}
      </div>
      <SectionIconButton
        label={t("designEditor.vectorEndpoints.swap")}
        onClick={swapEndpoints}
        className="mb-0.5"
      >
        <IconArrowsLeftRight className="size-3.5" />
      </SectionIconButton>
      <div className="min-w-0 space-y-1">
        <SubsectionLabel>
          {t("designEditor.vectorEndpoints.endPoint")}
        </SubsectionLabel>
        {select("end", currentEndpoints.endPoint)}
      </div>
    </div>
  );
}

function VectorStrokeProperties({
  element,
  onStyleChange,
  onStylesChange,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const stroke = styles.stroke || "none";
  const strokeGradient =
    element.inlineStyles?.["--an-vector-stroke-gradient"] ||
    styles["--an-vector-stroke-gradient"];
  const width = styles.strokeWidth || "0px";
  const isMixed = [styles.stroke, styles.strokeWidth].some(isMixedValue);
  const strokeExists = vectorStrokeExists(stroke);
  const visible = strokeGradient
    ? cssLengthNumber(width) > 0 && stroke !== "transparent"
    : vectorStrokeIsVisible(stroke, width);
  const canAlignStroke =
    element.vectorStrokeCanAlign ??
    styles["--an-vector-stroke-can-align"] === "true";
  const positionOptions = STROKE_POSITION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.labels.${option.key}`),
  }));
  const position: StrokePosition = STROKE_POSITION_OPTIONS.some(
    (option) => option.value === styles["--an-vector-stroke-position"],
  )
    ? (styles["--an-vector-stroke-position"] as StrokePosition)
    : "center";
  const supportsEndpointControls =
    element.tagName?.toLowerCase() === "svg" &&
    isVectorEndpointPrimitiveKind(element.primitiveKind) &&
    // Marker choices require a structural SVG rewrite. Keep them out of a
    // responsive scope until the marker DOM can be scoped with the value.
    breakpointOverrideContext?.activeWidthPx == null;
  const addStroke = () => {
    commitStylePatch(
      {
        stroke: cssColorOrFallback(stroke, DEFAULT_STROKE_COLOR),
        strokeWidth: cssLengthNumber(width) > 0 ? width : "1px",
      },
      onStyleChange,
      onStylesChange,
    );
  };

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      onEmptyTitleClick={addStroke}
      emptyTitleActionLabel={t("editPanel.labels.addStroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addStroke")}
          onClick={addStroke}
        >
          <IconPlus className="size-3.5" />
        </SectionIconButton>
      }
    >
      {isMixed ? (
        <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
          {
            "Click + to replace mixed content" /* i18n-ignore figma mixed stroke hint */
          }
        </p>
      ) : strokeExists ? (
        <div className="space-y-2">
          <InspectorPaintRow>
            <InspectorGridCell span={20}>
              <ColorInput
                label=""
                value={
                  strokeGradient ||
                  cssColorOrFallback(stroke, DEFAULT_STROKE_COLOR)
                }
                onChange={(value, meta) => onStyleChange("stroke", value, meta)}
                supportsLayeredFills
                singlePaint
                backgroundImage={strokeGradient}
                onBackgroundImageChange={(value) =>
                  onStyleChange("stroke", value)
                }
                onSolidToGradientChange={(patch) =>
                  onStyleChange("stroke", patch.backgroundImage)
                }
                supportedPaintTypes={VECTOR_STROKE_PAINT_TYPES}
              />
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              <SectionIconButton
                label={
                  visible
                    ? t("editPanel.labels.hideLayer")
                    : t("editPanel.labels.showLayer")
                }
                onClick={() => {
                  if (strokeGradient) {
                    onStyleChange(
                      "stroke",
                      visible ? "transparent" : strokeGradient,
                    );
                    return;
                  }
                  const parsed = parseCssColor(stroke);
                  if (visible) {
                    onStyleChange(
                      "stroke",
                      parsed
                        ? rgbaToCss(withColorOpacity(parsed, 0))
                        : "transparent",
                    );
                    return;
                  }
                  commitStylePatch(
                    {
                      stroke: parsed
                        ? rgbaToCss(withColorOpacity(parsed, 100))
                        : DEFAULT_STROKE_COLOR,
                      strokeWidth: cssLengthNumber(width) > 0 ? width : "1px",
                    },
                    onStyleChange,
                    onStylesChange,
                  );
                }}
              >
                {visible ? (
                  <IconEye className="size-3.5" />
                ) : (
                  <IconEyeOff className="size-3.5" />
                )}
              </SectionIconButton>
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              <SectionIconButton
                label={t("editPanel.labels.removeLayer")}
                onClick={() => onStyleChange("stroke", "none")}
              >
                <IconMinus className="size-3.5" />
              </SectionIconButton>
            </InspectorGridCell>
          </InspectorPaintRow>
          {supportsEndpointControls ? (
            <VectorEndpointControls
              element={element}
              styles={styles}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
            />
          ) : null}
          <InspectorGrid className="items-center" layout="stroke-details">
            <InspectorGridCell span={INSPECTOR_GRID_STROKE_POSITION_SPAN}>
              <SubsectionLabel>
                {t("editPanel.labels.position")}
              </SubsectionLabel>
            </InspectorGridCell>
            <InspectorGridCell
              span={INSPECTOR_GRID_STROKE_GUTTER_SPAN}
              ariaHidden
            />
            <InspectorGridCell span={INSPECTOR_GRID_STROKE_WEIGHT_SPAN}>
              <SubsectionLabel>{t("editPanel.labels.weight")}</SubsectionLabel>
            </InspectorGridCell>
          </InspectorGrid>
          <InspectorGrid className="items-center" layout="stroke-details">
            <InspectorGridCell span={INSPECTOR_GRID_STROKE_POSITION_SPAN}>
              <Select
                value={canAlignStroke ? position : "center"}
                disabled={!canAlignStroke}
                onValueChange={(next) => {
                  if (!STROKE_POSITION_OPTIONS.some((o) => o.value === next))
                    return;
                  const patch = {
                    stroke: cssColorOrFallback(stroke, DEFAULT_STROKE_COLOR),
                    strokeWidth: width === "0px" ? "1px" : width,
                    strokeOpacity: styles.strokeOpacity,
                    strokeDasharray: styles.strokeDasharray,
                    strokeDashoffset: styles.strokeDashoffset,
                    strokeLinecap: styles.strokeLinecap,
                    strokeLinejoin: styles.strokeLinejoin,
                    strokeMiterlimit: styles.strokeMiterlimit,
                    opacity: styles.vectorOpacity,
                    transform: styles.vectorTransform,
                    transformOrigin: styles.vectorTransformOrigin,
                    transformBox: styles.vectorTransformBox,
                    "--an-vector-stroke-position": next,
                  };
                  if (onStylesChange) onStylesChange(patch);
                  else
                    Object.entries(patch).forEach(([property, value]) =>
                      onStyleChange(property, value),
                    );
                }}
              >
                <SelectTrigger
                  aria-label={t("editPanel.labels.position")}
                  className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {positionOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="!text-[11px]"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InspectorGridCell>
            <InspectorGridCell
              span={INSPECTOR_GRID_STROKE_GUTTER_SPAN}
              ariaHidden
            />
            <InspectorGridCell span={INSPECTOR_GRID_STROKE_WEIGHT_SPAN}>
              <ScrubInput
                label={t("editPanel.labels.weight")}
                ariaLabel={t("editPanel.labels.weight")}
                icon={IconBorderStyle}
                value={cssLengthNumber(width)}
                onChange={(value, meta) =>
                  onStyleChange(
                    "strokeWidth",
                    `${Math.max(0, roundToOneDecimal(value))}px`,
                    meta,
                  )
                }
                unit="px"
                min={0}
                precision={1}
                className="w-full gap-0"
                labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
                inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
              />
            </InspectorGridCell>
          </InspectorGrid>
        </div>
      ) : null}
    </PanelSection>
  );
}
