// Page-sized pastes turn into a `Pasted text` attachment chip instead of being
// dumped into the editor. Short paragraphs and everyday lists should stay
// inline so the composer still feels like a normal text field.
const PASTED_TEXT_MIN_CHARS = 3200;
const PASTED_TEXT_MIN_LINES = 24;

const PASTED_TEXT_FILENAME_PREFIX = "pasted-text-";

// A copied HTML document/source is recognizable from its markup: a closing tag
// (`</div>`), a doctype, or a common structural/element tag. We key off the
// *content* the user actually pasted, not the clipboard's `text/html` flavor —
// editors (VS Code) and rich-text apps (Google Docs) populate `text/html` with
// syntax-highlight spans or formatting wrappers even when the real content is
// plain code/prose, so trusting `text/html` blindly would mangle those pastes.
const HTML_SOURCE_SIGNAL =
  /<!doctype\s+html|<html[\s>]|<\/[a-z][a-z0-9-]*\s*>|<(?:body|head|div|span|section|main|header|footer|nav|article|aside|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|p|a|img|button|input|textarea|select|form|label|script|style|link|meta|svg|canvas|template)\b/i;

// A real HTML *document* announces itself with a doctype / html / head / body.
// When one of these is present we keep the HTML classification even if an inline
// <script> contains JS keywords — it's a genuine page.
const HTML_DOCUMENT_SIGNAL =
  /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;

// JSX/TSX source contains the same `</div>`/`<span>` tags as an HTML document,
// so the HTML tag signal alone misfiles a pasted React/TS component (even a bare
// function component) as an `.html` artifact — the agent then mishandles it as a
// hostable document instead of source. These markers appear in JS/TS/JSX source
// but not in a plain HTML *fragment*: `className=` (JSX uses it; HTML uses
// `class=`), ES module import/export, arrow functions, TS type/React annotations,
// React hooks, and the basic JS declaration/return keywords that make up a
// component body.
const CODE_SOURCE_SIGNAL =
  /\bclassName=|\bimport\b|\bexport\b|=>|:\s*React\.|\buse[A-Z]\w*\(|\b(?:function|const|let|var|return|class|interface|type|enum)\b/;

function looksLikeHtml(value: string): boolean {
  if (!value || !HTML_SOURCE_SIGNAL.test(value)) return false;
  // A self-announcing HTML document stays HTML even if it embeds a <script>.
  if (HTML_DOCUMENT_SIGNAL.test(value)) return true;
  // Otherwise it's a bare fragment — if it carries JS/TS/JSX code signals,
  // treat it as source code, not an HTML attachment.
  if (CODE_SOURCE_SIGNAL.test(value)) return false;
  return true;
}

/** The clipboard flavors we care about for a paste. */
export interface ClipboardPaste {
  /** `text/plain` flavor — used for size heuristics and as the default body. */
  text: string;
  /** `text/html` flavor when the source provided one. */
  html?: string;
}

/** Read the relevant clipboard flavors from a paste/drop DataTransfer. */
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

// Decide what to actually store for a paste. Preserving HTML markup means a
// pasted HTML document behaves exactly like uploading that .html file: the agent
// recognizes it as a hostable artifact and reads it verbatim via
// `contentFromAttachment` instead of retyping it inline (which cuts off
// mid-stream on large files and triggers a continuation loop / "spin").
function selectPasteBody(paste: ClipboardPaste): SelectedPasteBody {
  const plain = paste.text ?? "";
  const html = paste.html ?? "";

  // 1) The pasted text is itself HTML source (copied from an editor, a file, or
  //    view-source). The plain text *is* the markup, so keep it as .html.
  if (plain.trim() && looksLikeHtml(plain)) {
    return { body: plain, ext: "html", type: "text/html" };
  }

  // 2) No usable plain text, but a real HTML flavor exists (some apps only
  //    expose text/html). Fall back to the markup so nothing is dropped.
  if (!plain.trim() && looksLikeHtml(html)) {
    return { body: html, ext: "html", type: "text/html" };
  }

  // 3) Default: keep the clean plain text. Avoids the syntax-highlight /
  //    rich-text noise that lives in text/html when the plain text is already
  //    the real content (code from an editor, prose from a doc).
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

/**
 * Whether a clipboard paste is large enough to become a `Pasted text`
 * attachment chip. Mirrors `shouldConvertPasteToAttachment` but evaluates the
 * representation we'd actually store, so an HTML-only paste (empty text/plain)
 * still converts on the strength of its markup.
 */
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

/**
 * Build the attachment File for a page-sized paste, preserving HTML markup when
 * the pasted content is an HTML document so it travels the same rail as an
 * uploaded .html file.
 */
export function createPastedAttachmentFile(paste: ClipboardPaste): File {
  const { body, ext, type } = selectPasteBody(paste);
  return new File([body], pastedAttachmentName(ext), { type });
}

/** Back-compat helper for callers that only have plain text. */
export function createPastedTextFile(text: string): File {
  return createPastedAttachmentFile({ text });
}

export function isPastedTextAttachmentName(name: string | undefined): boolean {
  return !!name && name.startsWith(PASTED_TEXT_FILENAME_PREFIX);
}

// Strips the `<attachment name=...>\n` / `\n</attachment>` envelope that
// SimpleTextAttachmentAdapter wraps the file body in when sending. Returns the
// raw body for previewing.
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
