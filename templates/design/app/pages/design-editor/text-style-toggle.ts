/** Cmd+B: bold text (600 and up) goes back to regular, anything else to bold. */
export function nextBoldFontWeight(fontWeight: string | undefined): string {
  const weight =
    fontWeight === "bold" || fontWeight === "bolder"
      ? 700
      : Number.parseInt(fontWeight ?? "", 10);
  return Number.isFinite(weight) && weight >= 600 ? "400" : "700";
}

/** Cmd+I: italic or oblique text goes back to normal, anything else to italic. */
export function nextItalicFontStyle(fontStyle: string | undefined): string {
  return fontStyle === "italic" || fontStyle?.startsWith("oblique")
    ? "normal"
    : "italic";
}
