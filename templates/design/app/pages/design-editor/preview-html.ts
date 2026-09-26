export function externalPreviewUrlForContent(content: string): string | null {
  const trimmed = content.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    // coercion-ok: a non-parseable string is "not an external URL", which is
    // exactly what the null return means to every caller here.
    return null;
  }
}

export function fullPreviewHtml(content: string): string {
  const trimmed = content.trim();
  if (/<!doctype html|<html[\s>]/i.test(trimmed)) return content;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${content}</body></html>`;
}
