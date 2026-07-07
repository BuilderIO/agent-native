const MAX_CLIPBOARD_HTML_BYTES = 2 * 1024 * 1024;

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
    .replace(/<meta\b[^>]*charset[^>]*>/gi, "")
    .trim();
}

export function parseVisibleClipboardHtml(html: string): {
  fallbackHtml?: string;
} {
  if (byteLength(html) > MAX_CLIPBOARD_HTML_BYTES) {
    throw new Error("Clipboard HTML is too large to import (max 2 MB).");
  }

  const fallbackHtml = removeHiddenClipboardData(html);
  return {
    fallbackHtml: fallbackHtml || undefined,
  };
}
