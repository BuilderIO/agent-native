import { z } from "zod";

const reactionBucketsSchema = z.record(z.string(), z.array(z.string()));

export interface SlideCommentReaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

export type SlideCommentReactionBuckets = Record<string, string[]>;

export function parseSlideCommentReactionBuckets(
  value: string | null | undefined,
): SlideCommentReactionBuckets {
  const parsed: unknown = JSON.parse(value || "{}");
  const result = reactionBucketsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Slide comment reactions contain invalid JSON");
  }
  return result.data;
}

export function summarizeSlideCommentReactions(
  value: string | null | undefined,
  viewerEmail?: string | null,
): SlideCommentReaction[] {
  const normalizedViewer = viewerEmail?.trim().toLowerCase();
  return Object.entries(parseSlideCommentReactionBuckets(value))
    .map(([emoji, emails]) => ({
      emoji,
      count: emails.length,
      reacted: normalizedViewer
        ? emails.some(
            (email) => email.trim().toLowerCase() === normalizedViewer,
          )
        : false,
    }))
    .filter((reaction) => reaction.count > 0)
    .sort((a, b) => a.emoji.localeCompare(b.emoji));
}

export function serializeSlideCommentReactionBuckets(
  reactions: SlideCommentReactionBuckets,
): string {
  return JSON.stringify(reactions);
}
