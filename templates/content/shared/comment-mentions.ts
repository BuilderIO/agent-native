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
  if (
    record.kind !== undefined &&
    record.kind !== "person" &&
    record.kind !== "agent"
  ) {
    return "Comment mention kind must be person or agent";
  }
  const name = text(record.name);
  if (!name) return "Comment mention name is required";
  if (record.kind === "agent") {
    const model = text(record.model);
    if (!model) return "Comment agent mention model is required";
    for (const key of ["engine", "provider"] as const) {
      if (record[key] != null && typeof record[key] !== "string") {
        return `Comment agent mention ${key} must be a string`;
      }
    }
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
    ? `agent:${mention.model}:${mention.engine ?? ""}:${mention.provider ?? ""}`
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

export interface CommentMentionMatch {
  /** Offset of the `@` in the text. */
  start: number;
  name: string;
  mention: CommentMention;
}

const NAME_CHARACTER = /[\p{L}\p{N}_]/u;

function isNameCharacter(character: string | undefined): boolean {
  return character !== undefined && NAME_CHARACTER.test(character);
}

/**
 * Where stored mentions' `@name`s appear in the text. A name counts only as a
 * whole token, so `@Sam` is not inside `@Samantha` or `me@Sam.com`, and where
 * two names start at the same `@` the longer wins. The k-th `@name` is the
 * k-th mention listed under that name and later ones repeat the last, so two
 * people who share a name each keep their own pill. Saving and rendering both
 * use this, so a pill is drawn exactly where a saved mention is.
 */
export function findCommentMentions(
  text: string,
  mentions: readonly CommentMention[],
): CommentMentionMatch[] {
  const byName = new Map<string, CommentMention[]>();
  for (const mention of mentions) {
    if (mention.name) {
      byName.set(mention.name, [...(byName.get(mention.name) ?? []), mention]);
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const seen = new Map<string, number>();
  const matches: CommentMentionMatch[] = [];
  let start = text.indexOf("@");
  while (start !== -1) {
    const name = isNameCharacter(text[start - 1])
      ? undefined
      : names.find(
          (candidate) =>
            text.startsWith(candidate, start + 1) &&
            !(
              isNameCharacter(candidate[candidate.length - 1]) &&
              isNameCharacter(text[start + 1 + candidate.length])
            ),
        );
    if (name === undefined) {
      start = text.indexOf("@", start + 1);
      continue;
    }
    const listed = byName.get(name)!;
    const index = seen.get(name) ?? 0;
    seen.set(name, index + 1);
    matches.push({
      start,
      name,
      mention: listed[Math.min(index, listed.length - 1)]!,
    });
    start = text.indexOf("@", start + 1 + name.length);
  }
  return matches;
}

/**
 * The mentions each `@name` in the text resolves to, in text order, encoded
 * for an add or update. A name stops listing once the rest of its `@name`s
 * repeat one identity, so a person mentioned twice is stored once. Undefined
 * when nothing is mentioned.
 */
export function commentMentionsForText(
  text: string,
  mentions: readonly CommentMention[],
): string | undefined {
  const matches = findCommentMentions(text, mentions);
  const previousKey = new Map<string, string>();
  // Per name, the match where its identity last changed; later ones repeat it.
  const lastChange = new Map<string, number>();
  matches.forEach((match, index) => {
    const key = commentMentionKey(match.mention);
    if (previousKey.get(match.name) !== key) lastChange.set(match.name, index);
    previousKey.set(match.name, key);
  });
  return (
    serializeStoredCommentMentions(
      matches
        .filter((match, index) => index <= lastChange.get(match.name)!)
        .map((match) => match.mention),
    ) ?? undefined
  );
}

/**
 * Mentions no `@name` in the text resolves to: their name isn't there as a
 * whole token, or other mentions of that name already took every `@name`.
 */
export function mentionsMissingFromText(
  text: string,
  mentions: readonly CommentMention[],
): CommentMention[] {
  const resolved = new Set(
    findCommentMentions(text, mentions).map((match) =>
      commentMentionKey(match.mention),
    ),
  );
  return mentions.filter(
    (mention) => !resolved.has(commentMentionKey(mention)),
  );
}

export function personMentions(
  mentions: readonly CommentMention[],
): CommentPersonMention[] {
  return mentions.filter(
    (mention): mention is CommentPersonMention => mention.kind === "person",
  );
}
