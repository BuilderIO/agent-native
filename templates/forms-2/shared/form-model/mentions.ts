export const MENTION_META_FIELDS = [
  "submission-id",
  "respondent-id",
  "form-name",
] as const;
export type MentionMetaField = (typeof MENTION_META_FIELDS)[number];

export type MentionRef =
  | { kind: "answer"; questionId: string }
  | { kind: "meta"; field: MentionMetaField };

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; ref: MentionRef };

const TOKEN = /\{\{(answer|meta):([^{}\s]+)\}\}/g;

export function mentionToken(ref: MentionRef): string {
  return ref.kind === "answer"
    ? `{{answer:${ref.questionId}}}`
    : `{{meta:${ref.field}}}`;
}

function refOf(kind: string, value: string): MentionRef | null {
  if (kind === "answer") return { kind, questionId: value };
  const field = MENTION_META_FIELDS.find((candidate) => candidate === value);
  return field ? { kind: "meta", field } : null;
}

/** Splits text at mention tokens. A token naming an unknown metadata field stays text. */
export function parseMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const ref = refOf(match[1] ?? "", match[2] ?? "");
    if (!ref) continue;
    if (match.index > last)
      segments.push({ type: "text", text: text.slice(last, match.index) });
    segments.push({ type: "mention", ref });
    last = match.index + match[0].length;
  }
  if (last < text.length)
    segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

export function serializeMentions(segments: readonly MentionSegment[]): string {
  return segments
    .map((segment) =>
      segment.type === "text" ? segment.text : mentionToken(segment.ref),
    )
    .join("");
}

/** The text with each mention replaced by `valueOf(ref)`. */
export function resolveMentions(
  text: string,
  valueOf: (ref: MentionRef) => string,
): string {
  if (!text.includes("{{")) return text;
  return parseMentions(text)
    .map((segment) =>
      segment.type === "text" ? segment.text : valueOf(segment.ref),
    )
    .join("");
}
