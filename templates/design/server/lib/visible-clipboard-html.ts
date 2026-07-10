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
    fallbackHtml: fallbackHtml || undefined,
  };
}
