import type { ElementInfo } from "@/components/design/types";

const APPEARANCE_PROPERTIES = [
  "backgroundColor",
  "borderColor",
  "borderStyle",
  "borderWidth",
  "borderRadius",
  "boxShadow",
  "opacity",
] as const;
const TEXT_PROPERTIES = [
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
] as const;

export function copyVisualProperties(
  element: ElementInfo,
): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const property of APPEARANCE_PROPERTIES) {
    const value = element.computedStyles[property];
    if (value) properties[property] = value;
  }
  for (const property of TEXT_PROPERTIES) {
    if (
      !element.hasOwnText &&
      !element.wholeTextStyleRoot &&
      !element.inlineStyles?.[property]
    )
      continue;
    const value = element.computedStyles[property];
    if (value) properties[property] = value;
  }
  return properties;
}
