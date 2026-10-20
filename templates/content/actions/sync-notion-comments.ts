import { defineAction } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getNotionDocumentOwner } from "./_notion-action-utils.js";

export default defineAction({
  description:
    "Sync comments bidirectionally with Notion. Pulls new Notion comments (preserving reply threading) and pushes local ones.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
  }),
  http: false,
  run: async (args) => {
    const documentId = args.documentId;
    if (!documentId) throw new Error("--documentId is required");

    const {
      getNotionConnectionForOwner,
      listNotionComments,
      addNotionComment,
    } = await import("../server/lib/notion.js");
    const { getSyncLink } = await import("../server/lib/notion-sync.js");
    const owner = await getNotionDocumentOwner(documentId);

    const syncLink = await getSyncLink(documentId, owner);
    if (!syncLink) {
      return "Document is not linked to Notion. Link it first.";
    }

    const connection = await getNotionConnectionForOwner(owner);
    if (!connection) {
      return "No Notion connection. Connect to Notion first.";
    }

    const notionPageId = syncLink.remotePageId;
    const accessToken = connection.accessToken;
    const db = getDb();
    const ownerEmail = owner;

    const notionComments = await listNotionComments(notionPageId, accessToken);
    let pulled = 0;

    const existingByNotionId = new Map<
      string,
      { id: string; threadId: string; parentId: string | null }
    >();
    const existingRows = await db
      .select({
        id: schema.documentComments.id,
        threadId: schema.documentComments.threadId,
        parentId: schema.documentComments.parentId,
        notionCommentId: schema.documentComments.notionCommentId,
      })
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.ownerEmail, ownerEmail),
        ),
      );
    for (const row of existingRows) {
      if (row.notionCommentId) {
        existingByNotionId.set(row.notionCommentId, {
          id: row.id,
          threadId: row.threadId,
          parentId: row.parentId,
        });
      }
    }

    const threadRootByDiscussionId = new Map<
      string,
      { id: string; threadId: string }
    >();
    for (const [notionCommentId, local] of existingByNotionId) {
      if (local.parentId === null) {
        threadRootByDiscussionId.set(notionCommentId, {
          id: local.id,
          threadId: local.threadId,
        });
      }
    }

    const topLevel = notionComments.filter(
      (nc) => !nc.discussion_id || nc.discussion_id === nc.id,
    );
    const replies = notionComments.filter(
      (nc) => nc.discussion_id && nc.discussion_id !== nc.id,
    );

    for (const nc of topLevel) {
      const text = nc.rich_text.map((r) => r.plain_text).join("");
      if (!text) continue;
      if (existingByNotionId.has(nc.id)) continue;

      const id = Math.random().toString(36).slice(2, 14);
      await db.insert(schema.documentComments).values({
        id,
        ownerEmail,
        documentId,
        threadId: id,
        parentId: null,
        content: text,
        authorEmail: "notion@sync",
        authorName: "Notion",
        notionCommentId: nc.id,
        notionDiscussionId: nc.discussion_id ?? nc.id,
      });
      pulled++;
      threadRootByDiscussionId.set(nc.discussion_id ?? nc.id, {
        id,
        threadId: id,
      });
    }

    for (const nc of replies) {
      const text = nc.rich_text.map((r) => r.plain_text).join("");
      if (!text) continue;
      if (existingByNotionId.has(nc.id)) continue;

      const root = threadRootByDiscussionId.get(nc.discussion_id!);
      if (!root) {
        const id = Math.random().toString(36).slice(2, 14);
        await db.insert(schema.documentComments).values({
          id,
          ownerEmail,
          documentId,
          threadId: id,
          parentId: null,
          content: text,
          authorEmail: "notion@sync",
          authorName: "Notion",
          notionCommentId: nc.id,
          notionDiscussionId: nc.discussion_id ?? null,
        });
        pulled++;
        continue;
      }

      const id = Math.random().toString(36).slice(2, 14);
      await db.insert(schema.documentComments).values({
        id,
        ownerEmail,
        documentId,
        threadId: root.threadId,
        parentId: root.id,
        content: text,
        authorEmail: "notion@sync",
        authorName: "Notion",
        notionCommentId: nc.id,
        notionDiscussionId: nc.discussion_id ?? null,
      });
      pulled++;
    }

    const unsortedLocalComments = await db
      .select({
        id: schema.documentComments.id,
        content: schema.documentComments.content,
        threadId: schema.documentComments.threadId,
        parentId: schema.documentComments.parentId,
      })
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.ownerEmail, ownerEmail),
          isNull(schema.documentComments.notionCommentId),
          eq(schema.documentComments.resolved, 0),
        ),
      );
    const localComments = [
      ...unsortedLocalComments.filter((c) => c.parentId === null),
      ...unsortedLocalComments.filter((c) => c.parentId !== null),
    ];
    let pushed = 0;

    const rootDiscussionIdByThreadId = new Map<string, string | null>();

    for (const lc of localComments) {
      const isReply = lc.parentId !== null;
      let discussionId: string | null = null;

      if (isReply) {
        if (rootDiscussionIdByThreadId.has(lc.threadId)) {
          discussionId = rootDiscussionIdByThreadId.get(lc.threadId) ?? null;
        } else {
          const [root] = await db
            .select({
              notionDiscussionId: schema.documentComments.notionDiscussionId,
            })
            .from(schema.documentComments)
            .where(
              and(
                eq(schema.documentComments.documentId, documentId),
                eq(schema.documentComments.ownerEmail, ownerEmail),
                eq(schema.documentComments.threadId, lc.threadId),
                isNull(schema.documentComments.parentId),
              ),
            )
            .limit(1);
          discussionId = root?.notionDiscussionId ?? null;
          rootDiscussionIdByThreadId.set(lc.threadId, discussionId);
        }
      }

      const created = await addNotionComment(
        notionPageId,
        lc.content,
        accessToken,
        discussionId,
      );
      if (created) {
        await db
          .update(schema.documentComments)
          .set({
            notionCommentId: created.id,
            notionDiscussionId: created.discussionId,
          })
          .where(
            and(
              eq(schema.documentComments.id, lc.id),
              eq(schema.documentComments.ownerEmail, ownerEmail),
            ),
          );
        if (!isReply) {
          rootDiscussionIdByThreadId.set(lc.threadId, created.discussionId);
        }
        pushed++;
      }
    }

    return { pulled, pushed };
  },
});
