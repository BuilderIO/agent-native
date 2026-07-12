/**
 * Force the canonical `padding: 80px 110px` on the outer `.fmd-slide` wrapper
 * when the agent supplies slide HTML. Models drift on numeric values during
 * regeneration — most often dropping the second padding arg, which collapses
 * horizontal padding from 110px to 80px and looks like the right margin
 * shrunk. AGENTS.md treats `80px 110px` as canonical for every layout, so we
 * normalize server-side rather than trusting the model's output.
 */
export function normalizeSlidePadding(html: string): string {
  if (!html.includes('class="fmd-slide"')) return html;

  return html.replace(
    /(<div\b[^>]*\bclass="fmd-slide"[^>]*\bstyle=")([^"]*)(")/,
    (_match, before, style, after) => {
      const hasPadding = /(?:^|;)\s*padding\s*:/i.test(style);
      let nextStyle: string;
      if (hasPadding) {
        nextStyle = style.replace(
          /(^|;)\s*padding\s*:\s*[^;]*/i,
          `$1${style.startsWith("padding") ? "" : " "}padding: 80px 110px`,
        );
      } else {
        nextStyle = `padding: 80px 110px;${style.startsWith(" ") ? "" : " "}${style}`;
      }
      return `${before}${nextStyle}${after}`;
    },
  );
}
