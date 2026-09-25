function fmdSlideClass(openingTag: string): RegExpExecArray | null {
  const classMatch = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(openingTag);
  return classMatch && /\bfmd-slide\b/i.test(classMatch[2]) ? classMatch : null;
}

/** The start tag of the outer `.fmd-slide` wrapper, as written. */
function fmdSlideStartTag(html: string): string | null {
  for (const match of html.matchAll(/<div\b[^>]*>/gi)) {
    if (fmdSlideClass(match[0])) return match[0];
  }
  return null;
}

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
    const classMatch = fmdSlideClass(openingTag);

    if (!classMatch) continue;

    const styleMatch = /\bstyle\s*=\s*(["'])(.*?)\1/i.exec(openingTag);
    if (styleMatch) {
      const style = styleMatch[2];
      if (/(?:^|;)\s*padding\s*:/i.test(style)) return html;

      const nextStyle = `padding: 64px 80px;${
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
      ' style="padding: 64px 80px;"' +
      openingTag.slice(classEnd);

    return (
      html.slice(0, match.index) +
      nextOpeningTag +
      html.slice(match.index + openingTag.length)
    );
  }

  return html;
}

/**
 * Padding for a content write to an existing slide: only when the write
 * changed the `.fmd-slide` start tag. A slide padded by its stylesheet has no
 * inline padding, and re-padding it on every text edit moved its layout.
 * `previous` is undefined for a new slide.
 */
export function normalizeSlidePaddingForWrite(
  previous: string | undefined,
  next: string,
): string {
  if (
    previous !== undefined &&
    fmdSlideStartTag(previous) === fmdSlideStartTag(next)
  ) {
    return next;
  }
  return normalizeSlidePadding(next);
}
