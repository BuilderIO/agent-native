/**
 * The identity behind one `@name` in a Comment. The readable `@name` stays in
 * the Comment text so every text reader (emails, Notion sync, agents, MCP)
 * keeps working; these records, stored as `document_comments.mentions_json`,
 * say who or what each name refers to. Rows written before `kind` existed
 * hold `{ email, name }`, which reads as a person.
 */
export type CommentMention = CommentPersonMention | CommentAgentMention;

export interface CommentPersonMention {
  kind: "person";
  email: string;
  name: string;
}

export interface CommentAgentMention {
  kind: "agent";
  model: string;
  engine?: string;
  provider?: string;
  name: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mentionFrom(entry: unknown): CommentMention | string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "Comment mentions metadata contains an invalid entry";
  }
  const record = entry as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  if (record.kind === "agent") {
    const model = text(record.model);
    if (!model) return "Comment agent mention model is required";
    const engine = text(record.engine);
    const provider = text(record.provider);
    return {
      kind: "agent",
      model,
      ...(engine ? { engine } : {}),
      ...(provider ? { provider } : {}),
      name,
    };
  }
  if (record.kind !== undefined && record.kind !== "person") {
    return "Comment mention kind must be person or agent";
  }
  const email = text(record.email);
  if (!email) return "Comment mention email is required";
  return { kind: "person", email, name };
}

/**
 * Parse mentions submitted with a write. Anything that is not a list of
 * mentions fails loudly: a dropped mention silently loses its notification
 * and its pill.
 */
export function parseCommentMentions(value: unknown): CommentMention[] {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error("Comment mentions metadata is not valid JSON");
    }
  }
  if (!Array.isArray(raw)) {
    throw new Error("Comment mentions metadata must be an array");
  }
  return raw.map((entry) => {
    const mention = mentionFrom(entry);
    if (typeof mention === "string") throw new Error(mention);
    return mention;
  });
}

/**
 * Read a stored `mentions_json` value. Rows predate validation, so an entry
 * that is not a mention is skipped rather than failing the whole thread; the
 * Comment's readable `@name` text still renders.
 */
export function readStoredCommentMentions(
  value: string | null | undefined,
): CommentMention[] {
  if (!value?.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    // coercion-ok: a malformed stored row keeps its readable text; only its pills are lost.
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const mention = mentionFrom(entry);
    return typeof mention === "string" ? [] : [mention];
  });
}

/** One identity per person or agent, however many times it is mentioned. */
export function commentMentionKey(mention: CommentMention): string {
  return mention.kind === "agent"
    ? `agent:${mention.model}:${mention.engine ?? ""}`
    : `person:${mention.email.trim().toLowerCase()}`;
}

/** The stored form, with a fixed key order so equal mentions compare equal. */
export function serializeStoredCommentMentions(
  mentions: readonly CommentMention[],
): string | null {
  if (!mentions.length) return null;
  return JSON.stringify(
    mentions.map((mention) =>
      mention.kind === "agent"
        ? {
            kind: "agent",
            model: mention.model,
            ...(mention.engine ? { engine: mention.engine } : {}),
            ...(mention.provider ? { provider: mention.provider } : {}),
            name: mention.name,
          }
        : { kind: "person", email: mention.email, name: mention.name },
    ),
  );
}

/**
 * The mentions whose `@name` still appears in the text, once each, encoded
 * for an add or update. Undefined when nothing is mentioned.
 */
export function commentMentionsForText(
  text: string,
  mentions: readonly CommentMention[],
): string | undefined {
  const seen = new Set<string>();
  const present = mentions.filter((mention) => {
    const key = commentMentionKey(mention);
    if (seen.has(key) || !mention.name || !text.includes(`@${mention.name}`))
      return false;
    seen.add(key);
    return true;
  });
  return serializeStoredCommentMentions(present) ?? undefined;
}

export function personMentions(
  mentions: readonly CommentMention[],
): CommentPersonMention[] {
  return mentions.filter(
    (mention): mention is CommentPersonMention => mention.kind === "person",
  );
}
