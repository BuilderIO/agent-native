import { defineAction } from "@agent-native/core";
import { getCurrentOwnerEmail } from "../server/lib/documents.js";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Sync comments bidirectionally with Notion. Pulls new Notion comments and pushes local ones.",
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
    const owner = getCurrentOwnerEmail();

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
    const notionComments = await listNotionComments(notionPageId, accessToken);
    let pulled = 0;

    for (const nc of notionComments) {
      const text = nc.rich_text.map((r) => r.plain_text).join("");
      if (!text) continue;

      const existing = await db
        .select({ id: schema.documentComments.id })
        .from(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.notionCommentId, nc.id),
            eq(schema.documentComments.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

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
      });
      pulled++;
    }

    // Push: Local -> Notion
    const localComments = await db
      .select({
        id: schema.documentComments.id,
        content: schema.documentComments.content,
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
    let pushed = 0;

    for (const lc of localComments) {
      const notionId = await addNotionComment(
        notionPageId,
        lc.content,
        accessToken,
      );
      if (notionId) {
        await db
          .update(schema.documentComments)
          .set({ notionCommentId: notionId })
          .where(
            and(
              eq(schema.documentComments.id, lc.id),
              eq(schema.documentComments.ownerEmail, ownerEmail),
            ),
          );
        pushed++;
      }
    }

    return { pulled, pushed };
  },
});
