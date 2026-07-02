export interface ImportResult {
  designId?: string;
  files?: Array<{ id: string; filename: string }>;
  warnings?: string[];
  error?: string;
}

export const VISUAL_EDIT_CONNECT_COMMAND =
  "npx @agent-native/core@latest design connect";

export function hasFigmaClipboardPayload(value: string): boolean {
  return /<[^>]+\sdata-(metadata|buffer)=["'][^"']*\((figmeta|figma)\)[^"']*["']/i.test(
    value,
  );
}

export function looksLikeStandaloneHtml(value: string): boolean {
  return /<(html|body|main|section|div|article|header|footer|button|img)\b/i.test(
    value,
  );
}

export function getFigmaClipboardContent(
  clipboardData: Pick<DataTransfer, "getData"> | null | undefined,
): string | null {
  if (!clipboardData) return null;
  const html = clipboardData.getData("text/html");
  if (html && hasFigmaClipboardPayload(html)) return html;
  const text = clipboardData.getData("text/plain");
  if (text && hasFigmaClipboardPayload(text)) return text;
  return null;
}

export function importResultSummary(
  result: ImportResult | undefined,
  fallback: string,
) {
  const count = result?.files?.length ?? 0;
  if (count === 0) return fallback;
  if (count === 1) return `Imported ${result!.files![0]!.filename}.`;
  return `Imported ${count} screens.`;
}
