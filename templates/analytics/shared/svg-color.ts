const SAFE_SVG_HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

export function isSafeSvgHexColor(value: unknown): value is string {
  return typeof value === "string" && SAFE_SVG_HEX_COLOR.test(value.trim());
}
