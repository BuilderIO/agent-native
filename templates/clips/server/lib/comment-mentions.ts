import { isOrgMember } from "@agent-native/core/org";

import {
  normalizeCommentMentions,
  type CommentMention,
} from "../../shared/comment-mentions.js";

export async function resolveCommentMentions(
  value: unknown,
  organizationId: string,
): Promise<CommentMention[]> {
  const mentions = normalizeCommentMentions(value);
  if (!organizationId || mentions.length === 0) return [];

  const membership = await Promise.all(
    mentions.map(async (mention) =>
      (await isOrgMember(organizationId, mention.email)) ? mention : null,
    ),
  );
  return membership.filter(
    (mention): mention is CommentMention => mention !== null,
  );
}
