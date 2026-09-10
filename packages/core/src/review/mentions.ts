import type { ReviewMention } from "./types.js";

const MAILTO_MENTION_PATTERN = /@\[([^\]]+)\]\(mailto:([^)]+)\)/g;

export function extractReviewMentions(body: string): ReviewMention[] {
  const mentions: ReviewMention[] = [];
  for (const match of body.matchAll(MAILTO_MENTION_PATTERN)) {
    const label = match[1]?.trim();
    const email = match[2]?.trim().toLowerCase();
    if (label && email) {
      mentions.push({ label, email });
    }
  }
  return normalizeReviewMentions(mentions);
}

export function normalizeReviewMentions(
  mentions: ReviewMention[] | null | undefined,
): ReviewMention[] {
  if (!mentions?.length) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: ReviewMention[] = [];
  for (const mention of mentions) {
    const label = mention.label?.trim();
    const email = mention.email?.trim().toLowerCase() || null;
    const id = mention.id?.trim() || null;
    if (!label && !email && !id) {
      continue;
    }
    const key = email ?? id ?? label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      label: label || email || id || "Unknown",
      email,
      id,
    });
  }
  return normalized;
}
