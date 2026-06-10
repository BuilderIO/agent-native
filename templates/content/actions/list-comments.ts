import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

type Mention = { email: string; name: string };

function parseMentions(value: string | null): Mention[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const mentions: Mention[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const email = (entry as Record<string, unknown>).email;
      const name = (entry as Record<string, unknown>).name;
      if (typeof email !== "string" || !email) continue;
      mentions.push({
        email,
        name: typeof name === "string" ? name : "",
      });
    }
    return mentions;
  } catch {
    return [];
  }
}

export default defineAction({
  description: "List all comments on a document, grouped by thread.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const documentId = args.documentId;
    if (!documentId) throw new Error("--documentId is required");

    const access = await assertAccess("document", documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(asc(schema.documentComments.createdAt));

    const mapped = rows.map((row) => ({
      id: row.id,
      document_id: row.documentId,
      thread_id: row.threadId,
      parent_id: row.parentId,
      content: row.content,
      quoted_text: row.quotedText,
      anchor_prefix: row.anchorPrefix,
      anchor_suffix: row.anchorSuffix,
      anchor_start_offset:
        row.anchorStartOffset == null ? null : Number(row.anchorStartOffset),
      mentions: parseMentions(row.mentionsJson),
      author_email: row.authorEmail,
      author_name: row.authorName,
      resolved: row.resolved,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      notion_comment_id: row.notionCommentId,
    }));

    return { comments: mapped };
  },
});
