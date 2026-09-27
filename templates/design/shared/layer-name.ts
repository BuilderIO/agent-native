export const LAYER_NAME_ATTRIBUTE_PRIORITY = [
  "data-agent-native-layer-name",
  "data-layer-name",
  "layer-name",
] as const;

export type LayerNameAttribute = (typeof LAYER_NAME_ATTRIBUTE_PRIORITY)[number];

export function resolveLayerNameAttribute(
  readAttribute: (attribute: LayerNameAttribute) => string | null | undefined,
): { attribute: LayerNameAttribute; value: string } | null {
  for (const attribute of LAYER_NAME_ATTRIBUTE_PRIORITY) {
    const value = readAttribute(attribute)?.trim();
    if (value) return { attribute, value };
  }
  return null;
}
