/**
 * Ensure the outer `.fmd-slide` wrapper has a padding declaration.
 *
 * Explicit padding is part of the slide layout, so preserve it. In particular,
 * an overflow repair often needs to reduce vertical padding; rewriting that
 * value here makes a successful-looking agent edit a no-op in the renderer.
 */
export function normalizeSlidePadding(html: string): string {
  for (const match of html.matchAll(/<div\b[^>]*>/gi)) {
    const openingTag = match[0];
    const classMatch = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(openingTag);

    if (!classMatch || !/\bfmd-slide\b/i.test(classMatch[2])) continue;

    const styleMatch = /\bstyle\s*=\s*(["'])(.*?)\1/i.exec(openingTag);
    if (styleMatch) {
      const style = styleMatch[2];
      if (/(?:^|;)\s*padding\s*:/i.test(style)) return html;

      const nextStyle = `padding: 80px 110px;${
        style.startsWith(" ") ? "" : " "
      }${style}`;
      const nextStyleAttribute = styleMatch[0].replace(style, nextStyle);
      const nextOpeningTag = openingTag.replace(
        styleMatch[0],
        nextStyleAttribute,
      );

      return (
        html.slice(0, match.index) +
        nextOpeningTag +
        html.slice(match.index + openingTag.length)
      );
    }

    const classEnd = classMatch.index + classMatch[0].length;
    const nextOpeningTag =
      openingTag.slice(0, classEnd) +
      ' style="padding: 80px 110px;"' +
      openingTag.slice(classEnd);

    return (
      html.slice(0, match.index) +
      nextOpeningTag +
      html.slice(match.index + openingTag.length)
    );
  }

  return html;
}
