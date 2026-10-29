const UNTERMINATED_RAW_TEXT =
  /<(script|textarea|title)\b[^>]*>(?![\s\S]*<\/\1\s*>)[\s\S]*$/i;

/**
 * The part of a streaming HTML string that is safe to show now. Drops a tag,
 * comment, or entity cut off at the end, and an element whose raw text must
 * arrive whole (a script runs once, so half a script is never shown).
 */
export function renderableHtmlPrefix(html: string): string {
  let prefix = html;

  const commentStart = prefix.lastIndexOf("<!--");
  if (commentStart !== -1 && prefix.indexOf("-->", commentStart) === -1) {
    prefix = prefix.slice(0, commentStart);
  }

  const rawText = UNTERMINATED_RAW_TEXT.exec(prefix);
  if (rawText) prefix = prefix.slice(0, rawText.index);

  const lastOpen = prefix.lastIndexOf("<");
  if (lastOpen !== -1 && prefix.indexOf(">", lastOpen) === -1) {
    const next = prefix.charAt(lastOpen + 1);
    if (next === "" || /[a-zA-Z/!?]/.test(next)) {
      prefix = prefix.slice(0, lastOpen);
    }
  }

  return prefix.replace(/&#?[a-zA-Z0-9]{0,31}$/, "");
}
