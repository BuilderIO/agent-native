import { useT } from "@agent-native/core/client/i18n";
import {
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  withColorOpacity,
} from "@shared/color-utils";
import {
  gradientStopWithFillOpacity,
  readGradientFillOpacity,
} from "@shared/gradient-opacity";
import {
  IconEye,
  IconEyeOff,
  IconLayoutGrid,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_SHAPE_FILL } from "../canvas-primitive-style";
import {
  DesignColorPicker,
  ScrubInput,
  imageFillToBackgroundStyles,
  type DesignPaintType,
} from "../inspector";
import type { GlslShaderPanelContext } from "../inspector/GlslShaderPanel";
import type { ElementInfo } from "../types";
import { selectionColorValues } from "./document-colors";
import { isTextElement, isVectorShapeElement } from "./element-classification";
import { elementStableKey } from "./element-identity";
import { commitStylePatch, FieldTrailer } from "./field-primitives";
import {
  alignCssLayerValues,
  addFillLayerPatch,
  buildSolidFillLayer,
  buildGradientLayer,
  gradientLabel,
  isLayerHiddenBySize,
  joinCssLayers,
  parseGradientLayer,
  parseSolidFillLayer,
  reorderFillLayerArrays,
  removeBaseFillPatch,
  removeFillLayerAtIndex,
  setImageFillLayerPatch,
  splitCssLayers,
  withLayerSizeMarker,
} from "./fill-gradient-helpers";
import { ImageElementFill } from "./image-element-fill";
import {
  RowDragHandle,
  SectionIconButton,
  useRowDragReorder,
} from "./inspector-controls";
import { InspectorGridCell, InspectorPaintRow } from "./inspector-grid";
import { authoredStyleValue } from "./interaction-state-helpers";
import { ColorInput, PanelSection } from "./panel-primitives";
import {
  colorHasVisibleAlpha,
  cssColorOrFallback,
  swatchStyle,
} from "./position-helpers";
import { isMixedValue } from "./selection-helpers";
import type { CapturedStyleTarget } from "./style-change-types";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";

const TEXT_GRADIENT_PAINT_TYPES: DesignPaintType[] = [
  "linear",
  "radial",
  "angular",
  "diamond",
];

const TEXT_BASE_PAINT_TYPES: DesignPaintType[] = [
  "solid",
  ...TEXT_GRADIENT_PAINT_TYPES,
];

const EXISTING_LAYER_PAINT_TYPES: DesignPaintType[] = [
  "solid",
  "none",
  "linear",
  "radial",
  "angular",
  "diamond",
  "image",
  "video",
  "shader",
  "noise",
  "pattern",
];

