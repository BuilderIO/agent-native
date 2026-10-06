import {
  alignCssLayerValues,
  isLayerHiddenBySize,
  joinCssLayers,
  splitCssLayers,
} from "./fill-gradient-helpers";

const LAYER_PROPERTIES = [
  "backgroundImage",
  "backgroundSize",
  "backgroundRepeat",
  "backgroundPosition",
  "backgroundClip",
  "backgroundOrigin",
] as const;

type LayerProperty = (typeof LAYER_PROPERTIES)[number];
type LayerArrays = Record<LayerProperty, string[]>;

const LAYER_DEFAULTS: Record<LayerProperty, string> = {
  backgroundImage: "none",
  backgroundSize: "auto",
  backgroundRepeat: "repeat",
  backgroundPosition: "0% 0%",
  backgroundClip: "border-box",
  backgroundOrigin: "padding-box",
};

const STROKE_LAYER_VALUES: Omit<
  Record<LayerProperty, string>,
  "backgroundImage"
> = {
  backgroundSize: "100% 100%",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "0% 0%",
  backgroundClip: "border-area",
  backgroundOrigin: "border-box",
};

export const BOX_STROKE_HIDDEN_SIZE = "0px 0px";

function imageLayers(value: string | undefined): string[] {
  return splitCssLayers(value ?? "").filter(
    (layer) => layer.trim() && layer.trim().toLowerCase() !== "none",
  );
}

function layerArrays(styles: Record<string, string>): LayerArrays {
  const images = imageLayers(styles.backgroundImage);
  const arrays = { backgroundImage: images } as LayerArrays;
  for (const property of LAYER_PROPERTIES) {
    if (property === "backgroundImage") continue;
    arrays[property] = alignCssLayerValues(
      splitCssLayers(styles[property] ?? ""),
      images.length,
      LAYER_DEFAULTS[property],
    );
  }
  return arrays;
}

function strokeIndex(arrays: LayerArrays): number {
  return arrays.backgroundClip.findIndex(
    (clip) => clip.trim().toLowerCase() === "border-area",
  );
}

export function boxGradientStroke(
  styles: Record<string, string>,
): { layer: string; hidden: boolean } | null {
  const arrays = layerArrays(styles);
  const index = strokeIndex(arrays);
  if (index < 0) return null;
  return {
    layer: arrays.backgroundImage[index]!,
    hidden: isLayerHiddenBySize(arrays.backgroundSize[index]),
  };
}

function withoutIndex(arrays: LayerArrays, index: number): LayerArrays {
  const next = {} as LayerArrays;
  for (const property of LAYER_PROPERTIES) {
    next[property] = arrays[property].filter((_, i) => i !== index);
  }
  return next;
}

function serialize(arrays: LayerArrays): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const property of LAYER_PROPERTIES) {
    patch[property] =
      property === "backgroundImage"
        ? joinCssLayers(arrays.backgroundImage)
        : arrays.backgroundImage.length
          ? arrays[property].join(", ")
          : LAYER_DEFAULTS[property];
  }
  return patch;
}

export function withoutBoxStrokeLayer(
  styles: Record<string, string>,
): Record<string, string> {
  const arrays = layerArrays(styles);
  const index = strokeIndex(arrays);
  if (index < 0) return styles;
  return { ...styles, ...serialize(withoutIndex(arrays, index)) };
}

export function boxStrokeLayerPatch(
  styles: Record<string, string>,
  layer: string | null,
  hidden = false,
): Record<string, string> {
  const arrays = layerArrays(styles);
  const index = strokeIndex(arrays);
  const fills = index < 0 ? arrays : withoutIndex(arrays, index);
  if (!layer) return serialize(fills);
  const next = {} as LayerArrays;
  for (const property of LAYER_PROPERTIES) {
    const strokeValue =
      property === "backgroundImage"
        ? layer
        : property === "backgroundSize" && hidden
          ? BOX_STROKE_HIDDEN_SIZE
          : STROKE_LAYER_VALUES[property];
    next[property] = [strokeValue, ...fills[property]];
    if (fills.backgroundImage.length === 0) {
      next[property].push(LAYER_DEFAULTS[property]);
    }
  }
  return serialize(next);
}

export function withBoxStrokeLayer(
  styles: Record<string, string>,
  fillPatch: Record<string, string>,
): Record<string, string> {
  const stroke = boxGradientStroke(styles);
  const touchesLayers = LAYER_PROPERTIES.some(
    (property) => property in fillPatch,
  );
  if (!stroke || !touchesLayers) return fillPatch;
  const fillStyles = { ...withoutBoxStrokeLayer(styles), ...fillPatch };
  return {
    ...fillPatch,
    ...boxStrokeLayerPatch(fillStyles, stroke.layer, stroke.hidden),
  };
}
