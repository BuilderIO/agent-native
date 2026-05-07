// Page-sized pastes turn into a `Pasted text` attachment chip instead of being
// dumped into the editor. Short paragraphs and everyday lists should stay
// inline so the composer still feels like a normal text field.
const PASTED_TEXT_MIN_CHARS = 3200;
const PASTED_TEXT_MIN_LINES = 24;

const PASTED_TEXT_FILENAME_PREFIX = "pasted-text-";

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

export function createPastedTextFile(text: string): File {
  const name = `${PASTED_TEXT_FILENAME_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.txt`;
  return new File([text], name, { type: "text/plain" });
}

export function isPastedTextAttachmentName(name: string | undefined): boolean {
  return !!name && name.startsWith(PASTED_TEXT_FILENAME_PREFIX);
}

// Strips the `<attachment name=...>\n` / `\n</attachment>` envelope that
// SimpleTextAttachmentAdapter wraps the file body in when sending. Returns the
// raw body for previewing.
export function unwrapAttachmentEnvelope(text: string): string {
  const match = text.match(
    /^<attachment name=[^>]+>\n([\s\S]*)\n<\/attachment>$/,
  );
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
