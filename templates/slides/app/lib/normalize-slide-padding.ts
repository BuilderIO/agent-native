// A second style attribute is dropped by the HTML parser in favor of the first, so
// a missed match on the existing one shadows the wrapper's whole style.
const DIV_OPENING_TAG = /<div\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function fmdSlideClass(openingTag: string): RegExpExecArray | null {
  const classMatch = /\sclass\s*=\s*(["'])([\s\S]*?)\1/i.exec(openingTag);
  return classMatch && /\bfmd-slide\b/i.test(classMatch[2]) ? classMatch : null;
}

function fmdSlideStartTag(html: string): string | null {
  for (const match of html.matchAll(DIV_OPENING_TAG)) {
    if (fmdSlideClass(match[0])) return match[0];
  }
  return null;
}

export function normalizeSlidePadding(html: string): string {
  for (const match of html.matchAll(DIV_OPENING_TAG)) {
    const openingTag = match[0];
    const classMatch = fmdSlideClass(openingTag);

    if (!classMatch) continue;

    const styleMatch = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(openingTag);
    if (styleMatch) {
      const style = styleMatch[2];
      if (/(?:^|;)\s*padding\s*:/i.test(style)) return html;

      const nextStyle = `padding: 64px 80px;${
        style.startsWith(" ") ? "" : " "
      }${style}`;
      // Splice by index: String.replace misplaces an empty value and expands `$` patterns.
      const valueStart =
        styleMatch.index + styleMatch[0].indexOf(styleMatch[1]) + 1;
      const nextOpeningTag =
        openingTag.slice(0, valueStart) +
        nextStyle +
        openingTag.slice(valueStart + style.length);

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
