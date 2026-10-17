import type { DbExec } from "@agent-native/core/db";

import { ACTIVE_COMMENT_AI_STATUSES } from "../../shared/comment-ai.js";
import {
  commentAnchorText,
  commentQuoteFollower,
  type CommentQuoteAnchor,
} from "../../shared/comment-reanchor.js";

// Open tabs keep a comment's highlight on its text as edits land, but a tab
// that opens the page later resolves the stored anchor afresh. Where the
// quoted words appear more than once, context captured before the edits can
// resolve to another copy than the one open tabs show. Following the stored
// anchor with every body commit keeps the two on the same copy.

export type CommentAnchorFollowInput = {
  documentId: string;
  /** The page's Markdown before the commit. */
  before: string;
  /** The page's Markdown the commit writes. */
  after: string;
};

/**
 * Moves the stored anchors of the comments whose quotes one commit of a page
 * left intact. Run it in the commit's transaction while holding the page row.
 * A quote the commit cut into keeps its anchor, since only an accepted
 * suggestion re-anchors a quote. Threads with a Comment AI request in
 * progress are skipped, because the request has a digest of their anchors.
 * Returns the ids of the comments it moved.
 */
export async function followCommentAnchors(
  tx: DbExec,
  input: CommentAnchorFollowInput,
): Promise<string[]> {
  if (input.before === input.after) return [];
  const rows = (
    await tx.execute({
      sql: `SELECT c.id,c.quoted_text,c.anchor_prefix,c.anchor_suffix,c.anchor_start_offset
            FROM document_comments c
            WHERE c.document_id = ? AND c.quoted_text IS NOT NULL AND c.quoted_text <> ''
              AND NOT EXISTS (
                SELECT 1 FROM comment_ai_requests r
                WHERE r.document_id = c.document_id AND r.thread_id = c.thread_id
                  AND r.status IN (${ACTIVE_COMMENT_AI_STATUSES.map(() => "?").join(",")})
              )
            ORDER BY c.id`,
      args: [input.documentId, ...ACTIVE_COMMENT_AI_STATUSES],
    })
  ).rows;
  if (!rows.length) return [];

  const follow = commentQuoteFollower(
    commentAnchorText(input.before),
    commentAnchorText(input.after),
  );
  const moves: {
    id: string;
    from: CommentQuoteAnchor;
    to: CommentQuoteAnchor;
  }[] = [];
  for (const row of rows) {
    const from: CommentQuoteAnchor = {
      quotedText: String(row.quoted_text),
      prefix: row.anchor_prefix == null ? null : String(row.anchor_prefix),
      suffix: row.anchor_suffix == null ? null : String(row.anchor_suffix),
      startOffset:
        row.anchor_start_offset == null
          ? null
          : Number(row.anchor_start_offset),
    };
    const outcome = follow(from);
    if (outcome.kind === "moved")
      moves.push({ id: String(row.id), from, to: outcome.quote });
  }
  if (!moves.length) return [];

  // One statement, because this runs in every body commit while the page row
  // is held. An anchor another writer changed since the read is theirs to keep.
  // updated_at stays: moving an anchor is not an edit of the comment.
  const updated = await tx.execute({
    sql: `UPDATE document_comments AS c
          SET anchor_prefix = v.prefix, anchor_suffix = v.suffix, anchor_start_offset = v.start_offset
          FROM (VALUES ${moves.map(() => "(?, ?, ?, ?, CAST(? AS integer), ?, ?, CAST(? AS integer))").join(", ")})
            AS v(id, quoted_text, prefix, suffix, start_offset, old_prefix, old_suffix, old_start_offset)
          WHERE c.id = v.id AND c.document_id = ? AND c.quoted_text = v.quoted_text
            AND c.anchor_prefix IS NOT DISTINCT FROM v.old_prefix
            AND c.anchor_suffix IS NOT DISTINCT FROM v.old_suffix
            AND c.anchor_start_offset IS NOT DISTINCT FROM v.old_start_offset
          RETURNING c.id`,
    args: [
      ...moves.flatMap(({ id, from, to }) => [
        id,
        from.quotedText,
        to.prefix,
        to.suffix,
        to.startOffset,
        from.prefix,
        from.suffix,
        from.startOffset,
      ]),
      input.documentId,
    ],
  });
  return updated.rows.map((row) => String(row.id)).sort();
}
