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
  /** Null when two stored identities share the name: no position says which. */
  mention: CommentMention | null;
}

const NAME_CHARACTER = /[\p{L}\p{N}_]/u;

function isNameCharacter(character: string | undefined): boolean {
  return character !== undefined && NAME_CHARACTER.test(character);
}

/** Each name's identity, or null when two identities share it. */
function identitiesByName(
  mentions: readonly CommentMention[],
): Map<string, CommentMention | null> {
  const byName = new Map<string, CommentMention | null>();
  for (const mention of mentions) {
    if (!mention.name) continue;
    const known = byName.get(mention.name);
    byName.set(
      mention.name,
      known === undefined ||
        (known && commentMentionKey(known) === commentMentionKey(mention))
        ? mention
        : null,
    );
  }
  return byName;
}

/**
 * Where stored mentions' `@name`s appear in the text. A name counts only as a
 * whole token, so `@Sam` is not inside `@Samantha` or `me@Sam.com`, and where
 * two names start at the same `@` the longer wins. Saving and rendering both
 * use this, so a pill is drawn exactly where a saved mention is.
 */
export function findCommentMentions(
  text: string,
  mentions: readonly CommentMention[],
): CommentMentionMatch[] {
  const byName = identitiesByName(mentions);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
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
    matches.push({ start, name, mention: byName.get(name) ?? null });
    start = text.indexOf("@", start + 1 + name.length);
  }
  return matches;
}

/**
 * The mentions whose `@name` still appears in the text, once each, encoded
 * for an add or update. Undefined when nothing is mentioned. A name two
 * identities share is kept, so rendering never reads a shorter name inside it.
 */
export function commentMentionsForText(
  text: string,
  mentions: readonly CommentMention[],
): string | undefined {
  const named = new Set(
    findCommentMentions(text, mentions).map((match) => match.name),
  );
  const seen = new Set<string>();
  const present = mentions.filter((mention) => {
    const key = commentMentionKey(mention);
    if (seen.has(key) || !named.has(mention.name)) return false;
    seen.add(key);
    return true;
  });
  return serializeStoredCommentMentions(present) ?? undefined;
}

/** Mentions whose `@name` the text doesn't contain as a whole token. */
export function mentionsMissingFromText(
  text: string,
  mentions: readonly CommentMention[],
): CommentMention[] {
  const named = new Set(
    findCommentMentions(text, mentions).map((match) => match.name),
  );
  return mentions.filter((mention) => !named.has(mention.name));
}

/**
 * The people a comment notifies. A name two people share renders as text, and
 * a draft keeps people whose chips were deleted, so it can't say which one is
 * meant: it notifies neither.
 */
export function notifiedPeople(
  mentions: readonly CommentMention[],
): CommentPersonMention[] {
  const byName = identitiesByName(mentions);
  return personMentions(mentions).filter(
    (mention) => byName.get(mention.name) !== null,
  );
}

export function personMentions(
  mentions: readonly CommentMention[],
): CommentPersonMention[] {
  return mentions.filter(
    (mention): mention is CommentPersonMention => mention.kind === "person",
  );
}
