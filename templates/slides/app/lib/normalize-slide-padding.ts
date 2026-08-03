/**
 * Ensure the outer `.fmd-slide` wrapper has a padding declaration.
 *
 * Explicit padding is part of the slide layout, so preserve it. In particular,
 * an overflow repair often needs to reduce vertical padding; rewriting that
 * value here makes a successful-looking agent edit a no-op in the renderer.
 */
export function normalizeSlidePadding(html: string): string {
  if (!html.includes('class="fmd-slide"')) return html;

  return html.replace(
    /(<div\b[^>]*\bclass="fmd-slide"[^>]*\bstyle=")([^"]*)(")/,
    (_match, before, style, after) => {
      const hasPadding = /(?:^|;)\s*padding\s*:/i.test(style);
      const nextStyle = hasPadding
        ? style
        : `padding: 80px 110px;${style.startsWith(" ") ? "" : " "}${style}`;
      return `${before}${nextStyle}${after}`;
    },
  );
}
