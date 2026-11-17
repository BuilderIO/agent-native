// Newsletters and receipts lay out in a fixed-width table or box, most often
// 600 px. Below this, a width is a column or an image, not the email's layout.
const FIXED_LAYOUT_MIN_WIDTH = 480;

const FIXED_WIDTH_STYLE = /(?:^|;)\s*(?:max-)?width\s*:\s*(\d+(?:\.\d+)?)px/i;

/** Whether an HTML email is laid out at a fixed width, as designed email is. */
export function emailHasFixedWidthLayout(html: string): boolean {
  if (!/width/i.test(html)) return false;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.body.querySelectorAll("table, div, center")) {
    const width = Number.parseFloat(element.getAttribute("width") ?? "");
    if (width >= FIXED_LAYOUT_MIN_WIDTH) return true;
    const styled = (element.getAttribute("style") ?? "").match(
      FIXED_WIDTH_STYLE,
    );
    if (styled && Number(styled[1]) >= FIXED_LAYOUT_MIN_WIDTH) return true;
  }
  return false;
}
