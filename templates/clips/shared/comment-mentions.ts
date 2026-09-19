export interface CommentMention {
  email: string;
  name: string;
}

export interface CommentMentionDisplay {
  name: string;
}

export function normalizeCommentMentions(value: unknown): CommentMention[] {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      // coercion-ok: malformed optional mention metadata is treated as absent.
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const mentions: CommentMention[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const email =
      typeof candidate.email === "string"
        ? candidate.email.trim().toLowerCase()
        : "";
    if (!email || !email.includes("@") || seen.has(email)) continue;
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    seen.add(email);
    mentions.push({
      email,
      name: name || email.split("@")[0] || email,
    });
  }
  return mentions;
}

export function parseCommentMentions(
  value: string | null | undefined,
): CommentMention[] {
  return normalizeCommentMentions(value);
}

export function displayCommentMentions(
  value: unknown,
): CommentMentionDisplay[] {
  return normalizeCommentMentions(value).map(({ name }) => ({ name }));
}

function hasMentionToken(text: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)@${escapedName}(?=$|[^\\p{L}\\p{N}_])`, "u").test(
    text,
  );
}

export function mentionsForCommentText(
  text: string,
  mentions: readonly CommentMention[],
): CommentMention[] {
  return normalizeCommentMentions(
    mentions.filter((mention) => hasMentionToken(text, mention.name)),
  );
}
