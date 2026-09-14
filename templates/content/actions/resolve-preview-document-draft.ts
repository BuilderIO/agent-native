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

const durableClaimPayload = z.object({
  choice: z.enum(["keep_mine", "use_saved", "save_separately"]),
  status: z.enum(["claimed", "resolved"]),
  draftId: z.string().min(1),
  baseDocumentUpdatedAt: z.string().nullable(),
  loadedContentWasEmpty: z.number().int(),
  deferredReason: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

function conflict(message: string, details?: Record<string, unknown>): never {
  throw new ActionContractError(message, {
    errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
    statusCode: 409,
    details,
  });
}

async function recoveryDocumentId(args: {
  documentId: string;
  expectedDraftVersion: number;
  expectedDraftTitle: string;
  expectedDraftContent: string;
  ownerEmail: string;
  orgId: string;
}): Promise<string> {
  const input = JSON.stringify([
    args.ownerEmail,
    args.orgId,
    args.documentId,
    args.expectedDraftVersion,
    args.expectedDraftTitle,
    args.expectedDraftContent,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return `recovery-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 32)}`;
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
    const recoveryId = await recoveryDocumentId({
      ...args,
      ownerEmail: userEmail,
      orgId,
    });
    const claimId = `draft-claim-${recoveryId.slice("recovery-".length)}`;
    const claimDocumentId =
      ownerEmail === userEmail ? args.documentId : claimId;
    const draftFilter = and(
      eq(schema.documentPreviewDrafts.ownerEmail, userEmail),
      eq(schema.documentPreviewDrafts.orgId, orgId),
      eq(schema.documentPreviewDrafts.documentId, args.documentId),
      eq(schema.documentPreviewDrafts.version, args.expectedDraftVersion),
      eq(schema.documentPreviewDrafts.title, args.expectedDraftTitle),
      eq(schema.documentPreviewDrafts.content, args.expectedDraftContent),
    );
    const claimExactDraft = async () => {
      return db.transaction(async (tx) => {
        const [draft] = await tx
          .select()
          .from(schema.documentPreviewDrafts)
          .where(draftFilter)
          .for("update")
          .limit(1);
        if (!draft) {
          const [claim] = await tx
            .select()
            .from(schema.documentVersions)
            .where(
              and(
                eq(schema.documentVersions.id, claimId),
                eq(schema.documentVersions.ownerEmail, userEmail),
                eq(schema.documentVersions.documentId, claimDocumentId),
              ),
            )
            .limit(1);
          if (
            !claim ||
            claim.title !== args.expectedDraftTitle ||
            claim.content !== args.expectedDraftContent ||
            !claim.chatContext
          ) {
            conflict("The saved draft changed during recovery.");
          }
          const payload = durableClaimPayload.parse(
            JSON.parse(claim.chatContext),
          );
          if (payload.choice !== args.choice) {
            conflict("This draft was already resolved with another choice.");
          }
          return {
            id: payload.draftId,
            ownerEmail: userEmail,
            orgId,
            documentId: args.documentId,
            title: claim.title,
            content: claim.content,
            baseDocumentUpdatedAt: payload.baseDocumentUpdatedAt,
            loadedContentWasEmpty: payload.loadedContentWasEmpty,
            deferredReason: payload.deferredReason,
            version: args.expectedDraftVersion,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          };
        }
        const now = new Date().toISOString();
        await tx
          .insert(schema.documentVersions)
          .values({
            id: claimId,
            ownerEmail: userEmail,
            documentId: claimDocumentId,
            title: draft.title,
            content: draft.content,
            chatContext: JSON.stringify({
              choice: args.choice,
              status: "claimed",
              draftId: draft.id,
              baseDocumentUpdatedAt: draft.baseDocumentUpdatedAt,
              loadedContentWasEmpty: draft.loadedContentWasEmpty,
              deferredReason: draft.deferredReason,
              createdAt: draft.createdAt,
              updatedAt: draft.updatedAt,
            }),
            actorEmail: userEmail,
            actorKind: "human",
            origin: ctx?.caller ?? "frontend",
            groupKind: "operation",
            groupId: `draft-recovery:${draft.id}`,
            operation:
              args.choice === "use_saved"
                ? "use-saved-preview-draft"
                : `claim-preview-draft-${args.choice}`,
            checkpointKind: "recovery",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        const deleted = await tx
          .delete(schema.documentPreviewDrafts)
          .where(draftFilter)
          .returning({ id: schema.documentPreviewDrafts.id });
        if (deleted.length !== 1)
          conflict("The saved draft changed during recovery.");
        return draft;
      });
    };
    const markClaimResolved = async () => {
      const [claim] = await db
        .select({ chatContext: schema.documentVersions.chatContext })
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.id, claimId),
            eq(schema.documentVersions.ownerEmail, userEmail),
            eq(schema.documentVersions.documentId, claimDocumentId),
          ),
        )
        .limit(1);
      if (!claim?.chatContext) conflict("The recovery claim was lost.");
      const payload = durableClaimPayload.parse(JSON.parse(claim.chatContext));
      if (payload.choice !== args.choice) {
        conflict("This draft was already resolved with another choice.");
      }
      await db
        .update(schema.documentVersions)
        .set({
          chatContext: JSON.stringify({ ...payload, status: "resolved" }),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.documentVersions.id, claimId),
            eq(schema.documentVersions.ownerEmail, userEmail),
            eq(schema.documentVersions.documentId, claimDocumentId),
          ),
        );
    };
    const restoreClaimedDraft = async (
      draft: typeof schema.documentPreviewDrafts.$inferSelect,
    ) => {
      const restored = await db
        .insert(schema.documentPreviewDrafts)
        .values(draft)
        .onConflictDoNothing()
        .returning({ id: schema.documentPreviewDrafts.id });
      if (restored.length === 1) return;

      conflict(
        "A newer draft replaced this recovery draft. The claimed version was preserved in Version History.",
        { recoveryVersionId: claimId },
      );
    };
    if (args.choice === "keep_mine") {
      const draft = await claimExactDraft();
      try {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .limit(1);
        if (
          current?.title === draft.title &&
          current.content === draft.content
        ) {
          await markClaimResolved();
          return {
            status: "resolved" as const,
            choice: args.choice,
            document: current,
          };
        }
        const saved = await updateDocument.run(
          {
            id: args.documentId,
            title: draft.title,
            content: draft.content,
            baseUpdatedAt: args.expectedDocumentUpdatedAt,
            loadedUpdatedAt: draft.baseDocumentUpdatedAt ?? undefined,
            loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
            historySessionId: `draft-recovery:${draft.id}`,
            preserveLeadingTitleHeading: true,
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
        await markClaimResolved();
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
      await claimExactDraft();
      await markClaimResolved();
      return { status: "resolved" as const, choice: args.choice };
    }

    const destinationId = recoveryId;
    const findExistingRecovery = async () => {
      const [existing] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, destinationId))
        .limit(1);
      return existing &&
        existing.ownerEmail === userEmail &&
        existing.title === args.expectedDraftTitle &&
        existing.content === args.expectedDraftContent
        ? existing
        : null;
    };
    const draft = await claimExactDraft();
    const existingRecovery = await findExistingRecovery();
    if (existingRecovery) {
      await markClaimResolved();
      return {
        status: "resolved" as const,
        choice: args.choice,
        document: {
          id: existingRecovery.id,
          urlPath: `/page/${existingRecovery.id}`,
          title: existingRecovery.title,
          content: existingRecovery.content,
        },
        createdDocumentId: existingRecovery.id,
        urlPath: `/page/${existingRecovery.id}`,
      };
    }

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
        const existing = await findExistingRecovery();
        if (!existing) throw error;
        created = {
          id: existing.id,
          urlPath: `/page/${existing.id}`,
          title: existing.title,
          content: existing.content,
        };
      }
      await markClaimResolved();
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
