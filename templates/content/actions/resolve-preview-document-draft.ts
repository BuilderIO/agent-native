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
import { documentRevisionToken } from "./_document-edit-mutation.js";
import {
  lockPreviewDocumentDraftSettlement,
  settlePreviewDocumentDraft,
} from "./_preview-document-draft-settlement.js";
import createDocument from "./create-document.js";
import updateDocument from "./update-document.js";

const exactDraft = {
  documentId: z.string().min(1),
  expectedDraftVersion: z.number().int().positive(),
  expectedDraftTitle: z.string().max(10_000),
  expectedDraftContent: z.string().max(500_000),
};

const durableClaimPayload = z.object({
  choice: z.enum(["keep_mine", "use_saved", "save_separately"]),
  status: z.enum(["claimed", "processing", "resolved"]),
  expectedDocumentUpdatedAt: z.string().optional(),
  processingToken: z.string().optional(),
  processingStartedAt: z.string().optional(),
  draftId: z.string().min(1),
  baseDocumentUpdatedAt: z.string().nullable(),
  loadedContentWasEmpty: z.number().int(),
  deferredReason: z.string().nullable(),
  editorSessionId: z.string().nullable().optional(),
  editGeneration: z.number().int().nullable().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const PROCESSING_LEASE_MS = 5 * 60_000;

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
  expectedDocumentUpdatedAt: string;
  ownerEmail: string;
  orgId: string;
  includeDocumentVersion: boolean;
}): Promise<string> {
  const input = JSON.stringify([
    args.ownerEmail,
    args.orgId,
    args.documentId,
    args.expectedDraftVersion,
    args.expectedDraftTitle,
    args.expectedDraftContent,
    ...(args.includeDocumentVersion ? [args.expectedDocumentUpdatedAt] : []),
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
    z.object({
      choice: z.literal("use_saved"),
      ...exactDraft,
      expectedDocumentUpdatedAt: z.string().min(1),
    }),
    z.object({
      choice: z.literal("save_separately"),
      ...exactDraft,
      expectedDocumentUpdatedAt: z.string().min(1),
    }),
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
    let recoveryId = await recoveryDocumentId({
      ...args,
      ownerEmail: userEmail,
      orgId,
      includeDocumentVersion: true,
    });
    let claimId = `draft-claim-${recoveryId.slice("recovery-".length)}`;
    let claimDocumentId = ownerEmail === userEmail ? args.documentId : claimId;
    const legacyRecoveryId = await recoveryDocumentId({
      ...args,
      ownerEmail: userEmail,
      orgId,
      includeDocumentVersion: false,
    });
    const legacyClaimId = `draft-claim-${legacyRecoveryId.slice(
      "recovery-".length,
    )}`;
    const [currentClaim] = await db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.id, claimId),
          eq(schema.documentVersions.ownerEmail, userEmail),
          eq(schema.documentVersions.documentId, claimDocumentId),
        ),
      )
      .limit(1);
    if (legacyClaimId !== claimId && !currentClaim) {
      const [legacyClaim] = await db
        .select({
          id: schema.documentVersions.id,
          chatContext: schema.documentVersions.chatContext,
        })
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.id, legacyClaimId),
            eq(schema.documentVersions.ownerEmail, userEmail),
            eq(
              schema.documentVersions.documentId,
              ownerEmail === userEmail ? args.documentId : legacyClaimId,
            ),
          ),
        )
        .limit(1);
      const [matchingDraft] = await db
        .select({ id: schema.documentPreviewDrafts.id })
        .from(schema.documentPreviewDrafts)
        .where(
          and(
            eq(schema.documentPreviewDrafts.ownerEmail, userEmail),
            eq(schema.documentPreviewDrafts.orgId, orgId),
            eq(schema.documentPreviewDrafts.documentId, args.documentId),
            eq(schema.documentPreviewDrafts.version, args.expectedDraftVersion),
            eq(schema.documentPreviewDrafts.title, args.expectedDraftTitle),
            eq(schema.documentPreviewDrafts.content, args.expectedDraftContent),
          ),
        )
        .limit(1);
      let legacyPayload: ReturnType<
        typeof durableClaimPayload.safeParse
      > | null = null;
      if (legacyClaim?.chatContext) {
        try {
          legacyPayload = durableClaimPayload.safeParse(
            JSON.parse(legacyClaim.chatContext),
          );
        } catch {
          legacyPayload = null;
        }
      }
      if (
        legacyClaim &&
        legacyPayload?.success &&
        (!matchingDraft || legacyPayload.data.draftId === matchingDraft.id)
      ) {
        recoveryId = legacyRecoveryId;
        claimId = legacyClaimId;
        claimDocumentId = ownerEmail === userEmail ? args.documentId : claimId;
      }
    }
    const processingToken = crypto.randomUUID();
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
        const [currentDocument] = await tx
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .for("update")
          .limit(1);
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
          if (payload.status === "resolved") {
            return { status: "resolved" as const };
          }
          const expectedUpdatedAt =
            payload.expectedDocumentUpdatedAt ?? args.expectedDocumentUpdatedAt;
          if (
            args.expectedDocumentUpdatedAt !== expectedUpdatedAt ||
            !currentDocument ||
            (currentDocument.updatedAt !== expectedUpdatedAt &&
              !(
                args.choice === "keep_mine" &&
                currentDocument.title === claim.title &&
                currentDocument.content === claim.content
              ))
          ) {
            return {
              status: "document_conflict" as const,
              document: currentDocument ?? null,
            };
          }
          return {
            status: "claimed" as const,
            draft: {
              id: payload.draftId,
              ownerEmail: userEmail,
              orgId,
              documentId: args.documentId,
              title: claim.title,
              content: claim.content,
              baseDocumentUpdatedAt: payload.baseDocumentUpdatedAt,
              loadedContentWasEmpty: payload.loadedContentWasEmpty,
              deferredReason: payload.deferredReason,
              editorSessionId: payload.editorSessionId ?? null,
              editGeneration: payload.editGeneration ?? null,
              version: args.expectedDraftVersion,
              createdAt: payload.createdAt,
              updatedAt: payload.updatedAt,
            },
            acquired: false,
          };
        }
        if (
          !currentDocument ||
          currentDocument.updatedAt !== args.expectedDocumentUpdatedAt
        ) {
          return {
            status: "document_conflict" as const,
            document: currentDocument ?? null,
          };
        }
        const now = new Date().toISOString();
        const inserted = await tx
          .insert(schema.documentVersions)
          .values({
            id: claimId,
            ownerEmail: userEmail,
            documentId: claimDocumentId,
            title: draft.title,
            content: draft.content,
            chatContext: JSON.stringify({
              choice: args.choice,
              status: "processing",
              expectedDocumentUpdatedAt: args.expectedDocumentUpdatedAt,
              processingToken,
              processingStartedAt: now,
              draftId: draft.id,
              baseDocumentUpdatedAt: draft.baseDocumentUpdatedAt,
              loadedContentWasEmpty: draft.loadedContentWasEmpty,
              deferredReason: draft.deferredReason,
              editorSessionId: draft.editorSessionId,
              editGeneration: draft.editGeneration,
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
          .onConflictDoNothing()
          .returning({ id: schema.documentVersions.id });
        if (inserted.length === 0) {
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
            .for("update")
            .limit(1);
          if (!claim?.chatContext) conflict("The recovery claim was lost.");
          const payload = durableClaimPayload.parse(
            JSON.parse(claim.chatContext),
          );
          if (payload.choice !== args.choice)
            conflict("This draft was already resolved with another choice.");
          if (payload.status === "resolved") {
            if (
              payload.draftId !== draft.id ||
              payload.expectedDocumentUpdatedAt !==
                args.expectedDocumentUpdatedAt
            ) {
              conflict("The saved draft changed during recovery.");
            }
            const deleted = await tx
              .delete(schema.documentPreviewDrafts)
              .where(draftFilter)
              .returning({ id: schema.documentPreviewDrafts.id });
            if (deleted.length !== 1)
              conflict("The saved draft changed during recovery.");
            return { status: "resolved" as const };
          }
          if (payload.draftId !== draft.id)
            conflict("The saved draft changed during recovery.");
          if (
            payload.status === "processing" &&
            (!payload.processingStartedAt ||
              Date.now() - Date.parse(payload.processingStartedAt) <
                PROCESSING_LEASE_MS)
          )
            conflict("This recovery choice is already being applied.");
          await tx
            .update(schema.documentVersions)
            .set({
              chatContext: JSON.stringify({
                ...payload,
                status: "processing",
                processingToken,
                processingStartedAt: now,
              }),
              updatedAt: now,
            })
            .where(eq(schema.documentVersions.id, claimId));
        }
        const deleted = await tx
          .delete(schema.documentPreviewDrafts)
          .where(draftFilter)
          .returning({ id: schema.documentPreviewDrafts.id });
        if (deleted.length !== 1)
          conflict("The saved draft changed during recovery.");
        return { status: "claimed" as const, draft, acquired: true };
      });
    };
    const acquireClaim = async () =>
      db.transaction(async (tx) => {
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
          .for("update")
          .limit(1);
        if (!claim?.chatContext) conflict("The recovery claim was lost.");
        const payload = durableClaimPayload.parse(
          JSON.parse(claim.chatContext),
        );
        if (payload.choice !== args.choice)
          conflict("This draft was already resolved with another choice.");
        if (payload.status === "resolved") return false;
        const [currentDocument] = await tx
          .select({
            updatedAt: schema.documents.updatedAt,
            title: schema.documents.title,
            content: schema.documents.content,
          })
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .for("update")
          .limit(1);
        if (
          !currentDocument ||
          (currentDocument.updatedAt !== args.expectedDocumentUpdatedAt &&
            !(
              args.choice === "keep_mine" &&
              currentDocument.title === claim.title &&
              currentDocument.content === claim.content
            ))
        ) {
          conflict("The page changed after this recovery choice was reviewed.");
        }
        if (payload.status === "processing") {
          const alreadyApplied =
            args.choice === "use_saved" ||
            (args.choice === "keep_mine" &&
              currentDocument.title === claim.title &&
              currentDocument.content === claim.content) ||
            (args.choice === "save_separately" &&
              (
                await tx
                  .select({
                    ownerEmail: schema.documents.ownerEmail,
                    title: schema.documents.title,
                    content: schema.documents.content,
                  })
                  .from(schema.documents)
                  .where(
                    and(
                      eq(schema.documents.id, recoveryId),
                      eq(schema.documents.ownerEmail, userEmail),
                      eq(schema.documents.title, claim.title),
                      eq(schema.documents.content, claim.content),
                    ),
                  )
                  .limit(1)
              ).length === 1);
          if (!alreadyApplied) {
            if (
              !payload.processingStartedAt ||
              Date.now() - Date.parse(payload.processingStartedAt) <
                PROCESSING_LEASE_MS
            ) {
              conflict("This recovery choice is already being applied.");
            }
          } else {
            const resolvedAt = new Date().toISOString();
            const resolved = await tx
              .update(schema.documentVersions)
              .set({
                chatContext: JSON.stringify({
                  ...payload,
                  status: "resolved",
                }),
                updatedAt: resolvedAt,
              })
              .where(
                and(
                  eq(schema.documentVersions.id, claimId),
                  eq(schema.documentVersions.chatContext, claim.chatContext),
                ),
              )
              .returning({ id: schema.documentVersions.id });
            if (resolved.length !== 1)
              conflict("This recovery choice is already being applied.");
            return false;
          }
        }
        const now = new Date().toISOString();
        const acquired = await tx
          .update(schema.documentVersions)
          .set({
            chatContext: JSON.stringify({
              ...payload,
              status: "processing",
              processingToken,
              processingStartedAt: now,
            }),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.documentVersions.id, claimId),
              eq(schema.documentVersions.chatContext, claim.chatContext),
            ),
          )
          .returning({ id: schema.documentVersions.id });
        if (acquired.length !== 1)
          conflict("This recovery choice is already being applied.");
        return true;
      });
    const markClaimResolved = async () => {
      await db.transaction(async (tx) => {
        const [claim] = await tx
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
        const payload = durableClaimPayload.parse(
          JSON.parse(claim.chatContext),
        );
        if (payload.choice !== args.choice) {
          conflict("This draft was already resolved with another choice.");
        }
        if (payload.status === "resolved") return;
        if (payload.processingToken !== processingToken)
          conflict("This recovery choice is already being applied.");
        const resolvedAt = new Date().toISOString();
        if (
          payload.editorSessionId !== null &&
          payload.editorSessionId !== undefined &&
          payload.editGeneration !== null &&
          payload.editGeneration !== undefined
        ) {
          await settlePreviewDocumentDraft({
            db: tx,
            ownerEmail: userEmail,
            orgId,
            documentId: args.documentId,
            editorSessionId: payload.editorSessionId,
            editGeneration: payload.editGeneration,
            discarded: args.choice === "use_saved",
            now: resolvedAt,
          });
        }
        const resolved = await tx
          .update(schema.documentVersions)
          .set({
            chatContext: JSON.stringify({ ...payload, status: "resolved" }),
            updatedAt: resolvedAt,
          })
          .where(
            and(
              eq(schema.documentVersions.id, claimId),
              eq(schema.documentVersions.ownerEmail, userEmail),
              eq(schema.documentVersions.documentId, claimDocumentId),
              eq(schema.documentVersions.chatContext, claim.chatContext),
            ),
          )
          .returning({ id: schema.documentVersions.id });
        if (resolved.length !== 1) conflict("The recovery claim was lost.");
      });
    };
    const restoreClaimedDraft = async (
      draft: typeof schema.documentPreviewDrafts.$inferSelect,
    ) => {
      await db.transaction(async (tx) => {
        const [claim] = await tx
          .select({ chatContext: schema.documentVersions.chatContext })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, claimId))
          .for("update")
          .limit(1);
        if (!claim?.chatContext) conflict("The recovery claim was lost.");
        const payload = durableClaimPayload.parse(
          JSON.parse(claim.chatContext),
        );
        if (
          payload.status === "resolved" ||
          payload.processingToken !== processingToken
        )
          return;
        if (draft.editorSessionId !== null && draft.editGeneration !== null) {
          const settledGeneration = await lockPreviewDocumentDraftSettlement({
            db: tx,
            ownerEmail: userEmail,
            orgId,
            documentId: args.documentId,
            editorSessionId: draft.editorSessionId,
            now: new Date().toISOString(),
          });
          if (
            settledGeneration !== null &&
            draft.editGeneration <= settledGeneration
          ) {
            await tx
              .update(schema.documentVersions)
              .set({
                chatContext: JSON.stringify({
                  ...payload,
                  status: "resolved",
                }),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.documentVersions.id, claimId));
            return;
          }
        }
        const restored = await tx
          .insert(schema.documentPreviewDrafts)
          .values(draft)
          .onConflictDoNothing()
          .returning({ id: schema.documentPreviewDrafts.id });
        if (restored.length === 1) {
          await tx
            .update(schema.documentVersions)
            .set({
              chatContext: JSON.stringify({ ...payload, status: "claimed" }),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.documentVersions.id, claimId));
          return;
        }

        conflict(
          "A newer draft replaced this recovery draft. The claimed version was preserved in Version History.",
          { recoveryVersionId: claimId },
        );
      });
    };
    if (args.choice === "keep_mine") {
      const claimed = await claimExactDraft();
      if (claimed.status === "document_conflict") return claimed;
      if (claimed.status === "resolved") {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .limit(1);
        return {
          status: "resolved" as const,
          choice: args.choice,
          document: current,
        };
      }
      if (!claimed.acquired && !(await acquireClaim())) {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .limit(1);
        return {
          status: "resolved" as const,
          choice: args.choice,
          document: current,
        };
      }
      const { draft } = claimed;
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
        if (!current) conflict("The document was removed during recovery.");
        if (current.updatedAt !== args.expectedDocumentUpdatedAt) {
          await restoreClaimedDraft(draft);
          return {
            status: "document_conflict" as const,
            document: current,
          };
        }
        const baseRevision = documentRevisionToken(
          current.bodyRevision,
          current.content,
        );
        const saved = await updateDocument.run(
          {
            id: args.documentId,
            title: draft.title,
            content: draft.content,
            baseUpdatedAt: args.expectedDocumentUpdatedAt,
            recoveryExpectedUpdatedAt: args.expectedDocumentUpdatedAt,
            baseRevision,
            baseTitle: current.title,
            authoredBaseRevision: baseRevision,
            authoredBaseContent: current.content,
            authoredCandidateContent: draft.content,
            browserSaveAttemptId: processingToken,
            loadedUpdatedAt: draft.baseDocumentUpdatedAt ?? undefined,
            loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
            historySessionId: `draft-recovery:${draft.id}`,
            editorSessionId: claimId,
            editorEditGeneration: 0,
            editorSnapshotTitle: draft.title,
            editorSnapshotContent: draft.content,
            preserveLeadingTitleHeading: true,
            reuseLabels: [],
          },
          { ...ctx, caller: "frontend" },
        );
        if ("conflict" in saved && saved.conflict === true) {
          const [winner] = await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, args.documentId))
            .limit(1);
          if (
            winner?.title === draft.title &&
            winner.content === draft.content
          ) {
            await markClaimResolved();
            return {
              status: "resolved" as const,
              choice: args.choice,
              document: winner,
            };
          }
          await restoreClaimedDraft(draft);
          return {
            status: "document_conflict" as const,
            document: saved.document,
          };
        }
        const resultDocument = "document" in saved ? saved.document : saved;
        if (
          "preservationRequired" in saved ||
          "superseded" in saved ||
          resultDocument.title !== draft.title ||
          resultDocument.content !== draft.content
        ) {
          await restoreClaimedDraft(draft);
          return {
            status: "document_conflict" as const,
            document: resultDocument,
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
      const claimed = await claimExactDraft();
      if (claimed.status === "document_conflict") return claimed;
      if (claimed.status === "resolved")
        return { status: "resolved" as const, choice: args.choice };
      if (!claimed.acquired && !(await acquireClaim()))
        return { status: "resolved" as const, choice: args.choice };
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
    const claimed = await claimExactDraft();
    if (claimed.status === "document_conflict") return claimed;
    if (claimed.status === "resolved") {
      const existing = await findExistingRecovery();
      if (!existing) conflict("The recovered copy could not be found.");
      return {
        status: "resolved" as const,
        choice: args.choice,
        document: existing,
        createdDocumentId: existing.id,
        urlPath: `/page/${existing.id}`,
      };
    }
    if (!claimed.acquired && !(await acquireClaim())) {
      const existing = await findExistingRecovery();
      if (!existing) conflict("The recovered copy could not be found.");
      return {
        status: "resolved" as const,
        choice: args.choice,
        document: existing,
        createdDocumentId: existing.id,
        urlPath: `/page/${existing.id}`,
      };
    }
    const { draft } = claimed;
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
