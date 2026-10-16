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

// The matcher walks up to a name's length from each `@`, so this bounds its
// work. A display name, or an email standing in for one, fits well within it.
const MAX_MENTION_NAME_LENGTH = 256;

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
  if (name.length > MAX_MENTION_NAME_LENGTH) {
    return `Comment mention name must be at most ${MAX_MENTION_NAME_LENGTH} characters`;
  }
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

// Read by code point: a letter past U+FFFF is two code units, and a combining
// mark continues the name it follows.
const NAME_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

function isNameCharacterAt(text: string, at: number): boolean {
  const code = text.codePointAt(at);
  return code !== undefined && NAME_CHARACTER.test(String.fromCodePoint(code));
}

function isNameCharacterBefore(text: string, at: number): boolean {
  if (at <= 0) return false;
  return isNameCharacterAt(
    text,
    at >= 2 && text.codePointAt(at - 2)! > 0xffff ? at - 2 : at - 1,
  );
}

/**
 * Whether the `@` at `at` follows a name character, as in `me@Sam.com`, so it
 * belongs to a word rather than starting a mention.
 */
export function followsNameCharacter(text: string, at: number): boolean {
  return isNameCharacterBefore(text, at);
}

// `//` starts a URL with or without its scheme, as in `//x.com/@Sam`. A bare
// domain followed by a path, query, or fragment, as in `github.com/@Sam` or
// `x.com?u=@Sam`, counts at the run's start. Anchoring it there keeps it
// linear; tried at every dot, its backtracking would be quadratic in a run
// like `a.a.a.a`.
const URL_START = /\/\/|\bwww\.|^[("'<[]*(?:[a-z\d-]+\.)+[a-z]{2,}[/?#]/i;

/**
 * Markdown's links, label and target: inline, as in `[@Sam](x.com/@Sam)`, and
 * by reference, as in `[@Sam][profile]` or `[@Sam]`, when the text defines
 * that label (a definition's own `[label]:` counts too). A label holds no
 * brackets and nothing spans a line. Parentheses are paired in one pass, so a
 * destination may nest them, as in `x.com/Sam_(name)`, without a rescan per
 * `(`.
 */
function linkSpans(text: string): { start: number; end: number }[] {
  const closeOf = new Map<number, number>();
  const open: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "\n") open.length = 0;
    else if (char === "(") open.push(at);
    else if (char === ")" && open.length) closeOf.set(open.pop()!, at);
  }
  const defined = new Set(
    [...text.matchAll(/^ {0,3}\[([^[\]\n]+)\]:/gm)].map((definition) =>
      referenceKey(definition[1]!),
    ),
  );
  const spans: { start: number; end: number }[] = [];
  for (const link of text.matchAll(/\[([^[\]\n]*)\](?:\[([^[\]\n]*)\]|\()?/g)) {
    const [whole, label, reference] = link;
    const opensDestination = whole.endsWith("(");
    const close = opensDestination
      ? closeOf.get(link.index + whole.length - 1)
      : undefined;
    if (close !== undefined) {
      spans.push({ start: link.index, end: close + 1 });
    } else if (defined.has(referenceKey(reference || label!))) {
      spans.push({
        start: link.index,
        end: link.index + whole.length - (opensDestination ? 1 : 0),
      });
    }
  }
  return spans;
}

/** A reference label as Markdown matches it: trimmed, spaced, any case. */
function referenceKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Where URLs run in the text, as in `https://x.com/@Sam`: from just past a URL
 * start to the next whitespace.
 */
function urlRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const run of text.matchAll(/\S+/g)) {
    const url = URL_START.exec(run[0]);
    if (url) {
      ranges.push({
        start: run.index + url.index + url[0].length,
        end: run.index + run[0].length,
      });
    }
  }
  return ranges;
}

/**
 * Markdown's inline code spans: a run of backticks through the next run of the
 * same length. A run nothing closes is literal backticks.
 */
