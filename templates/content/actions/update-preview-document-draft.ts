import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockPreviewDocumentDraftSettlement } from "./_preview-document-draft-settlement.js";
import { readPreviewDocumentDraft } from "./_preview-document-draft.js";

const draftPayload = z
  .object({
    title: z.string().max(10_000),
    content: z.string().max(500_000),
    baseDocumentUpdatedAt: z.string().max(100).nullable(),
    loadedContentWasEmpty: z.boolean(),
    deferredReason: z.enum(["hydration", "conflict"]).nullable(),
    editorSessionId: z.string().min(1).max(200).optional(),
    editGeneration: z.number().int().nonnegative().optional(),
  })
  .superRefine((draft, ctx) => {
    if (
      (draft.editorSessionId === undefined) !==
      (draft.editGeneration === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "editorSessionId and editGeneration must be provided together.",
      });
    }
  });

function draftId() {
  return crypto.randomUUID();
}

export default defineAction({
  description:
    "Atomically save or delete the current user's private preview draft.",
  schema: z
    .discriminatedUnion("operation", [
      z.object({
        operation: z.literal("upsert"),
        documentId: z.string().min(1),
        expectedVersion: z.number().int().positive().nullable(),
        draft: draftPayload,
      }),
      z.object({
        operation: z.literal("delete"),
        documentId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        expectedTitle: z.string().max(10_000),
        expectedContent: z.string().max(500_000),
        expectedEditorSessionId: z.string().min(1).max(200).optional(),
        expectedEditGeneration: z.number().int().nonnegative().optional(),
      }),
    ])
    .superRefine((args, ctx) => {
      if (
        args.operation === "delete" &&
        (args.expectedEditorSessionId === undefined) !==
          (args.expectedEditGeneration === undefined)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "expectedEditorSessionId and expectedEditGeneration must be provided together.",
        });
      }
    }),
  agentTool: false,
  toolCallable: false,
  run: async (args, ctx) => {
    const userEmail = getRequestUserEmail();
    const orgId = getRequestOrgId() ?? "";
    if (!userEmail) throw new Error("Not authenticated.");
    await assertAccess("document", args.documentId, "editor");
    const db = getDb();
    const ownerFilter = and(
      eq(schema.documentPreviewDrafts.ownerEmail, userEmail),
      eq(schema.documentPreviewDrafts.orgId, orgId),
      eq(schema.documentPreviewDrafts.documentId, args.documentId),
    );

    if (args.operation === "delete") {
      const deleted = await db
        .delete(schema.documentPreviewDrafts)
        .where(
          and(
            ownerFilter,
            eq(schema.documentPreviewDrafts.version, args.expectedVersion),
            eq(schema.documentPreviewDrafts.title, args.expectedTitle),
            eq(schema.documentPreviewDrafts.content, args.expectedContent),
            ...(args.expectedEditorSessionId
              ? [
                  eq(
                    schema.documentPreviewDrafts.editorSessionId,
                    args.expectedEditorSessionId,
                  ),
                ]
              : []),
            ...(args.expectedEditGeneration !== undefined
              ? [
                  eq(
                    schema.documentPreviewDrafts.editGeneration,
                    args.expectedEditGeneration,
                  ),
                ]
              : []),
          ),
        )
        .returning({ id: schema.documentPreviewDrafts.id });
      if (deleted.length > 0)
        return { status: "deleted" as const, draft: null };
      return {
        status: "conflict" as const,
        draft: await readPreviewDocumentDraft(
          userEmail,
          orgId,
          args.documentId,
        ),
      };
    }

    return db.transaction(async (tx) => {
      const now = new Date().toISOString();
      if (
        args.draft.editorSessionId !== undefined &&
        args.draft.editGeneration !== undefined
      ) {
        const settledGeneration = await lockPreviewDocumentDraftSettlement({
          db: tx,
          ownerEmail: userEmail,
          orgId,
          documentId: args.documentId,
          editorSessionId: args.draft.editorSessionId,
          now,
        });
        if (
          settledGeneration !== null &&
          args.draft.editGeneration <= settledGeneration
        ) {
          return {
            status: "superseded" as const,
            draft: await readPreviewDocumentDraft(
              userEmail,
              orgId,
              args.documentId,
              tx,
            ),
          };
        }
      }

      if (args.expectedVersion === null) {
        const inserted = await tx
          .insert(schema.documentPreviewDrafts)
          .values({
            id: draftId(),
            ownerEmail: userEmail,
            orgId,
            documentId: args.documentId,
            title: args.draft.title,
            content: args.draft.content,
            baseDocumentUpdatedAt: args.draft.baseDocumentUpdatedAt,
            loadedContentWasEmpty: args.draft.loadedContentWasEmpty ? 1 : 0,
            deferredReason: args.draft.deferredReason,
            editorSessionId: args.draft.editorSessionId,
            editGeneration: args.draft.editGeneration,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.documentPreviewDrafts.ownerEmail,
              schema.documentPreviewDrafts.orgId,
              schema.documentPreviewDrafts.documentId,
            ],
          })
          .returning({ version: schema.documentPreviewDrafts.version });
        if (inserted.length > 0) {
          return {
            status: "saved" as const,
            draft: await readPreviewDocumentDraft(
              userEmail,
              orgId,
              args.documentId,
              tx,
            ),
          };
        }
      } else {
        const updated = await tx
          .update(schema.documentPreviewDrafts)
          .set({
            title: args.draft.title,
            content: args.draft.content,
            baseDocumentUpdatedAt: args.draft.baseDocumentUpdatedAt,
            loadedContentWasEmpty: args.draft.loadedContentWasEmpty ? 1 : 0,
            deferredReason: args.draft.deferredReason,
            editorSessionId: args.draft.editorSessionId,
            editGeneration: args.draft.editGeneration,
            version: sql`${schema.documentPreviewDrafts.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              ownerFilter,
              eq(schema.documentPreviewDrafts.version, args.expectedVersion),
              ...(args.draft.editorSessionId
                ? [
                    eq(
                      schema.documentPreviewDrafts.editorSessionId,
                      args.draft.editorSessionId,
                    ),
                    lte(
                      schema.documentPreviewDrafts.editGeneration,
                      args.draft.editGeneration as number,
                    ),
                  ]
                : []),
            ),
          )
          .returning({ version: schema.documentPreviewDrafts.version });
        if (updated.length > 0) {
          return {
            status: "saved" as const,
            draft: await readPreviewDocumentDraft(
              userEmail,
              orgId,
              args.documentId,
              tx,
            ),
          };
        }
      }

      return {
        status: "conflict" as const,
        draft: await readPreviewDocumentDraft(
          userEmail,
          orgId,
          args.documentId,
          tx,
        ),
      };
    });
  },
});
