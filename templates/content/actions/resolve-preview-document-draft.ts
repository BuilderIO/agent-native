import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import createDocument from "./create-document.js";
import updateDocument, {
  type DocumentUpdateConflictResponse,
} from "./update-document.js";

const exactDraft = {
  documentId: z.string().min(1),
  expectedDraftVersion: z.number().int().positive(),
  expectedDraftTitle: z.string().max(10_000),
  expectedDraftContent: z.string().max(500_000),
};

function conflict(message: string, details?: Record<string, unknown>): never {
  throw new ActionContractError(message, {
    errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
    statusCode: 409,
    details,
  });
}

export default defineAction({
  description:
    "Resolve the current user's exact preview draft without losing either version.",
  agentTool: false,
  toolCallable: false,
  schema: z.discriminatedUnion("choice", [
    z.object({
      choice: z.literal("keep_mine"),
      ...exactDraft,
      expectedDocumentUpdatedAt: z.string().min(1),
    }),
    z.object({ choice: z.literal("use_saved"), ...exactDraft }),
    z.object({ choice: z.literal("save_separately"), ...exactDraft }),
  ]),
  run: async (args, ctx) => {
    const userEmail = getRequestUserEmail();
    const orgId = getRequestOrgId() ?? "";
    if (!userEmail) {
      throw new ActionContractError("Not authenticated.", {
        errorCode: "NOT_AUTHENTICATED",
        statusCode: 401,
      });
    }
    const access = await assertAccess("document", args.documentId, "editor");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const draftFilter = and(
      eq(schema.documentPreviewDrafts.ownerEmail, userEmail),
      eq(schema.documentPreviewDrafts.orgId, orgId),
      eq(schema.documentPreviewDrafts.documentId, args.documentId),
      eq(schema.documentPreviewDrafts.version, args.expectedDraftVersion),
      eq(schema.documentPreviewDrafts.title, args.expectedDraftTitle),
      eq(schema.documentPreviewDrafts.content, args.expectedDraftContent),
    );
    const claimExactDraft = async () => {
      const [draft] = await db
        .delete(schema.documentPreviewDrafts)
        .where(draftFilter)
        .returning();
      if (!draft) conflict("The saved draft changed during recovery.");
      return draft;
    };
    const restoreClaimedDraft = async (
      draft: typeof schema.documentPreviewDrafts.$inferSelect,
    ) => {
      await db
        .insert(schema.documentPreviewDrafts)
        .values(draft)
        .onConflictDoNothing();
    };
    if (args.choice === "keep_mine") {
      const draft = await claimExactDraft();
      try {
        const saved = await updateDocument.run(
          {
            id: args.documentId,
            title: draft.title,
            content: draft.content,
            baseUpdatedAt: args.expectedDocumentUpdatedAt,
            loadedUpdatedAt: draft.baseDocumentUpdatedAt ?? undefined,
            loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
            historySessionId: `draft-recovery:${draft.id}`,
            reuseLabels: [],
          },
          ctx,
        );
        if ((saved as DocumentUpdateConflictResponse).conflict === true) {
          await restoreClaimedDraft(draft);
          return {
            status: "document_conflict" as const,
            document: (saved as DocumentUpdateConflictResponse).document,
          };
        }
        return {
          status: "resolved" as const,
          choice: args.choice,
          document: saved,
        };
      } catch (error) {
        await restoreClaimedDraft(draft);
        throw error;
      }
    }

    if (args.choice === "use_saved") {
      const now = new Date().toISOString();
      await db.transaction(async (tx) => {
        const [lockedDraft] = await tx
          .select()
          .from(schema.documentPreviewDrafts)
          .where(draftFilter)
          .for("update")
          .limit(1);
        if (!lockedDraft) conflict("The saved draft changed during recovery.");
        await tx.insert(schema.documentVersions).values({
          id: crypto.randomUUID(),
          ownerEmail,
          documentId: args.documentId,
          title: lockedDraft.title,
          content: lockedDraft.content,
          actorEmail: userEmail,
          actorKind: "human",
          origin: ctx?.caller ?? "frontend",
          groupKind: "operation",
          groupId: `draft-recovery:${lockedDraft.id}`,
          operation: "use-saved-preview-draft",
          checkpointKind: "recovery",
          createdAt: now,
          updatedAt: now,
        });
        const deleted = await tx
          .delete(schema.documentPreviewDrafts)
          .where(draftFilter)
          .returning({ id: schema.documentPreviewDrafts.id });
        if (deleted.length !== 1)
          conflict("The saved draft changed during recovery.");
      });
      return { status: "resolved" as const, choice: args.choice };
    }

    const draft = await claimExactDraft();
    const destinationId = `recovery-${draft.id}`;
    let created;
    try {
      try {
        created = await createDocument.run(
          {
            id: destinationId,
            title: draft.title,
            content: draft.content,
            preserveLeadingTitleHeading: true,
            reuseLabels: [],
          },
          ctx,
        );
      } catch (error) {
        const [existing] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, destinationId))
          .limit(1);
        if (
          !existing ||
          existing.ownerEmail !== userEmail ||
          existing.title !== draft.title ||
          existing.content !== draft.content
        ) {
          throw error;
        }
        created = {
          id: existing.id,
          urlPath: `/page/${existing.id}`,
          title: existing.title,
          content: existing.content,
        };
      }
      return {
        status: "resolved" as const,
        choice: args.choice,
        document: created,
        createdDocumentId: created.id,
        urlPath: `/page/${created.id}`,
      };
    } catch (error) {
      await restoreClaimedDraft(draft);
      throw error;
    }
  },
});
