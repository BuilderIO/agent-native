import { useT } from "@agent-native/core/client";
import {
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  withColorOpacity,
} from "@shared/color-utils";
import {
  IconEye,
  IconEyeOff,
  IconLayoutGrid,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { DesignColorPicker, imageFillToBackgroundStyles } from "../inspector";
import type { GlslShaderPanelContext } from "../inspector/GlslShaderPanel";
import type { ElementInfo } from "../types";
import { selectionColorValues } from "./document-colors";
import { isTextElement } from "./element-classification";
import { elementStableKey } from "./element-identity";
import { commitStylePatch, FieldTrailer } from "./field-primitives";
import {
  addFillLayerPatch,
  averageGradientOpacity,
  buildGradientLayer,
  gradientLabel,
  isLayerHiddenBySize,
  joinCssLayers,
  parseGradientLayer,
  removeBaseFillPatch,
  removeFillLayerAtIndex,
  setImageFillLayerPatch,
  splitCssLayers,
  withLayerSizeMarker,
} from "./fill-gradient-helpers";
import {
  RowDragHandle,
  SectionIconButton,
  useRowDragReorder,
} from "./inspector-controls";
import { ColorInput, PanelSection } from "./panel-primitives";
import {
  colorHasVisibleAlpha,
  cssColorOrFallback,
  swatchStyle,
} from "./position-helpers";
import { isMixedValue } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";

/**
 * The four `backgroundImage`/`backgroundSize`/`backgroundRepeat`/
 * `backgroundPosition` prop values fed to the base fill row's `<ColorInput>`.
 * Text fills ("color") can't hold a layered paint at all, so every value
 * collapses to "" for them.
 *
 * Factored out (rather than inlined ternaries in the JSX below) as a
 * regression guard: `ColorInput.onImageFillLayerChange` builds its commit
 * patch from whatever it computes internally from these four props (see
 * `imageFillChangePatch` in fill-gradient-helpers.ts). Previously only
 * `backgroundImage` was passed here, so ColorInput treated every sibling
 * layer as having no size/repeat/position of its own — switching this base
 * swatch to Image then rebuilt backgroundSize/backgroundRepeat/
 * backgroundPosition as a single-entry list against the real N+1-layer
 * backgroundImage stack, corrupting every existing layer's size/repeat/
 * position via CSS background-layer-list cycling (e.g. an existing "cover"
 * silently became "auto"). All four must always be sourced together, exactly
 * like PageProperties' background row in EditPanel.tsx.
 */
export function baseFillLayerSourceProps(
  styles: Record<string, string>,
  isTextFillElement: boolean,
): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
} {
  if (isTextFillElement) {
    return {
      backgroundImage: "",
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    };
  }
  return {
    backgroundImage: styles.backgroundImage || "",
    backgroundSize: styles.backgroundSize || "",
    backgroundRepeat: styles.backgroundRepeat || "",
    backgroundPosition: styles.backgroundPosition || "",
  };
}

