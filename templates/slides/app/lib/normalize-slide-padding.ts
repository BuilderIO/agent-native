const CANONICAL_SLIDE_PADDING = "80px 110px";

/**
 * Force the canonical padding on the outer `.fmd-slide` wrapper when the
 * agent supplies slide HTML. Models drift on numeric values during
 * regeneration - most often dropping the second padding arg, which collapses
 * horizontal padding from 110px to 80px and makes a layout look shifted.
 *
 * This intentionally uses a small attribute scanner instead of matching one
 * exact attribute order. Saved HTML can come from an agent, an import, or the
 * browser editor, and all three legitimately produce different quote styles
 * and class lists. Normalizing at every server-side write makes the padding
 * survive a refresh instead of depending on the last renderer's DOM.
 */
export function normalizeSlidePadding(html: string): string {
  const openingTagPattern = /<div\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openingTagPattern.exec(html))) {
    const openingTag = match[0];
    const classMatch = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(openingTag);
    if (!classMatch || !/(^|\s)fmd-slide(?:\s|$)/i.test(classMatch[2])) {
      continue;
    }

    const styleMatch = /\bstyle\s*=\s*(["'])(.*?)\1/i.exec(openingTag);
    const nextStyle = normalizeStyleAttribute(styleMatch?.[2] ?? "");
    const nextOpeningTag = styleMatch
      ? openingTag.slice(0, styleMatch.index) +
        `style=${styleMatch[1]}${nextStyle}${styleMatch[1]}` +
        openingTag.slice(styleMatch.index + styleMatch[0].length)
      : openingTag.replace(/\s*\/?>$/, ` style="${nextStyle}"$&`);

    return `${html.slice(0, match.index)}${nextOpeningTag}${html.slice(match.index + openingTag.length)}`;
  }

  return html;
}

function normalizeStyleAttribute(style: string): string {
  const withCanonicalPadding = /(?:^|;)\s*padding\s*:/i.test(style)
    ? style.replace(
        /(^|;)\s*padding\s*:\s*[^;]*/i,
        `$1 padding: ${CANONICAL_SLIDE_PADDING}`,
      )
    : `padding: ${CANONICAL_SLIDE_PADDING};${style ? ` ${style}` : ""}`;

  return withCanonicalPadding.replace(/^\s+/, "");
}
