import { useT } from "@agent-native/core/client";
import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import {
  IconBorderStyle,
  IconEye,
  IconEyeOff,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";

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
import { isTextElement } from "./element-classification";
import { commitStylePatch, FieldTrailer } from "./field-primitives";
import { SectionIconButton } from "./inspector-controls";
import { ColorInput, PanelSection } from "./panel-primitives";
import {
  cssColorOrFallback,
  cssLengthNumber,
  outlineOffsetForPosition,
  readStrokeOutlinePosition,
  readTextStrokeStyle,
  resolveTextStrokeColor,
  roundToOneDecimal,
  strokeHiddenByColor,
  strokeIsVisible,
  textStrokeIsVisible,
} from "./position-helpers";
import { isMixedValue } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";
import { STROKE_POSITION_OPTIONS } from "./style-options";

/**
 * Paint types allowed for CSS properties with no clean gradient/image
 * equivalent — currently strokes (`border`/`outline`), which are plain CSS
 * colors with no `border-image`/layered-background trickery clean enough to
 * support here. Passed as `supportedPaintTypes` so the picker never shows a
 * tab that would silently discard its write.
 */
const SOLID_ONLY_PAINT_TYPES: DesignPaintType[] = ["solid"];

type StrokeLayerKind = "border" | "outline";
type StrokePosition = "inside" | "outside" | "center";

function StrokeLayerControl({
  kind,
  visible,
  color,
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
  width: string;
  styleValue: string;
  /** Only meaningful when `kind === "outline"` — distinguishes outside vs
   * center (see readStrokeOutlinePosition). Ignored for `kind === "border"`. */
  outlineOffset?: string;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onRemove: () => void;
  /**
   * Optional — only needed for the keyframe diamond / breakpoint override
   * indicator. The motion catalog only tracks `border-color`/`border-width`
   * (not `outline-color`/`outline-width`), so both affordances only ever
   * render for `kind === "border"` regardless of whether these are passed.
   */
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
      // Outline → outline (outside ⇄ center): no property-family change,
      // just re-point outline-offset. Single commit, no remove/re-add.
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
      // Preserve the original border-style so a hidden stroke (style:none,
      // kept visible as a row because width>0) stays hidden when its
      // position moves. Only default to solid when there's no style at all.
      [`${nextPrefix}Style`]: styleValue || "solid",
    };
    if (nextPrefix === "outline") {
      patch.outlineOffset = outlineOffsetForPosition(
        nextPosition === "center" ? "center" : "outside",
        width || "1px",
      );
    }
    // Clear the property family we're moving away from in the SAME commit
    // (rather than a separate onRemove() call afterwards) so the position
    // switch lands as one history step instead of two.
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
    <div className="space-y-1.5">
      {/* design stroke row: [swatch+hex trigger (flex-1)] [eye] [remove] */}
      <div className="group flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ColorInput
            label=""
            value={cssColorOrFallback(color, "#000000")}
            onChange={(value, meta) =>
              onStyleChange(`${prefix}Color`, value, meta)
            }
            supportedPaintTypes={SOLID_ONLY_PAINT_TYPES}
          />
        </div>
        <SectionIconButton
          label={
            visible
              ? t("editPanel.labels.hideLayer")
              : t("editPanel.labels.showLayer")
          }
          onClick={() => {
            // Hide/show by zeroing the stroke color's alpha (preserving its
            // RGB channels — same durable, comment-free technique as the
            // fill visibility toggle) instead of forcing borderStyle to
            // "none"/"solid". Writing "none" would lose a dashed/dotted
            // style permanently, since there is no round-trippable "unset"
            // for that keyword once it's overwritten.
            const parsed = parseCssColor(color);
            if (visible) {
              onStyleChange(
                `${prefix}Color`,
                parsed ? rgbaToCss(withColorOpacity(parsed, 0)) : "transparent",
              );
              return;
            }
            const restoredColor = parsed
              ? rgbaToCss(withColorOpacity(parsed, 100))
              : "#000000";
            onStyleChange(`${prefix}Color`, restoredColor);
            if (styleValue === "none") onStyleChange(`${prefix}Style`, "solid");
            onStyleChange(
              `${prefix}Width`,
              width === "0px" ? "1px" : width || "1px",
            );
          }}
        >
          {visible ? (
            <IconEye className="size-3.5" />
          ) : (
            <IconEyeOff className="size-3.5" />
          )}
        </SectionIconButton>
        <SectionIconButton
          label={t("editPanel.labels.removeLayer")}
          onClick={onRemove}
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
        {kind === "border" && element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="border-color"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
        ) : null}
      </div>
      {/* design stroke geometry: position + weight side by side */}
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={position} onValueChange={movePosition}>
          <SelectTrigger className="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
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
        <div className="group/field relative min-w-0">
          <ScrubInput
            label={t("editPanel.labels.weight")}
            ariaLabel={t("editPanel.labels.weight")}
            icon={IconBorderStyle}
            value={cssLengthNumber(width)}
            onChange={(value, meta) => {
              const nextWidth = `${Math.max(0, roundToOneDecimal(value))}px`;
              // A centered outline's offset is derived from its own width
              // (-width/2) — re-derive it in the same commit so the stroke
              // stays centered as its weight changes, instead of drifting
              // toward "outside" as a stale offset.
              if (kind === "outline" && position === "center") {
                const patch = {
                  outlineWidth: nextWidth,
                  outlineOffset: outlineOffsetForPosition("center", nextWidth),
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
            className="gap-0"
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
  // R94 fix — Figma semantics: a text node's "Stroke" is the glyph outline
  // (-webkit-text-stroke), never a box border. Route text nodes to their own
  // control entirely so the border/outline logic below (and its `styles.color`
  // fallback, which used to leak the removed fill color into the stroke) never
  // runs for text at all.
  if (isTextElement(element)) {
    return (
      <TextStrokeProperties
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
      />
    );
  }
  // Visible requires: real width, style not "none" (legacy hide path), and
  // color not zero-alpha (current hide path — see strokeHiddenByColor).
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
  // Render the row whenever a stroke has been configured (non-zero width),
  // even when its style is "none" (hidden). This mirrors Figma's behavior where
  // hidden stroke rows remain present so the user can re-show them via the eye icon.
  const borderExists = cssLengthNumber(styles.borderWidth) > 0;
  const outlineExists = cssLengthNumber(styles.outlineWidth) > 0;
  // Same empty-wrapper hazard as EffectsProperties: border and outline are
  // separate top-level sibling conditionals, so when neither exists (and the
  // mixed-value hint isn't showing either) JSX would still hand PanelSection
  // a truthy array of `null`s as `children`, rendering an empty spacer div
  // under the header instead of staying collapsed like Fill's empty state.
  const hasStrokeContent = strokeIsMixed || borderExists || outlineExists;

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addLayer")}
          onClick={() => {
            if (strokeIsMixed) {
              commitStylePatch(
                {
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: "#000000",
                  outlineWidth: "0px",
                  outlineStyle: "none",
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            if (!borderVisible) {
              // Restore full alpha before falling back to cssColorOrFallback
              // — a border previously hidden via the eye toggle (zero-alpha,
              // real RGB preserved) is not "transparent" by that helper's
              // narrow literal check, so without this an "Add" click here
              // could silently re-add an invisible border.
              const existingBorderColor = styles.borderColor || styles.color;
              const existingParsed = parseCssColor(existingBorderColor || "");
              const borderColor = cssColorOrFallback(
                existingParsed
                  ? rgbaToCss(withColorOpacity(existingParsed, 100))
                  : existingBorderColor,
                "#000000",
              );
              commitStylePatch(
                {
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor,
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            if (outlineVisible) {
              const outlineWidth = `${
                Math.max(1, cssLengthNumber(styles.outlineWidth, 1)) + 1
              }px`;
              const outlineStyle =
                styles.outlineStyle === "none"
                  ? "solid"
                  : styles.outlineStyle || "solid";
              const outlineColor = cssColorOrFallback(
                styles.outlineColor || styles.borderColor,
                "#000000",
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
                outlineColor: cssColorOrFallback(styles.borderColor, "#000000"),
                outlineOffset: "0px",
              },
              onStyleChange,
              onStylesChange,
            );
          }}
        >
          <IconPlus className="size-3.5" />
        </SectionIconButton>
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
              visible={borderVisible}
              color={styles.borderColor || "#000000"}
              width={styles.borderWidth || "0px"}
              styleValue={styles.borderStyle || "none"}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
              onRemove={() => {
                if (onStylesChange) {
                  onStylesChange({ borderWidth: "0px", borderStyle: "none" });
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
              color={styles.outlineColor || styles.borderColor || "#000000"}
              width={styles.outlineWidth || "0px"}
              styleValue={styles.outlineStyle || "solid"}
              outlineOffset={styles.outlineOffset || "0px"}
              onStyleChange={onStyleChange}
              onStylesChange={onStylesChange}
              onRemove={() => {
                if (onStylesChange) {
                  onStylesChange({ outlineWidth: "0px", outlineStyle: "none" });
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

/**
 * R94 fix — text "Stroke" section: a real glyph outline via
 * `-webkit-text-stroke-width` / `-webkit-text-stroke-color`, independent of
 * fill (`color`). Removing the fill (FillProperties zeroing `color`'s alpha)
 * must never hide the glyphs when a stroke is set, and must never coerce the
 * stroke to black by reading `styles.color` — both bugs the box-border-based
 * StrokeProperties path had for text. `-webkit-text-stroke` paints centered
 * on the glyph edge (CSS has no outside/center/inside position control for
 * it, unlike border/outline), so there is no position selector here.
 */
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
  // R94 fix — read through readTextStrokeStyle rather than the longhand
  // keys directly: right after a reload/reselect the panel's computedStyles
  // may only carry the browser-serialized `-webkit-text-stroke` shorthand
  // (see readTextStrokeStyle's doc comment), not the two longhands a live
  // DOM selection reports. Reading the longhands directly here would make
  // the section falsely show "no stroke" for a stroke that is persisted and
  // rendering.
  const { width, color } = readTextStrokeStyle(styles);
  const isMixed = [
    styles.webkitTextStrokeWidth,
    styles.webkitTextStrokeColor,
    styles["-webkit-text-stroke"],
    styles.WebkitTextStroke,
  ].some(isMixedValue);
  const strokeExists = cssLengthNumber(width) > 0;
  const visible = textStrokeIsVisible(width, color);

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addLayer")}
          onClick={() => {
            commitStylePatch(
              {
                webkitTextStrokeWidth: "1px",
                webkitTextStrokeColor: resolveTextStrokeColor(color),
              },
              onStyleChange,
              onStylesChange,
            );
          }}
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
        <div className="space-y-1.5">
          <div className="group flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <ColorInput
                label=""
                value={resolveTextStrokeColor(color)}
                onChange={(value, meta) =>
                  onStyleChange("-webkit-text-stroke-color", value, meta)
                }
                supportedPaintTypes={SOLID_ONLY_PAINT_TYPES}
              />
            </div>
            <SectionIconButton
              label={
                visible
                  ? t("editPanel.labels.hideLayer")
                  : t("editPanel.labels.showLayer")
              }
              onClick={() => {
                // Same durable, comment-free hide technique as border/outline
                // and fill: zero the stroke color's alpha (preserving its RGB
                // channels) instead of zeroing width, so re-showing restores
                // the exact same color rather than defaulting back to black.
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
                  : "#000000";
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
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <span aria-hidden="true" />
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
              className="gap-0"
              labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] [&>span]:hidden"
              inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            />
          </div>
        </div>
      ) : null}
    </PanelSection>
  );
}