export function FillProperties({
  element,
  onStyleChange,
  onStylesChange,
  documentColorPalette = [],
  glslShaderContext,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  /** Document-wide palette (see `extractDocumentColorPalette`), already
   * capped/ordered by frequency. Merged with the current selection's own
   * colors below so a real, always-populated "Document colors" row is
   * available even before any file content has been scanned. */
  documentColorPalette?: string[];
  /**
   * Persistence context for the code-backed Shader paint type (GLSL source
   * saved into the screen HTML). Threaded into the fill picker so its
   * Shader tab opens the GlslShaderPanel.
   */
  glslShaderContext?: GlslShaderPanelContext;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const isTextFillElement = isTextElement(element);
  const fillProperty = isTextFillElement ? "color" : "backgroundColor";
  // Stash for a hidden layer's real pre-hide backgroundSize (e.g. a custom
  // cover/contain/percentage) so re-showing it restores that value instead
  // of permanently discarding it for "auto" — the same React-state stash
  // pattern effects-properties.tsx uses for hidden shadow/blur effects (see
  // `hiddenEffectStash` there), keyed by element + layer index so unrelated
  // elements/layers never collide.
  const [hiddenFillSizeStash, setHiddenFillSizeStash] = useState<
    Record<string, string>
  >({});
  const fillStashKey = elementStableKey(element);
  const fillValue = isTextFillElement
    ? styles.color || ""
    : styles.backgroundColor || "";
  const backgroundLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundImage || "");
  const backgroundSizeLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundSize || "");
  const backgroundRepeatLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundRepeat || "");
  const backgroundPositionLayers = isTextFillElement
    ? []
    : splitCssLayers(styles.backgroundPosition || "");
  const baseFillLayerProps = baseFillLayerSourceProps(
    styles,
    isTextFillElement,
  );
  const fillIsMixed =
    isMixedValue(fillValue) ||
    isMixedValue(styles.backgroundImage) ||
    isMixedValue(styles.backgroundSize) ||
    isMixedValue(styles.backgroundRepeat) ||
    isMixedValue(styles.backgroundPosition);
  const hasBackgroundLayer = !isTextFillElement && backgroundLayers.length > 0;
  const hasVisibleFill =
    isTextFillElement || colorHasVisibleAlpha(fillValue) || hasBackgroundLayer;

  // Non-destructive fill hide: instead of stashing the pre-hide color in
  // React state (lost on unmount — e.g. deselect then reselect the same
  // element, since FillProperties only mounts while something is selected),
  // zero the alpha channel while preserving the RGB channels in the
  // persisted CSS itself: rgba(r,g,b,0) renders identically to fully
  // transparent, but getComputedStyle round-trips the r/g/b losslessly (CSS
  // color-list channels are real data, unlike comments — verified
  // separately: computed style strips comments but keeps rgba() channels).
  // Showing again just restores alpha to 1 using those same channels, so no
  // stash is required and the hide survives reselect/reload.
  const isHidden = !colorHasVisibleAlpha(fillValue);
  const handleFillVisibilityToggle = () => {
    const parsed = parseCssColor(fillValue);
    if (isHidden) {
      const restored = parsed
        ? rgbaToCss(withColorOpacity(parsed, 100))
        : isTextFillElement
          ? "#000000"
          : "#ffffff";
      onStyleChange(fillProperty, restored);
    } else if (parsed) {
      onStyleChange(fillProperty, rgbaToCss(withColorOpacity(parsed, 0)));
    } else {
      // Value wasn't a parseable color (e.g. already the literal
      // "transparent") — nothing to preserve, transparent is the best we
      // can do.
      onStyleChange(fillProperty, "transparent");
    }
  };

  // Reorder fill layers by dragging: permute all four index-aligned parallel
  // arrays (image/size/repeat/position) together and commit them as one patch
  // so stacking order changes in a single history step. Prefer onStylesChange
  // (single call) when available; otherwise fall back to four sequential
  // onStyleChange calls, matching the commit-path convention used elsewhere
  // in this component (see commitStylePatch).
  const reorderFillLayers = (from: number, to: number) => {
    const reorder = (layers: string[]) => {
      const next = [...layers];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return layers;
      next.splice(to, 0, moved);
      return next;
    };
    const patch = {
      backgroundImage: joinCssLayers(reorder(backgroundLayers)),
      backgroundSize: joinCssLayers(reorder(backgroundSizeLayers)),
      backgroundRepeat: joinCssLayers(reorder(backgroundRepeatLayers)),
      backgroundPosition: joinCssLayers(reorder(backgroundPositionLayers)),
    };
    if (onStylesChange) {
      onStylesChange(patch);
      return;
    }
    Object.entries(patch).forEach(([property, value]) =>
      onStyleChange(property, value),
    );
  };
  const fillDrag = useRowDragReorder(
    backgroundLayers.length,
    reorderFillLayers,
  );

  // Document colors: the selected element's own colors lead the row (so the
  // colors most relevant to what's currently selected are immediately
  // visible), followed by the real document-wide palette collected across
  // every file in the design (see `extractDocumentColorPalette` /
  // `documentColorPalette`, computed once in EditPanel and passed down —
  // this is the actual "every distinct color used in the file" behavior;
  // previously this row only ever showed the 4 lines below, mislabeled as
  // document colors).
  const selectionHexes = selectionColorValues(element)
    .map((c) => {
      const parsed = parseCssColor(c.value);
      return parsed ? rgbaToHex(parsed) : null;
    })
    .filter((h): h is string => Boolean(h));
  // Deduplicate (selectionColorValues already dedupes by raw CSS value, but
  // hex normalisation may collapse additional entries e.g. rgb vs #hex; the
  // document-wide palette is also normalized/deduped on its own, but may
  // still repeat one of the selection's own colors).
  const seenHex = new Set<string>();
  const documentColors = [...selectionHexes, ...documentColorPalette].filter(
    (h) => {
      const key = h.toUpperCase();
      if (seenHex.has(key)) return false;
      seenHex.add(key);
      return true;
    },
  );

  return (
    <PanelSection
      title={t("editPanel.sections.fill")}
      actions={
        <>
          {/* design color-styles affordance (grid icon) to the left of "+".
              Not yet implemented — disabled with a "Coming soon" tooltip
              rather than a dead, silently-no-op click. */}
          <SectionIconButton
            label={t("editPanel.labels.stylesComingSoon")}
            disabled
          >
            <IconLayoutGrid className="size-3.5" />
          </SectionIconButton>
          <SectionIconButton
            label={t("editPanel.labels.addLayer")}
            onClick={() => {
              if (fillIsMixed) {
                commitStylePatch(
                  {
                    color: "#000000",
                    backgroundColor: "#ffffff",
                    backgroundImage: "none",
                  },
                  onStyleChange,
                  onStylesChange,
                );
                return;
              }
              if (isTextFillElement) {
                onStyleChange(
                  "color",
                  cssColorOrFallback(styles.color, "#000000"),
                );
                return;
              }
              commitStylePatch(
                addFillLayerPatch({
                  backgroundColor: styles.backgroundColor,
                  backgroundLayers,
                  backgroundSizeLayers,
                  backgroundRepeatLayers,
                  backgroundPositionLayers,
                }),
                onStyleChange,
                onStylesChange,
              );
            }}
          >
            <IconPlus className="size-3.5" />
          </SectionIconButton>
        </>
      }
    >
      {fillIsMixed ? (
        <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
          {
            "Click + to replace mixed content" /* i18n-ignore figma mixed fill hint */
          }
        </p>
      ) : hasVisibleFill ? (
        <div className="space-y-1.5">
          {isTextFillElement || colorHasVisibleAlpha(fillValue) ? (
            /* design row: [swatch+hex trigger (flex-1)] [eye] [remove] */
            <div className="group flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorInput
                  label=""
                  value={fillValue}
                  onChange={(v, meta) => onStyleChange(fillProperty, v, meta)}
                  // Pass the real layer stack (not "") so that switching this
                  // swatch's paint type to gradient/image composes a new
                  // layer on top of any existing backgroundImage layers
                  // (rendered as their own rows below) instead of clobbering
                  // them — ColorInput derives its add/replace-layer logic
                  // from this prop. The size/repeat/position siblings must
                  // come along too (same as PageProperties' background row in
                  // EditPanel.tsx) — see `baseFillLayerSourceProps` above for
                  // why all four are sourced together.
                  {...baseFillLayerProps}
                  blendMode={
                    isTextFillElement
                      ? undefined
                      : styles.backgroundBlendMode || "normal"
                  }
                  onBlendModeChange={
                    isTextFillElement
                      ? undefined
                      : (v) => onStyleChange("backgroundBlendMode", v)
                  }
                  // Text fill ("color") can't hold a gradient/image paint —
                  // there is no background-clip:text support here — so never
                  // offer layered fills for it; the picker's Gradient/Image
                  // tabs remain reachable as raw UI (it manages that tab
                  // selection as local state independent of these props) but
                  // ColorInput's setNext guard rejects non-color writes back
                  // into `color` when supportsLayeredFills is false. For any
                  // other element the base fill is a real backgroundImage
                  // layer stack, so wire the same layered-fill handlers the
                  // page background row uses (see PageProperties above).
                  supportsLayeredFills={!isTextFillElement}
                  onBackgroundImageChange={
                    isTextFillElement
                      ? undefined
                      : (v) => onStyleChange("backgroundImage", v)
                  }
                  // Layer-index-aware: ColorInput merges the edited image
                  // into the correct backgroundImage/backgroundSize/
                  // backgroundRepeat/backgroundPosition index and hands back
                  // the full four-property patch here, already preserving
                  // every other stacked gradient/image layer (see
                  // `imageFillChangePatch`) — commit it as-is instead of
                  // rebuilding a single-layer patch that would silently wipe
                  // those siblings.
                  onImageFillLayerChange={
                    isTextFillElement
                      ? undefined
                      : (patch) =>
                          commitStylePatch(patch, onStyleChange, onStylesChange)
                  }
                  documentColors={documentColors}
                  pickerKey={[
                    element.sourceId ??
                      element.id ??
                      element.selector ??
                      element.tagName,
                    fillProperty,
                  ].join(":")}
                  // Code-backed GLSL Shader paint type — text fills can't
                  // host a shader canvas, so only container fills get it.
                  glslShaderContext={
                    isTextFillElement ? undefined : glslShaderContext
                  }
                />
              </div>
              <SectionIconButton
                label={
                  isHidden
                    ? t("editPanel.labels.showLayer")
                    : t("editPanel.labels.hideLayer")
                }
                onClick={handleFillVisibilityToggle}
                activateOnPointerDown
              >
                {isHidden ? (
                  <IconEyeOff className="size-3.5" />
                ) : (
                  <IconEye className="size-3.5" />
                )}
              </SectionIconButton>
              <SectionIconButton
                label={t("editPanel.labels.removeLayer")}
                onClick={() =>
                  commitStylePatch(
                    removeBaseFillPatch(fillProperty),
                    onStyleChange,
                    onStylesChange,
                  )
                }
              >
                <IconMinus className="size-3.5" />
              </SectionIconButton>
              {!isTextFillElement ? (
                <FieldTrailer
                  element={element}
                  motionCssProperty="background-color"
                  motionKeyframeContext={motionKeyframeContext}
                  breakpointOverrideContext={breakpointOverrideContext}
                  hoverRevealClassName="opacity-0 group-hover:opacity-100"
                />
              ) : null}
            </div>
          ) : null}
          {!isTextFillElement
            ? backgroundLayers.map((layer, index) => {
                const gradient = parseGradientLayer(layer);
                // Hidden state itself lives in the real, persisted
                // backgroundSize marker (see withLayerSizeMarker) rather than
                // React state, so it survives deselect/reselect. Opacity
                // still reflects the gradient's own stop opacities for
                // display, but no longer drives hide/show — a layer can be a
                // fully-opaque gradient and still be hidden via zero-size.
                // The layer's *original* size (a custom cover/contain/
                // percentage) can't be recovered from the marker itself once
                // overwritten, so it's separately stashed in component state
                // for the round trip (see hiddenFillSizeStash below) —
                // same pattern as effects-properties.tsx's hiddenEffectStash
                // for hidden shadow/blur effects.
                const hidden = isLayerHiddenBySize(backgroundSizeLayers[index]);
                const opacity = gradient
                  ? averageGradientOpacity(gradient.stops)
                  : 100;
                const label = gradient
                  ? `${gradientLabel(gradient.type)} ${index + 1}`
                  : `${"Image" /* i18n-ignore design inspector paint row */} ${
                      index + 1
                    }`;
                const replaceLayer = (nextLayer: string) => {
                  const nextLayers = [...backgroundLayers];
                  nextLayers[index] = nextLayer;
                  onStyleChange("backgroundImage", joinCssLayers(nextLayers));
                };
                // Remove one fill layer by index. Mirrors reorderFillLayers:
                // all four index-aligned parallel arrays (image/size/repeat/
                // position) must be spliced together and committed as one
                // patch (see removeFillLayerAtIndex), or the arrays fall out
                // of alignment for every layer after the removed index (each
                // remaining layer's size ends up paired with the next
                // layer's repeat/position). The previous version only
                // filtered backgroundImage and backgroundSize, silently
                // leaving backgroundRepeat and backgroundPosition
                // unfiltered/misaligned.
                const removeLayer = () => {
                  const patch = removeFillLayerAtIndex(
                    {
                      backgroundImage: backgroundLayers,
                      backgroundSize: backgroundSizeLayers,
                      backgroundRepeat: backgroundRepeatLayers,
                      backgroundPosition: backgroundPositionLayers,
                    },
                    index,
                  );
                  if (onStylesChange) {
                    onStylesChange(patch);
                    return;
                  }
                  Object.entries(patch).forEach(([property, value]) =>
                    onStyleChange(property, value),
                  );
                };
                const sizeStashKey = `${fillStashKey}:fill-size:${index}`;
                const setLayerHidden = (nextHidden: boolean) => {
                  if (nextHidden) {
                    // Stash the real pre-hide size (a custom cover/contain/
                    // percentage — see withLayerSizeMarker) so re-showing
                    // can restore it instead of permanently discarding it
                    // for "auto". Skip stashing if the layer is somehow
                    // already hidden (nothing real to preserve).
                    const current = backgroundSizeLayers[index];
                    if (current && !isLayerHiddenBySize(current)) {
                      setHiddenFillSizeStash((prev) => ({
                        ...prev,
                        [sizeStashKey]: current,
                      }));
                    }
                    onStyleChange(
                      "backgroundSize",
                      withLayerSizeMarker(
                        backgroundSizeLayers,
                        backgroundLayers.length,
                        index,
                        true,
                      ),
                    );
                    return;
                  }

                  const restored = hiddenFillSizeStash[sizeStashKey];
                  setHiddenFillSizeStash((prev) => {
                    const next = { ...prev };
                    delete next[sizeStashKey];
                    return next;
                  });
                  onStyleChange(
                    "backgroundSize",
                    withLayerSizeMarker(
                      backgroundSizeLayers,
                      backgroundLayers.length,
                      index,
                      false,
                      restored,
                    ),
                  );
                };

                return (
                  /* design row: [grip] [swatch+label+opacity% trigger (flex-1)] [eye] [remove] */
                  <div
                    key={`${layer}-${index}`}
                    className="group relative flex items-center gap-1.5"
                    {...fillDrag.getRowProps(index)}
                  >
                    <RowDragHandle
                      label={t("editPanel.labels.reorderLayer")}
                      dropIndicator={
                        fillDrag.dragIndex != null &&
                        fillDrag.overIndex === index
                          ? fillDrag.overIndex > fillDrag.dragIndex
                            ? "after"
                            : "before"
                          : null
                      }
                      {...fillDrag.getHandleProps(index)}
                    />
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                        >
                          <span
                            className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
                            style={swatchStyle(layer)}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {label}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {hidden ? 0 : opacity}%
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="left"
                        align="start"
                        sideOffset={8}
                        className="w-80 p-0"
                      >
                        <DesignColorPicker
                          value={layer}
                          onPaintValueChange={replaceLayer}
                          onChange={(nextColor) => {
                            if (!gradient) return;
                            const firstStop = gradient.stops[0];
                            if (!firstStop) return;
                            replaceLayer(
                              buildGradientLayer(
                                gradient.type,
                                [
                                  { ...firstStop, color: nextColor },
                                  ...gradient.stops.slice(1),
                                ],
                                gradient.prefix,
                              ),
                            );
                          }}
                          // Editing an existing image layer's URL/fit
                          // through its own row popover previously had no
                          // `onImageFillChange` wired at all, so it fell
                          // through to `emitPaintValue(imageFillToCss(...))`
                          // — a single-property `background` SHORTHAND
                          // string (e.g. `url(...) center / cover no-repeat`)
                          // written into `backgroundImage` alone, which is
                          // invalid CSS for that longhand and left
                          // backgroundSize/backgroundRepeat/backgroundPosition
                          // untouched. Merge into this layer's own index
                          // across all four parallel arrays instead (same
                          // helper the base-row fix uses — see
                          // `imageFillChangePatch` in panel-primitives.tsx).
                          onImageFillChange={(value) =>
                            commitStylePatch(
                              setImageFillLayerPatch(
                                {
                                  backgroundImage: backgroundLayers,
                                  backgroundSize: backgroundSizeLayers,
                                  backgroundRepeat: backgroundRepeatLayers,
                                  backgroundPosition: backgroundPositionLayers,
                                },
                                index,
                                imageFillToBackgroundStyles(value),
                              ),
                              onStyleChange,
                              onStylesChange,
                            )
                          }
                          paintType={gradient?.type ?? "image"}
                          backgroundImage={layer}
                          backgroundSize={backgroundSizeLayers[index]}
                          backgroundRepeat={backgroundRepeatLayers[index]}
                          backgroundPosition={backgroundPositionLayers[index]}
                          gradientType={gradient?.type}
                          onGradientTypeChange={(type) => {
                            if (!gradient) return;
                            replaceLayer(
                              buildGradientLayer(type, gradient.stops),
                            );
                          }}
                          fillRows={[
                            {
                              id: `layer-${index}`,
                              label,
                              value: layer,
                              type: gradient ? "gradient" : "image",
                              selected: true,
                              swatch: layer,
                            },
                          ]}
                          selectedFillId={`layer-${index}`}
                        />
                      </PopoverContent>
                    </Popover>
                    <SectionIconButton
                      label={
                        hidden
                          ? t("editPanel.labels.showLayer")
                          : t("editPanel.labels.hideLayer")
                      }
                      onClick={() => setLayerHidden(!hidden)}
                      activateOnPointerDown
                    >
                      {hidden ? (
                        <IconEyeOff className="size-3.5" />
                      ) : (
                        <IconEye className="size-3.5" />
                      )}
                    </SectionIconButton>
                    <SectionIconButton
                      label={t("editPanel.labels.removeLayer")}
                      onClick={removeLayer}
                    >
                      <IconMinus className="size-3.5" />
                    </SectionIconButton>
                  </div>
                );
              })
            : null}
        </div>
      ) : null}
    </PanelSection>
  );
}
