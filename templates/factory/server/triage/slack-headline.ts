/** A headline is one line a person recognises a report by, not a summary. */
export const HEADLINE_MAX_CHARS = 100;

/** Shorter than this, a cut at a word would leave too little to recognise. */
const MIN_WORD_CUT_CHARS = 40;

/**
 * What a Slack message shows of itself once its markup is gone. Mentions and
 * broadcasts are who it was sent to, and links are where it points: neither
 * says what the message is about, so they are dropped; a link's label stays.
 */
function plainLine(line: string): string {
  return line
    .replace(/<!subteam\^[^>|]*(?:\|([^>]*))?>/g, "$1")
    .replace(/<![^>]*>/g, "")
    .replace(/<@[^>]*>/g, "")
    .replace(/<#[^>|]*\|([^>]*)>/g, "#$1")
    .replace(/<#[^>]*>/g, "")
    .replace(/<(?:https?:|mailto:)[^>|]*\|([^>]*)>/g, "$1")
    .replace(/<(?:https?:|mailto:)[^>]*>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/:[a-z0-9_+-]+:/g, "")
    .replace(/`+/g, "")
    .replace(/(^|[\s(])([*_~])([^*_~\n]+)\2(?=[\s).,:;!?]|$)/g, "$1$3")
    .replace(/^\s*(?:>+\s*|[-*•]\s+|\d+[.)]\s+)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(line: string): string {
  if (line.length <= HEADLINE_MAX_CHARS) return line;
  const room = HEADLINE_MAX_CHARS - 1;
  let end = line.lastIndexOf(" ", room);
  if (end < MIN_WORD_CUT_CHARS) end = room;
  // A cut inside a surrogate pair would leave half of a character.
  const last = line.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${line.slice(0, end).trimEnd()}…`;
}

/**
 * The first line of a message that says something, without markup, links or
 * mentions, cut to {@link HEADLINE_MAX_CHARS}. Undefined when nothing of the
 * message is left (an attachment with no words): the caller keeps the author
 * label, which is the one fallback, never a made-up line.
 */
export function slackHeadline(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const plain = plainLine(line);
    if (plain !== "") return cut(plain);
  }
  return undefined;
}