// Stable identity for a fill-layer row's own DesignColorPicker, independent
// of both the layer's position (which shifts under a preceding row's
// reorder/removal) and its CSS content (rewritten by every edit, including a
// paint-type switch). See the layerKeysRef sync below.
let layerKeyCounter = 0;
function nextLayerKey(): string {
  layerKeyCounter += 1;
  return `fill-layer-${layerKeyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The four `backgroundImage`/`backgroundSize`/`backgroundRepeat`/
 * `backgroundPosition` prop values fed to the base fill row's `<ColorInput>`.
 * SVG shape fills use `fill` instead of the CSS background stack; text can
 * use gradients clipped to its glyphs.
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
  isVectorFillElement: boolean,
): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
} {
  if (isVectorFillElement) {
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

export function shouldUseTextFill(
  element: ElementInfo,
  styles: Record<string, string>,
): boolean {
  const backgroundImageLayers = splitCssLayers(styles.backgroundImage || "");
  const backgroundClipLayers = splitCssLayers(styles.backgroundClip || "");
  const hasVisibleBackgroundColor =
    !isMixedValue(styles.backgroundColor) &&
    colorHasVisibleAlpha(styles.backgroundColor);
  const hasVisibleBoxBackgroundImage = backgroundImageLayers.some(
    (layer, index) => {
      const normalizedLayer = layer.trim().toLowerCase();
      if (isMixedValue(layer) || !normalizedLayer || normalizedLayer === "none")
        return false;
      // CSS repeats the shorter comma-list to align the properties by layer.
      const clip =
        backgroundClipLayers.length > 0
          ? backgroundClipLayers[index % backgroundClipLayers.length]
          : undefined;
      return clip?.trim().toLowerCase() !== "text";
    },
  );
  const hasTextBackgroundClip = backgroundClipLayers.some(
    (clip) => clip.trim().toLowerCase() === "text",
  );
  return (
    isTextElement(element) &&
    !hasVisibleBoxBackgroundImage &&
    (hasTextBackgroundClip || !hasVisibleBackgroundColor)
  );
}

export function FillProperties({
  element,
  onStyleChange,
  onStylesChange,
  documentColorPalette = [],
  glslShaderContext,
  motionKeyframeContext,
  breakpointOverrideContext,
  hideAddFill = false,
  cancelOpacityGestureOnHistoryUndo = false,
  onAddFill,
  capturedStyleTargets,
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
  hideAddFill?: boolean;
  cancelOpacityGestureOnHistoryUndo?: boolean;
  onAddFill?: () => "base" | "layer" | null;
  capturedStyleTargets?: CapturedStyleTarget[];
}) {
  const t = useT();
  const commitImageFillPatch = (
    patch: Record<string, string>,
    meta?: Parameters<StyleChangeHandler>[2],
  ) =>
    commitStylePatch(
      patch,
      onStyleChange,
      onStylesChange,
      capturedStyleTargets ? { ...meta, capturedStyleTargets } : meta,
    );
  const styles: Record<string, string> = {
    ...element.computedStyles,
    backgroundImage: authoredStyleValue(element, "backgroundImage") ?? "",
  };
  // A DOM control can own text and a real box fill at once. Keep Typography
  // on the selection, but let Fill edit the visible background paint.
  const isTextFillElement = shouldUseTextFill(element, styles);
  const isVectorFillElement = isVectorShapeElement(element);
  const fillProperty = isTextFillElement
    ? "color"
    : isVectorFillElement
      ? "fill"
      : "backgroundColor";
  // Stash for a hidden layer's real pre-hide backgroundSize (e.g. a custom
  // cover/contain/percentage) so re-showing it restores that value instead
  // of permanently discarding it for "auto" — the same React-state stash
  // pattern effects-properties.tsx uses for hidden shadow/blur effects (see
  // `hiddenEffectStash` there), keyed by element + layer index so unrelated
  // elements/layers never collide.
  const [hiddenFillSizeStash, setHiddenFillSizeStash] = useState<
    Record<string, string>
  >({});
  const [openFillPickerKey, setOpenFillPickerKey] = useState<string | null>(
    null,
  );
  const fillStashKey = elementStableKey(element);
  const gradientBeforeSolidRef = useRef<{
    elementKey: string;
    byLayerKey: Map<string, string>;
  }>({ elementKey: fillStashKey, byLayerKey: new Map() });
  useEffect(() => {
    gradientBeforeSolidRef.current = {
      elementKey: fillStashKey,
      byLayerKey: new Map(),
    };
    setOpenFillPickerKey((current) =>
      current?.startsWith(`${fillStashKey}:`) ? current : null,
    );
  }, [fillStashKey]);
  const setFillPickerOpen = (key: string, open: boolean) => {
    setOpenFillPickerKey((current) =>
      open ? key : current === key ? null : current,
    );
  };
  // Per-layer row identity, keyed to survive content edits but NOT survive a
  // reorder/removal at a different position. key={index} alone (this row's
  // earlier fix for the content-derived-key remount bug) attaches the row's
  // uncontrolled DesignColorPicker instance to a position rather than a
  // layer, so removing or reordering a preceding row leaves an open
  // picker's local paint-type/gradient/selected-stop state attached to
  // whatever layer now occupies that position. reorderFillLayers,
  // removeLayer, and the "+" add handler below explicitly keep this array
  // in lockstep with the same splice/insert they apply to the CSS layers -
  // the resync below only reseeds it (fresh ids, positionally) when the
  // selected element changes, or the count drifts out of sync with those
  // tracked mutations (e.g. an external/agent-driven style edit).
  const layerKeysRef = useRef<{ elementKey: string; keys: string[] }>({
    elementKey: "",
    keys: [],
  });
  const pendingConvertedLayerRef = useRef<{
    elementKey: string;
    key: string;
    index: number;
    previousLayerCount: number;
  } | null>(null);
  const renderedFillValue = isTextFillElement
    ? styles.color || ""
    : isVectorFillElement
      ? element.inlineStyles?.["--an-vector-fill-gradient"] || styles.fill || ""
      : styles.backgroundColor || "";
  const authoredFillValue = isVectorFillElement
    ? (element.inlineStyles?.["--an-vector-fill-gradient"] ??
      element.inlineStyles?.[fillProperty])
    : element.inlineStyles?.[fillProperty];
  const storedPaint = readGradientFillOpacity([
    { color: authoredFillValue ?? renderedFillValue },
  ]);
  const isHidden = storedPaint.opacity === 0;
  const fillValue = isHidden ? storedPaint.stops[0]!.color : renderedFillValue;
  const backgroundLayers = isVectorFillElement
    ? []
    : splitCssLayers(styles.backgroundImage || "");
  const backgroundSizeLayers = isVectorFillElement
    ? []
    : splitCssLayers(styles.backgroundSize || "");
  const backgroundRepeatLayers = isVectorFillElement
    ? []
    : splitCssLayers(styles.backgroundRepeat || "");
  const backgroundPositionLayers = isVectorFillElement
    ? []
    : splitCssLayers(styles.backgroundPosition || "");
  const baseFillLayerProps = baseFillLayerSourceProps(
    styles,
    isVectorFillElement,
  );
  const fillIsMixed =
    isMixedValue(fillValue) ||
    isMixedValue(styles.backgroundImage) ||
    isMixedValue(styles.backgroundSize) ||
    isMixedValue(styles.backgroundRepeat) ||
    isMixedValue(styles.backgroundPosition) ||
    (isTextFillElement && isMixedValue(styles.backgroundClip));
  const hasBackgroundLayer =
    !isVectorFillElement && backgroundLayers.length > 0;
  const authoredFill = authoredFillValue?.trim().toLowerCase();
  const isOpenPenPath =
    element.tagName.toLowerCase() === "svg" &&
    element.primitiveKind === "path" &&
    element.vectorStrokeCanAlign === false;
  const hasAuthoredFill = Boolean(
    authoredFill && authoredFill !== "transparent" && authoredFill !== "none",
  );
  const hasBaseFill = isOpenPenPath
    ? hasAuthoredFill
    : isTextFillElement || colorHasVisibleAlpha(fillValue) || hasAuthoredFill;
  const hasVisibleFill = hasBaseFill || hasBackgroundLayer;
  const pendingConversion = pendingConvertedLayerRef.current;
  if (
    pendingConversion?.elementKey === fillStashKey &&
    layerKeysRef.current.elementKey === fillStashKey &&
    backgroundLayers.length === pendingConversion.previousLayerCount + 1
  ) {
    layerKeysRef.current.keys.splice(
      pendingConversion.index,
      0,
      pendingConversion.key,
    );
    pendingConvertedLayerRef.current = null;
  } else if (pendingConversion?.elementKey !== fillStashKey) {
    pendingConvertedLayerRef.current = null;
  }
  if (
    layerKeysRef.current.elementKey !== fillStashKey ||
    layerKeysRef.current.keys.length !== backgroundLayers.length
  ) {
    const previousKeys =
      layerKeysRef.current.elementKey === fillStashKey
        ? layerKeysRef.current.keys
        : [];
    layerKeysRef.current = {
      elementKey: fillStashKey,
      keys: backgroundLayers.map((_, i) => previousKeys[i] ?? nextLayerKey()),
    };
  }
  const layerKeys = layerKeysRef.current.keys;

  // The native CSS wrapper preserves the original paint, including zero alpha,
  // across reload. Plain zero-alpha paint remains distinct from a hidden fill.
  const handleFillVisibilityToggle = () => {
    onStyleChange(
      fillProperty,
      isHidden
        ? fillValue
        : gradientStopWithFillOpacity(authoredFillValue || fillValue, 0),
    );
  };

  // Reorder fill layers by dragging: permute all four index-aligned parallel
  // arrays (image/size/repeat/position) together and commit them as one patch
  // so stacking order changes in a single history step. Prefer onStylesChange
  // (single call) when available; otherwise fall back to four sequential
  // onStyleChange calls, matching the commit-path convention used elsewhere
  // in this component (see commitStylePatch).
  const reorderFillLayers = (from: number, to: number) => {
    const patch = reorderFillLayerArrays(
      {
        backgroundImage: backgroundLayers,
        backgroundSize: backgroundSizeLayers,
        backgroundRepeat: backgroundRepeatLayers,
        backgroundPosition: backgroundPositionLayers,
      },
      from,
      to,
    );
    const nextKeys = [...layerKeysRef.current.keys];
    const [movedKey] = nextKeys.splice(from, 1);
    if (movedKey) nextKeys.splice(to, 0, movedKey);
    layerKeysRef.current.keys = nextKeys;
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

  const commitBackgroundImageChange = (
    backgroundImage: string,
    meta?: Parameters<StyleChangeHandler>[2],
  ) => {
    if (!isTextFillElement) {
      onStyleChange("backgroundImage", backgroundImage, meta);
      return;
    }
    const hasGradient = splitCssLayers(backgroundImage).some((layer) =>
      Boolean(parseGradientLayer(layer)),
    );
    const capturedMeta = capturedStyleTargets
      ? { ...meta, capturedStyleTargets }
      : meta;
    commitStylePatch(
      {
        backgroundImage,
        backgroundClip: hasGradient ? "text" : "border-box",
      },
      onStyleChange,
      onStylesChange,
      capturedMeta,
    );
  };

  const addFill = () => {
    if (onAddFill) {
      const added = onAddFill();
      if (added === "base") {
        setOpenFillPickerKey(fillStashKey + ":base");
      } else if (added === "layer") {
        const key = nextLayerKey();
        pendingConvertedLayerRef.current = {
          elementKey: fillStashKey,
          key,
          index: 0,
          previousLayerCount: backgroundLayers.length,
        };
        setOpenFillPickerKey(fillStashKey + ":" + key);
      }
      return;
    }
    if (fillIsMixed) {
      const replacement: Record<string, string> = isTextFillElement
        ? {
            color: "#000000", // guard:allow-raw-color — a concrete fallback for mixed text paint.
            backgroundImage: "none",
            backgroundClip: "border-box",
          }
        : {
            color: "#000000", // guard:allow-raw-color — adding a fill to a mixed selection seeds real canvas paint.
            backgroundColor: "#ffffff", // guard:allow-raw-color — adding a fill to a mixed selection seeds real canvas paint.
            backgroundImage: "none",
          };
      commitStylePatch(replacement, onStyleChange, onStylesChange);
      return;
    }
    if (isTextFillElement) {
      onStyleChange(
        "color",
        cssColorOrFallback(
          styles.color,
          "#000000", // guard:allow-raw-color — restores a concrete authored text fill.
        ),
      );
      return;
    }
    if (isVectorFillElement) {
      onStyleChange(
        "fill",
        cssColorOrFallback(styles.fill, DEFAULT_SHAPE_FILL),
      );
      return;
    }
    const addFillPatch = addFillLayerPatch({
      backgroundColor: styles.backgroundColor,
      backgroundLayers,
      backgroundSizeLayers,
      backgroundRepeatLayers,
      backgroundPositionLayers,
    });
    if (addFillPatch.backgroundImage !== undefined) {
      layerKeysRef.current.keys = [
        nextLayerKey(),
        ...layerKeysRef.current.keys,
      ];
    }
    commitStylePatch(addFillPatch, onStyleChange, onStylesChange);
  };

  return (
    <PanelSection
      title={t("editPanel.sections.fill")}
      onEmptyTitleClick={
        !hideAddFill && (onAddFill || !isTextFillElement || fillIsMixed)
          ? addFill
          : undefined
      }
      emptyTitleActionLabel={t("editPanel.labels.addFill")}
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
          {!hideAddFill && (onAddFill || !isTextFillElement || fillIsMixed) ? (
            <SectionIconButton
              label={t("editPanel.labels.addFill")}
              onClick={addFill}
            >
              <IconPlus className="size-3.5" />
            </SectionIconButton>
          ) : null}
        </>
      }
    >
      {element.tagName.toLowerCase() === "img" ? (
        <ImageElementFill
          element={element}
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
        />
      ) : null}
      {fillIsMixed ? (
        <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
          {
            "Click + to replace mixed content" /* i18n-ignore figma mixed fill hint */
          }
        </p>
      ) : hasVisibleFill ? (
        <div className="space-y-2">
          {hasBaseFill ? (
            /* design row: [swatch+hex trigger (flex-1)] [eye] [remove] */
            <InspectorPaintRow>
              <InspectorGridCell span={20}>
                <ColorInput
                  label=""
                  value={fillValue}
                  onChange={(v, meta) =>
                    onStyleChange(
                      fillProperty,
                      isHidden ? gradientStopWithFillOpacity(v, 0) : v,
                      meta,
                    )
                  }
                  onChangeCancel={
                    cancelOpacityGestureOnHistoryUndo
                      ? (v) =>
                          onStyleChange(fillProperty, v, { phase: "cancel" })
                      : undefined
                  }
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
                  open={openFillPickerKey === `${fillStashKey}:base`}
                  onOpenChange={(open) =>
                    setFillPickerOpen(`${fillStashKey}:base`, open)
                  }
                  blendMode={
                    isVectorFillElement || isTextFillElement
                      ? undefined
                      : styles.backgroundBlendMode || "normal"
                  }
                  onBlendModeChange={
                    isVectorFillElement || isTextFillElement
                      ? undefined
                      : (v) => onStyleChange("backgroundBlendMode", v)
                  }
                  // SVG fills can be gradients, but they are one native paint,
                  // not an entry in the CSS background layer stack.
                  supportsLayeredFills={!isVectorFillElement}
                  singlePaint={isVectorFillElement}
                  onBackgroundImageChange={
                    isVectorFillElement
                      ? undefined
                      : commitBackgroundImageChange
                  }
                  onSolidToGradientChange={
                    isVectorFillElement
                      ? (patch) =>
                          onStyleChange(fillProperty, patch.backgroundImage)
                      : isTextFillElement
                        ? undefined
                        : (patch) => {
                            const convertedLayerKey = nextLayerKey();
                            pendingConvertedLayerRef.current = {
                              elementKey: fillStashKey,
                              key: convertedLayerKey,
                              index: backgroundLayers.length,
                              previousLayerCount: backgroundLayers.length,
                            };
                            setOpenFillPickerKey(
                              `${fillStashKey}:${convertedLayerKey}`,
                            );
                            commitStylePatch(
                              patch,
                              onStyleChange,
                              onStylesChange,
                            );
                          }
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
                    isVectorFillElement || isTextFillElement
                      ? undefined
                      : commitImageFillPatch
                  }
                  supportedPaintTypes={
                    isVectorFillElement
                      ? ["solid", "linear", "radial"]
                      : isTextFillElement
                        ? TEXT_BASE_PAINT_TYPES
                        : undefined
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
                    isVectorFillElement || isTextFillElement
                      ? undefined
                      : glslShaderContext
                  }
                />
              </InspectorGridCell>
              <InspectorGridCell span={4} className="flex justify-center">
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
              </InspectorGridCell>
              <InspectorGridCell span={4} className="flex justify-center">
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
              </InspectorGridCell>
              {!isVectorFillElement && !isTextFillElement ? (
                <InspectorGridCell span={1} className="flex justify-center">
                  <FieldTrailer
                    element={element}
                    motionCssProperty="background-color"
                    motionKeyframeContext={motionKeyframeContext}
                    breakpointOverrideContext={breakpointOverrideContext}
                    hoverRevealClassName="opacity-0 group-hover:opacity-100"
                  />
                </InspectorGridCell>
              ) : null}
            </InspectorPaintRow>
          ) : null}
          {!isVectorFillElement
            ? backgroundLayers.map((layer, index) => {
                const solidFillColor = parseSolidFillLayer(layer);
                const gradient = solidFillColor
                  ? null
                  : parseGradientLayer(layer);
                const layerKey = layerKeys[index];
                const pickerKey = `${fillStashKey}:${layerKey}`;
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
                  ? (gradient.opacity ?? 100)
                  : solidFillColor
                    ? Math.round((parseCssColor(solidFillColor)?.a ?? 1) * 100)
                    : 100;
                const solidFillHex = solidFillColor
                  ? rgbaToHex(parseCssColor(solidFillColor)!)
                  : null;
                const label = solidFillHex
                  ? solidFillHex
                  : gradient
                    ? `${gradientLabel(gradient.type)} ${index + 1}`
                    : `${"Image" /* i18n-ignore design inspector paint row */} ${
                        index + 1
                      }`;
                const replaceLayer = (
                  nextLayer: string,
                  meta?: Parameters<StyleChangeHandler>[2],
                ) => {
                  const nextLayers = [...backgroundLayers];
                  nextLayers[index] = nextLayer;
                  commitBackgroundImageChange(joinCssLayers(nextLayers), meta);
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
                  const patch: Record<string, string> = removeFillLayerAtIndex(
                    {
                      backgroundImage: backgroundLayers,
                      backgroundSize: backgroundSizeLayers,
                      backgroundRepeat: backgroundRepeatLayers,
                      backgroundPosition: backgroundPositionLayers,
                    },
                    index,
                  );
                  if (isTextFillElement) {
                    const remainingLayers = splitCssLayers(
                      patch.backgroundImage,
                    );
                    const hasGradient = remainingLayers.some((remainingLayer) =>
                      Boolean(parseGradientLayer(remainingLayer)),
                    );
                    patch.backgroundClip = hasGradient ? "text" : "border-box";
                    if (
                      !hasGradient &&
                      remainingLayers.length === 0 &&
                      gradient &&
                      !colorHasVisibleAlpha(fillValue)
                    ) {
                      patch.color = gradient.stops[0]?.color ?? "#000000"; // guard:allow-raw-color — preserve a concrete text paint when removing its last gradient.
                    }
                  }
                  const removedLayerKey = layerKeysRef.current.keys[index];
                  layerKeysRef.current.keys.splice(index, 1);
                  if (removedLayerKey) {
                    gradientBeforeSolidRef.current.byLayerKey.delete(
                      removedLayerKey,
                    );
                    const removedSizeKey = `${fillStashKey}:fill-size:${removedLayerKey}`;
                    setHiddenFillSizeStash((previous) => {
                      if (!(removedSizeKey in previous)) return previous;
                      const next = { ...previous };
                      delete next[removedSizeKey];
                      return next;
                    });
                  }
                  if (removedLayerKey) {
                    setOpenFillPickerKey((current) =>
                      current === `${fillStashKey}:${removedLayerKey}`
                        ? null
                        : current,
                    );
                  }
                  commitStylePatch(patch, onStyleChange, onStylesChange);
                };
                const sizeStashKey = `${fillStashKey}:fill-size:${layerKey}`;
                const setLayerHidden = (nextHidden: boolean) => {
                  if (nextHidden) {
                    // Stash the real pre-hide size (a custom cover/contain/
                    // percentage — see withLayerSizeMarker) so re-showing
                    // can restore it instead of permanently discarding it
                    // for "auto". Skip stashing if the layer is somehow
                    // already hidden (nothing real to preserve).
                    const current = alignCssLayerValues(
                      backgroundSizeLayers,
                      backgroundLayers.length,
                      "auto",
                    )[index];
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
                  <InspectorPaintRow
                    // Keyed by a stable per-layer id (see layerKeysRef
                    // above), not by position and not by the layer's own CSS
                    // content: a content-derived key remounts this row's
                    // DesignColorPicker on every edit (dropping its open
                    // popover/paint-type selection/gradient-editor state),
                    // and a plain positional key transfers that same state
                    // onto whichever layer now occupies this position after
                    // a reorder or a preceding row's removal.
                    key={layerKey}
                    draggable
                    {...fillDrag.getRowProps(index)}
                  >
                    <InspectorGridCell span={3}>
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
                    </InspectorGridCell>
                    <InspectorGridCell
                      span={20}
                      className="flex items-center gap-1"
                    >
                      {/* Single Popover, owned by DesignColorPicker itself
                          (via the `trigger` prop) — this row previously
                          wrapped DesignColorPicker in a *second*,
                          independent outer Popover for this custom-looking
                          trigger. Two nested popovers meant the outer one
                          opened first (showing DesignColorPicker's own
                          default trigger, requiring a second click to
                          actually reach the picker), and the outer popover's
                          dismissable layer treated clicks on the inner
                          picker's portaled content as "outside", closing
                          both popovers the instant the gradient editor was
                          touched or the fill type was switched. */}
                      <DesignColorPicker
                        key={`${layerKey}:${openFillPickerKey === pickerKey}`}
                        open={openFillPickerKey === pickerKey}
                        onOpenChange={(open) => {
                          setFillPickerOpen(pickerKey, open);
                          if (
                            !open &&
                            gradientBeforeSolidRef.current.elementKey ===
                              fillStashKey
                          ) {
                            gradientBeforeSolidRef.current.byLayerKey.delete(
                              layerKey,
                            );
                          }
                        }}
                        trigger={
                          <button
                            type="button"
                            className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 pl-8 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                          >
                            <span
                              className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
                              style={swatchStyle(layer)}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                              {label}
                            </span>
                            {!gradient && (
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {hidden ? 0 : opacity}%
                              </span>
                            )}
                          </button>
                        }
                        className="min-w-0 flex-1"
                        value={solidFillColor ?? layer}
                        onPaintTypeChange={(type) => {
                          if (type === "solid") {
                            if (gradient) {
                              gradientBeforeSolidRef.current.byLayerKey.set(
                                layerKey,
                                layer,
                              );
                            }
                            const firstStop = gradient?.stops[0];
                            const firstStopColor = firstStop
                              ? parseCssColor(firstStop.color)
                              : null;
                            const solidColor = solidFillColor
                              ? solidFillColor
                              : firstStopColor
                                ? rgbaToCss(
                                    withColorOpacity(
                                      firstStopColor,
                                      ((firstStop?.opacity ??
                                        firstStopColor.a * 100) *
                                        (gradient?.opacity ?? 100)) /
                                        100,
                                    ),
                                  )
                                : cssColorOrFallback(
                                    undefined,
                                    "#000000", // guard:allow-raw-color — a missing paint restores the concrete canvas fallback.
                                  );
                            replaceLayer(buildSolidFillLayer(solidColor));
                            return true;
                          }
                          if (
                            type === "linear" ||
                            type === "radial" ||
                            type === "angular" ||
                            type === "diamond"
                          ) {
                            const storedGradient =
                              gradientBeforeSolidRef.current.elementKey ===
                              fillStashKey
                                ? gradientBeforeSolidRef.current.byLayerKey.get(
                                    layerKey,
                                  )
                                : undefined;
                            if (!storedGradient) return false;
                            const stored = parseGradientLayer(storedGradient);
                            if (!stored) return false;
                            replaceLayer(
                              stored.type === type
                                ? storedGradient
                                : buildGradientLayer(
                                    type,
                                    stored.stops,
                                    undefined,
                                    stored.opacity,
                                  ),
                            );
                            gradientBeforeSolidRef.current.byLayerKey.delete(
                              layerKey,
                            );
                            return true;
                          }
                          if (type === "none") {
                            removeLayer();
                            return true;
                          }
                          return false;
                        }}
                        onPaintValueChange={replaceLayer}
                        onChange={(nextColor) => {
                          if (solidFillColor) {
                            replaceLayer(buildSolidFillLayer(nextColor));
                            return;
                          }
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
                              gradient.opacity,
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
                        onImageFillChange={
                          isTextFillElement
                            ? undefined
                            : (value) =>
                                commitImageFillPatch(
                                  setImageFillLayerPatch(
                                    {
                                      backgroundImage: backgroundLayers,
                                      backgroundSize: backgroundSizeLayers,
                                      backgroundRepeat: backgroundRepeatLayers,
                                      backgroundPosition:
                                        backgroundPositionLayers,
                                    },
                                    index,
                                    imageFillToBackgroundStyles(value),
                                  ),
                                )
                        }
                        paintType={
                          solidFillColor ? "solid" : (gradient?.type ?? "image")
                        }
                        supportedPaintTypes={
                          isTextFillElement
                            ? TEXT_GRADIENT_PAINT_TYPES
                            : EXISTING_LAYER_PAINT_TYPES
                        }
                        backgroundImage={layer}
                        backgroundSize={backgroundSizeLayers[index]}
                        backgroundRepeat={backgroundRepeatLayers[index]}
                        backgroundPosition={backgroundPositionLayers[index]}
                        gradientType={gradient?.type}
                        onGradientTypeChange={(type) => {
                          if (!gradient) return;
                          replaceLayer(
                            buildGradientLayer(
                              type,
                              gradient.stops,
                              undefined,
                              gradient.opacity,
                            ),
                          );
                        }}
                        fillRows={[
                          {
                            id: `layer-${index}`,
                            label,
                            value: solidFillColor ?? layer,
                            type: solidFillColor
                              ? "solid"
                              : gradient
                                ? "gradient"
                                : "image",
                            selected: true,
                            swatch: layer,
                          },
                        ]}
                        selectedFillId={`layer-${index}`}
                      />
                      {gradient && (
                        <div className="w-12 shrink-0">
                          <ScrubInput
                            label={t("editPanel.labels.opacity")}
                            labelClassName="hidden"
                            value={opacity}
                            min={0}
                            max={100}
                            unit="%"
                            onChange={(next, meta) =>
                              replaceLayer(
                                buildGradientLayer(
                                  gradient.type,
                                  gradient.stops,
                                  gradient.prefix,
                                  next,
                                ),
                                meta,
                              )
                            }
                          />
                        </div>
                      )}
                    </InspectorGridCell>
                    <InspectorGridCell span={4} className="flex justify-center">
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
                    </InspectorGridCell>
                    <InspectorGridCell span={4} className="flex justify-center">
                      <SectionIconButton
                        label={t("editPanel.labels.removeLayer")}
                        onClick={removeLayer}
                      >
                        <IconMinus className="size-3.5" />
                      </SectionIconButton>
                    </InspectorGridCell>
                  </InspectorPaintRow>
                );
              })
            : null}
        </div>
      ) : null}
    </PanelSection>
  );
}
