import { defineAction } from "@agent-native/core";
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

    // Lazy import to avoid loading Notion deps in non-Notion contexts
    const {
      getNotionConnectionForOwner,
      listNotionComments,
      addNotionComment,
    } = await import("../server/lib/notion.js");
    const { getSyncLink } = await import("../server/lib/notion-sync.js");
    const owner = await getNotionDocumentOwner(documentId);

    // Check if document is linked to Notion
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

    // Pull: Notion -> Local
    //
    // Notion groups a top-level comment and all of its replies under one
    // `discussion_id` (a top-level comment's own id doubles as its
    // discussion's id). To preserve that threading locally we:
    //   1. Load the local comments already synced for this document so we
    //      can map a Notion discussion_id to the local thread root that
    //      already carries it (either as notionDiscussionId, if it was the
    //      thread root, or as notionCommentId, since a thread root's own
    //      Notion comment id equals its discussion_id).
    //   2. Walk the pulled comments twice: once to land every top-level
    //      comment (discussion_id === id) so replies always have a local
    //      parent to attach to regardless of Notion's return order, then
    //      once for replies.
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

    // Maps a Notion discussion_id to the local thread's root comment (id +
    // threadId), so a reply pulled before or after its root in Notion's
    // response can still find where to attach.
    const threadRootByDiscussionId = new Map<
      string,
      { id: string; threadId: string }
    >();
    for (const [notionCommentId, local] of existingByNotionId) {
      if (local.parentId === null) {
        // A thread root's own Notion comment id is its discussion's id.
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
        // The thread root isn't (and couldn't be) synced locally — e.g. it
        // lives outside this comment list or was filtered out above.
        // Preserving the reply as an orphaned top-level comment beats
        // dropping it, but it will re-attach correctly if the root
        // shows up on a later sync.
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

    // Push: Local -> Notion
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
    // Push thread roots before their replies so a brand-new thread (root +
    // reply both unsynced in the same run) establishes a discussion_id
    // before the reply needs it, regardless of the DB's natural row order.
    const localComments = [
      ...unsortedLocalComments.filter((c) => c.parentId === null),
      ...unsortedLocalComments.filter((c) => c.parentId !== null),
    ];
    let pushed = 0;

    // Thread roots keyed by threadId, so a reply being pushed can look up
    // its root's stored notion_discussion_id (or the discussion id just
    // established by pushing that root in this same run).
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
        // If this was a fresh top-level comment, remember its new discussion
        // id so any of its replies pushed later in this same run thread
        // correctly without a second DB round-trip.
        if (!isReply) {
          rootDiscussionIdByThreadId.set(lc.threadId, created.discussionId);
        }
        pushed++;
      }
    }

    return { pulled, pushed };
  },
});
