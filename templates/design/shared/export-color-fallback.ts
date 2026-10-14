import { parseCssColor, rgbaToCss } from "./color-utils.js";

/**
 * Raster exports (PNG, and the PDF built from it) are sRGB. A color the design
 * holds in `oklch()` or `color(display-p3 …)` can be outside sRGB, and the
 * browser that rasterizes the page clips it channel by channel, which shifts
 * its hue (in Chromium `oklch(0.7 0.3 150)` paints as a more saturated, yellower
 * green than its CSS Color 4 fallback). Before such a page is rendered its wide
 * colors are rewritten to that fallback instead: the gamut-mapped sRGB color
 * with lightness and hue kept and chroma reduced.
 *
 * SVG and HTML exports keep the colors as written, since CSS carries them.
 */

const WIDE_COLOR_TOKEN =
  /\boklch\([^()]*\)|\bcolor\(\s*(?:display-p3|srgb)\s[^()]*\)/gi;

// Only places a browser reads colors from: style attributes, <style> blocks
// and SVG paint attributes. Text content, script and comments are left as is.
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const PAINT_ATTRIBUTE =
  /(\s(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*)("[^"]*"|'[^']*')/gi;

/** Each wide-gamut color in a CSS value as its sRGB fallback; one that cannot be read stays as written. */
export function degradeWideColorsInCss(css: string): string {
  return css.replace(WIDE_COLOR_TOKEN, (token) => {
    const parsed = parseCssColor(token);
    return parsed ? rgbaToCss(parsed) : token;
  });
}

/** `degradeWideColorsInCss` for the CSS an HTML document carries. */
export function degradeWideColorsInHtml(html: string): string {
  if (!/oklch\(|color\(/i.test(html)) return html;
  return html
    .replace(
      STYLE_ATTRIBUTE,
      (_match, head: string, value: string) =>
        `${head}${degradeWideColorsInCss(value)}`,
    )
    .replace(
      STYLE_BLOCK,
      (_match, open: string, body: string, close: string) =>
        `${open}${degradeWideColorsInCss(body)}${close}`,
    )
    .replace(
      PAINT_ATTRIBUTE,
      (_match, head: string, value: string) =>
        `${head}${degradeWideColorsInCss(value)}`,
    );
}
