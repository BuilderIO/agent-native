const MAX_RAW_CLIPBOARD_HTML_BYTES = 64 * 1024 * 1024;
const MAX_VISIBLE_CLIPBOARD_HTML_BYTES = 2 * 1024 * 1024;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function removeHiddenClipboardData(html: string): string {
  return html
    .replace(
      /<span\b[^>]*\bdata-metadata\s*=\s*(["'])[\s\S]*?\1[^>]*>\s*<\/span>/gi,
      "",
    )
    .replace(
      /<span\b[^>]*\bdata-buffer\s*=\s*(["'])[\s\S]*?\1[^>]*>\s*<\/span>/gi,
      "",
    )
    .replace(/<!--\s*\((figmeta|figma)\)[\s\S]*?\(\/\1\)\s*-->/gi, "")
    .replace(/&lt;!--\s*\((figmeta|figma)\)[\s\S]*?\(\/\1\)\s*--&gt;/gi, "")
    .replace(/<meta\b[^>]*charset[^>]*>/gi, "")
    .trim();
}

const RENDERED_MEDIA_RE = /<(?:img|svg|video|canvas|picture|iframe)\b/i;

// Figma's current clipboard wraps its private buffer in an empty
// `<span style="white-space:pre-wrap;"></span>`; saving that makes a blank screen.
function hasVisibleContent(html: string): boolean {
  if (RENDERED_MEDIA_RE.test(html)) return true;
  const text = html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    // guard:allow-raw-color — "&#160;" is an HTML entity, not a colour.
    .replace(/&nbsp;|&#160;/g, " ");
  return text.trim().length > 0;
}

export function parseVisibleClipboardHtml(html: string): {
  fallbackHtml?: string;
} {
  if (byteLength(html) > MAX_RAW_CLIPBOARD_HTML_BYTES) {
    throw new Error(
      "Clipboard transfer data is too large to import (max 64 MB).",
    );
  }

  const fallbackHtml = removeHiddenClipboardData(html);
  if (byteLength(fallbackHtml) > MAX_VISIBLE_CLIPBOARD_HTML_BYTES) {
    throw new Error(
      "Visible clipboard HTML is too large to import (max 2 MB).",
    );
  }
  return {
    fallbackHtml: hasVisibleContent(fallbackHtml) ? fallbackHtml : undefined,
  };
}
