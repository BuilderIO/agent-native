const PASTED_TEXT_MIN_CHARS = 3200;
const PASTED_TEXT_MIN_LINES = 24;

const PASTED_TEXT_FILENAME_PREFIX = "pasted-text-";

const HTML_SOURCE_SIGNAL =
  /<!doctype\s+html|<html[\s>]|<\/[a-z][a-z0-9-]*\s*>|<(?:body|head|div|span|section|main|header|footer|nav|article|aside|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|p|a|img|button|input|textarea|select|form|label|script|style|link|meta|svg|canvas|template)\b/i;

const HTML_DOCUMENT_SIGNAL =
  /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;

const CODE_SOURCE_SIGNAL =
  /\bclassName=|\bimport\b|\bexport\b|=>|:\s*React\.|\buse[A-Z]\w*\(|\b(?:function|const|let|var|return|class|interface|type|enum)\b/;

function looksLikeHtml(value: string): boolean {
  if (!value || !HTML_SOURCE_SIGNAL.test(value)) return false;
  if (HTML_DOCUMENT_SIGNAL.test(value)) return true;
  if (CODE_SOURCE_SIGNAL.test(value)) return false;
  return true;
}

export interface ClipboardPaste {
  text: string;
  html?: string;
}

export function readClipboardPaste(
  data: { getData(type: string): string } | null | undefined,
): ClipboardPaste {
  const text = data?.getData("text/plain") ?? "";
  const html = data?.getData("text/html") ?? "";
  return { text, html: html.trim() ? html : undefined };
}

interface SelectedPasteBody {
  body: string;
  ext: "html" | "txt";
  type: "text/html" | "text/plain";
}

function selectPasteBody(paste: ClipboardPaste): SelectedPasteBody {
  const plain = paste.text ?? "";
  const html = paste.html ?? "";

  if (plain.trim() && looksLikeHtml(plain)) {
    return { body: plain, ext: "html", type: "text/html" };
  }

  if (!plain.trim() && looksLikeHtml(html)) {
    return { body: html, ext: "html", type: "text/html" };
  }

  return { body: plain, ext: "txt", type: "text/plain" };
}

export function shouldConvertPasteToAttachment(text: string): boolean {
  if (!text) return false;
  if (text.length >= PASTED_TEXT_MIN_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines++;
      if (lines >= PASTED_TEXT_MIN_LINES) return true;
    }
  }
  return false;
}

export function shouldConvertClipboardToAttachment(
  paste: ClipboardPaste,
): boolean {
  return shouldConvertPasteToAttachment(selectPasteBody(paste).body);
}

function pastedAttachmentName(ext: "html" | "txt"): string {
  return `${PASTED_TEXT_FILENAME_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
}

export function createPastedAttachmentFile(paste: ClipboardPaste): File {
  const { body, ext, type } = selectPasteBody(paste);
  return new File([body], pastedAttachmentName(ext), { type });
}

export function createPastedTextFile(text: string): File {
  return createPastedAttachmentFile({ text });
}

export function isPastedTextAttachmentName(name: string | undefined): boolean {
  return !!name && name.startsWith(PASTED_TEXT_FILENAME_PREFIX);
}

export function unwrapAttachmentEnvelope(text: string): string {
  const match = text.match(/^<attachment\b[^>]*>\n([\s\S]*)\n<\/attachment>$/);
  return match ? match[1] : text;
}

export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}
