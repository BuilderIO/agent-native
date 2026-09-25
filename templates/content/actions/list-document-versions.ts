import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, desc, eq, like } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentChatStartVersionId } from "../server/lib/document-history.js";
import { parseDocumentVersionChatContext } from "../server/lib/document-version-context.js";

export default defineAction({
  description: "List saved versions for a document.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID"),
    includeContent: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include full version content in the response"),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    threadId: z.string().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    if (!args.documentId) throw new Error("--documentId is required");

    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const where = and(
      eq(schema.documentVersions.documentId, args.documentId),
      eq(schema.documentVersions.ownerEmail, ownerEmail),
    );
    const versions = args.includeContent
      ? await db
          .select()
          .from(schema.documentVersions)
          .where(where)
          .orderBy(desc(schema.documentVersions.createdAt))
          .limit(args.limit)
      : await db
          .select({
            id: schema.documentVersions.id,
            documentId: schema.documentVersions.documentId,
            title: schema.documentVersions.title,
            createdAt: schema.documentVersions.createdAt,
            chatContext: schema.documentVersions.chatContext,
          })
          .from(schema.documentVersions)
          .where(where)
          .orderBy(desc(schema.documentVersions.createdAt))
          .limit(args.limit);
    const beginningVersions = args.threadId
      ? args.includeContent
        ? await db
            .select()
            .from(schema.documentVersions)
            .where(
              and(
                where,
                eq(
                  schema.documentVersions.id,
                  documentChatStartVersionId(
                    ownerEmail,
                    args.documentId,
                    args.threadId,
                  ),
                ),
              ),
            )
            .orderBy(asc(schema.documentVersions.createdAt))
            .limit(1)
        : await db
            .select({
              id: schema.documentVersions.id,
              documentId: schema.documentVersions.documentId,
              title: schema.documentVersions.title,
              createdAt: schema.documentVersions.createdAt,
              chatContext: schema.documentVersions.chatContext,
            })
            .from(schema.documentVersions)
            .where(
              and(
                where,
                eq(
                  schema.documentVersions.id,
                  documentChatStartVersionId(
                    ownerEmail,
                    args.documentId,
                    args.threadId,
                  ),
                ),
              ),
            )
            .orderBy(asc(schema.documentVersions.createdAt))
            .limit(1)
      : args.includeContent
        ? await db
            .select()
            .from(schema.documentVersions)
            .where(
              and(
                where,
                like(schema.documentVersions.chatContext, '%"phase":"start"%'),
              ),
            )
            .orderBy(desc(schema.documentVersions.createdAt))
            .limit(args.limit)
        : await db
            .select({
              id: schema.documentVersions.id,
              documentId: schema.documentVersions.documentId,
              title: schema.documentVersions.title,
              createdAt: schema.documentVersions.createdAt,
              chatContext: schema.documentVersions.chatContext,
            })
            .from(schema.documentVersions)
            .where(
              and(
                where,
                like(schema.documentVersions.chatContext, '%"phase":"start"%'),
              ),
            )
            .orderBy(desc(schema.documentVersions.createdAt))
            .limit(args.limit);
    const versionsById = new Map(
      [...beginningVersions, ...versions].map((version) => [
        version.id,
        version,
      ]),
    );

    const mergedVersions = [...versionsById.values()];
    const sortedVersions = mergedVersions.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
    const limitedVersions = sortedVersions.slice(0, args.limit);
    const activeStart = args.threadId
      ? sortedVersions.find((version) => beginningVersions.includes(version))
      : undefined;
    if (activeStart && !limitedVersions.includes(activeStart)) {
      limitedVersions[limitedVersions.length - 1] = activeStart;
      limitedVersions.sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );
    }

    return {
      versions: limitedVersions.map((version) => {
        let chatContext;
        try {
          chatContext = parseDocumentVersionChatContext(version.chatContext);
        } catch {
          chatContext = undefined;
        }
        return {
          id: version.id,
          documentId: version.documentId,
          title: version.title,
          ...(args.includeContent && "content" in version
            ? { content: version.content }
            : {}),
          createdAt: version.createdAt,
          editable: Boolean(chatContext),
          ...(chatContext ? { chatContext } : {}),
        };
      }),
    };
  },
});