function codeSpans(text: string): { start: number; end: number }[] {
  const runs = [...text.matchAll(/`+/g)];
  const nextOfLength: number[] = [];
  const later = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const length = runs[index]![0].length;
    nextOfLength[index] = later.get(length) ?? -1;
    later.set(length, index);
  }
  const spans: { start: number; end: number }[] = [];
  for (let open = 0; open < runs.length; open += 1) {
    const close = nextOfLength[open]!;
    if (close === -1) continue;
    spans.push({
      start: runs[open]!.index,
      end: runs[close]!.index + runs[close]![0].length,
    });
    open = close;
  }
  return spans;
}

/**
 * Tests whether an `@` in `text` is literal: in inline code, a Markdown link,
 * or a URL, where it is code, a link, or part of the address, never a mention.
 * Every comment write runs this, so it reads the text once; a scan per `@` is
 * quadratic in a long run of `@`s.
 */
export function literalAtSignTest(text: string): (at: number) => boolean {
  const literal = new Uint8Array(text.length);
  for (const span of codeSpans(text)) literal.fill(1, span.start + 1, span.end);
  for (const link of linkSpans(text)) literal.fill(1, link.start, link.end);
  for (const url of urlRanges(text)) literal.fill(1, url.start, url.end);
  return (at) => literal[at] === 1;
}

/**
 * Whether `@name` at `at` is the whole name, so `@Sam` is not the start of
 * `@Samantha`.
 */
export function isMentionNameAt(
  text: string,
  at: number,
  name: string,
): boolean {
  return (
    text.startsWith(name, at + 1) &&
    !(
      isNameCharacterBefore(name, name.length) &&
      isNameCharacterAt(text, at + 1 + name.length)
    )
  );
}

interface NameNode {
  next: Map<string, NameNode>;
  name?: string;
}

function nameTrie(names: Iterable<string>): NameNode {
  const root: NameNode = { next: new Map() };
  for (const name of names) {
    let node = root;
    for (let index = 0; index < name.length; index += 1) {
      let next = node.next.get(name[index]!);
      if (!next) {
        next = { next: new Map() };
        node.next.set(name[index]!, next);
      }
      node = next;
    }
    node.name = name;
  }
  return root;
}

/**
 * The longest listed name that the `@` at `at` spells as a whole name. One walk
 * from the `@` reads every name at once, so a long list costs no more per `@`
 * than its longest name.
 */
function longestNameAt(
  names: NameNode,
  text: string,
  at: number,
): string | undefined {
  let node = names;
  let longest: string | undefined;
  for (let index = at + 1; index < text.length; index += 1) {
    const next = node.next.get(text[index]!);
    if (!next) break;
    node = next;
    if (
      node.name !== undefined &&
      !(
        isNameCharacterBefore(text, index + 1) &&
        isNameCharacterAt(text, index + 1)
      )
    ) {
      longest = node.name;
    }
  }
  return longest;
}

/**
 * Where stored mentions' `@name`s appear in the text. A name counts only as a
 * whole token, so `@Sam` is not inside `@Samantha` or `me@Sam.com`, and where
 * two names start at the same `@` the longer wins. An `@name` in inline code
 * or a URL is code or part of the address, never a mention. The k-th `@name`
 * is the k-th mention listed under that name and later ones repeat the last,
 * so two people who share a name each keep their own pill. Saving and
 * rendering both use this, so a pill is drawn exactly where a saved mention
 * is.
 */
export function findCommentMentions(
  text: string,
  mentions: readonly CommentMention[],
): CommentMentionMatch[] {
  const byName = new Map<string, CommentMention[]>();
  for (const mention of mentions) {
    if (!mention.name) continue;
    const listed = byName.get(mention.name);
    if (listed) listed.push(mention);
    else byName.set(mention.name, [mention]);
  }
  if (!byName.size) return [];
  const names = nameTrie(byName.keys());
  const isLiteral = literalAtSignTest(text);
  const seen = new Map<string, number>();
  const matches: CommentMentionMatch[] = [];
  let start = text.indexOf("@");
  while (start !== -1) {
    const name =
      followsNameCharacter(text, start) || isLiteral(start)
        ? undefined
        : longestNameAt(names, text, start);
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
