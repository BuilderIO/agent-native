import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { previewDraftTitleIntent } from "../shared/preview-draft-title-intent.js";
import { withContentRecoverySaveContext } from "./_content-save-outcomes.js";
import {
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import {
  assertAutomaticPreviewDraftGeneration,
  withAutomaticPreviewDraftRecoveryContext,
  fencePreviewDocumentDraftGeneration,
  lockPreviewDocumentDraftSettlement,
  settlePreviewDocumentDraft,
} from "./_preview-document-draft-settlement.js";
import createDocument from "./create-document.js";
import updateDocument from "./update-document.js";

const exactDraft = {
  trigger: z.enum(["automatic", "reviewed"]).optional(),
  documentId: z.string().min(1),
  expectedDraftId: z.string().min(1).optional(),
  expectedDraftEditorSessionId: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional(),
  expectedDraftEditGeneration: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
  expectedDraftVersion: z.number().int().positive(),
  expectedDraftTitle: z.string().max(10_000),
  expectedDraftContent: z.string().max(500_000),
  expectedDraftBaseTitle: z.string().max(10_000).nullable().optional(),
  expectedDocumentTitle: z.string().max(10_000).optional(),
};

const durableClaimPayload = z.object({
  choice: z.enum(["keep_mine", "use_saved", "save_separately"]),
  trigger: z.enum(["automatic", "reviewed"]).optional(),
  status: z.enum(["claimed", "processing", "resolved"]),
  expectedDocumentUpdatedAt: z.string().optional(),
  processingToken: z.string().optional(),
  processingStartedAt: z.string().optional(),
  draftId: z.string().min(1),
  baseTitle: z.string().nullable().optional(),
  reviewedDocumentTitle: z.string().optional(),
  baseDocumentUpdatedAt: z.string().nullable(),
  baseContentHash: z.string().nullable().optional(),
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
  sourceIdentity?: {
    id: string;
    editorSessionId: string | null;
    editGeneration: number | null;
  };
}): Promise<string> {
  const input = JSON.stringify([
    args.ownerEmail,
    args.orgId,
    args.documentId,
    args.expectedDraftVersion,
    args.expectedDraftTitle,
    args.expectedDraftContent,
    ...(args.includeDocumentVersion ? [args.expectedDocumentUpdatedAt] : []),
    ...(args.sourceIdentity
      ? [
          args.sourceIdentity.id,
          args.sourceIdentity.editorSessionId,
          args.sourceIdentity.editGeneration,
        ]
      : []),
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
    const trigger = args.trigger === "reviewed" ? "reviewed" : "automatic";
    const automatic = trigger === "automatic";
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
    // Old clients cannot distinguish a replaced row from the selected snapshot.
    if (
      args.expectedDraftId === undefined ||
      args.expectedDraftEditorSessionId === undefined ||
      args.expectedDraftEditGeneration === undefined
    )
      return {
        status: "recovery_required" as const,
        reason: "draft_changed" as const,
      };
    const sourceIdentityMatches = (
      payload: z.infer<typeof durableClaimPayload>,
    ) =>
      payload.draftId === args.expectedDraftId &&
      (payload.editorSessionId ?? null) === args.expectedDraftEditorSessionId &&
      (payload.editGeneration ?? null) === args.expectedDraftEditGeneration;
    const db = getDb();
    type ClaimTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
    let recoveryId = await recoveryDocumentId({
      ...args,
      ownerEmail: userEmail,
      orgId,
      includeDocumentVersion: true,
      sourceIdentity: {
        id: args.expectedDraftId,
        editorSessionId: args.expectedDraftEditorSessionId,
        editGeneration: args.expectedDraftEditGeneration,
      },
    });
    let claimId = `draft-claim-${recoveryId.slice("recovery-".length)}`;
    let claimDocumentId = ownerEmail === userEmail ? args.documentId : claimId;
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
    // Both historical ID formats remain retryable only for their original source.
    if (!currentClaim) {
      for (const includeDocumentVersion of [true, false]) {
        const historicalRecoveryId = await recoveryDocumentId({
          ...args,
          ownerEmail: userEmail,
          orgId,
          includeDocumentVersion,
        });
        const historicalClaimId = `draft-claim-${historicalRecoveryId.slice("recovery-".length)}`;
        const [historicalClaim] = await db
          .select({ chatContext: schema.documentVersions.chatContext })
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.id, historicalClaimId),
              eq(schema.documentVersions.ownerEmail, userEmail),
              eq(
                schema.documentVersions.documentId,
                ownerEmail === userEmail ? args.documentId : historicalClaimId,
              ),
            ),
          )
          .limit(1);
        if (!historicalClaim?.chatContext) continue;
        // A malformed durable claim is a technical failure, never permission to create another.
        const payload = durableClaimPayload.parse(
          JSON.parse(historicalClaim.chatContext),
        );
        if (!sourceIdentityMatches(payload)) continue;
        recoveryId = historicalRecoveryId;
        claimId = historicalClaimId;
        claimDocumentId = ownerEmail === userEmail ? args.documentId : claimId;
        break;
      }
    }
    const processingToken = crypto.randomUUID();
    let reviewedDocumentTitle: string | undefined;
    const titleIntent = (
      draft: { title: string; baseTitle?: string | null },
      reviewedTitle: string | undefined,
    ) => {
      const intent =
        reviewedTitle === undefined
          ? { status: "unknown" as const }
          : previewDraftTitleIntent(draft, reviewedTitle);
      if (intent.status === "unknown") {
        throw new ActionContractError(
          "The draft's original title is unknown. Keep the saved page or save the draft separately.",
          {
            errorCode: "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN",
            statusCode: 409,
            details: { documentId: args.documentId },
          },
        );
      }
      return intent;
    };
    const claimMatchesDocument = (
      claim: { title: string; content: string },
      payload: z.infer<typeof durableClaimPayload>,
      current: { title: string; content: string },
    ) =>
      args.choice === "keep_mine" &&
      current.title ===
        titleIntent(
          { title: claim.title, baseTitle: payload.baseTitle },
          payload.reviewedDocumentTitle,
        ).title &&
      current.content === claim.content;
    const draftFilter = and(
      eq(schema.documentPreviewDrafts.id, args.expectedDraftId),
      args.expectedDraftEditorSessionId === null
        ? isNull(schema.documentPreviewDrafts.editorSessionId)
        : eq(
            schema.documentPreviewDrafts.editorSessionId,
            args.expectedDraftEditorSessionId,
          ),
      args.expectedDraftEditGeneration === null
        ? isNull(schema.documentPreviewDrafts.editGeneration)
        : eq(
            schema.documentPreviewDrafts.editGeneration,
            args.expectedDraftEditGeneration,
          ),
      eq(schema.documentPreviewDrafts.ownerEmail, userEmail),
      eq(schema.documentPreviewDrafts.orgId, orgId),
      eq(schema.documentPreviewDrafts.documentId, args.documentId),
      eq(schema.documentPreviewDrafts.version, args.expectedDraftVersion),
      eq(schema.documentPreviewDrafts.title, args.expectedDraftTitle),
      eq(schema.documentPreviewDrafts.content, args.expectedDraftContent),
      ...(args.expectedDraftBaseTitle === undefined
        ? []
        : [
            args.expectedDraftBaseTitle === null
              ? isNull(schema.documentPreviewDrafts.baseTitle)
              : eq(
                  schema.documentPreviewDrafts.baseTitle,
                  args.expectedDraftBaseTitle,
                ),
          ]),
    );
    let destinationId = recoveryId;
    const findExistingRecovery = async (
      executor: Pick<ClaimTransaction, "select"> = db,
    ) => {
      const [existing] = await executor
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, destinationId),
            eq(schema.documents.ownerEmail, userEmail),
            eq(schema.documents.title, args.expectedDraftTitle),
            eq(schema.documents.content, args.expectedDraftContent),
          ),
        )
        .limit(1);
      return existing ?? null;
    };
    const claimGenerationInput = (
      tx: ClaimTransaction,
      payload: z.infer<typeof durableClaimPayload>,
      now: string,
    ) => {
      if (payload.editorSessionId == null || payload.editGeneration == null)
        return null;
      return {
        db: tx,
        ownerEmail: userEmail,
        orgId,
        documentId: args.documentId,
        editorSessionId: payload.editorSessionId,
        editGeneration: payload.editGeneration,
        now,
      };
    };
    const fenceClaimGeneration = async (
      tx: ClaimTransaction,
      payload: z.infer<typeof durableClaimPayload>,
      now = new Date().toISOString(),
    ) => {
      const input = claimGenerationInput(tx, payload, now);
      if (!input) return;
      if (payload.choice === "keep_mine")
        await lockPreviewDocumentDraftSettlement(input);
      else await fencePreviewDocumentDraftGeneration(input);
    };
    // Historical resolved claims may still need their settlement repaired.
    const settleClaimGeneration = async (
      tx: ClaimTransaction,
      payload: z.infer<typeof durableClaimPayload>,
      now = new Date().toISOString(),
    ) => {
      if (
        payload.choice === "save_separately" &&
        !(await findExistingRecovery(tx))
      )
        conflict("The recovered copy could not be found.");
      const input = claimGenerationInput(tx, payload, now);
      if (!input) return;
      await settlePreviewDocumentDraft({
        ...input,
        discarded: payload.choice !== "keep_mine",
        draftSnapshot: {
          id: payload.draftId,
          version: args.expectedDraftVersion,
        },
      });
    };
    // Recovery locks rows in one order, page, claim, settlement, draft, so a
    // choice, its retry and the tab's own draft writes can't deadlock.
    const claimExactDraft = async () =>
      db.transaction(async (tx) => {
        const [currentDocument] = await tx
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .for("update")
          .limit(1);
        const [sourceDraft] = await tx
          .select()
          .from(schema.documentPreviewDrafts)
          .where(draftFilter)
          .limit(1);
        const [previousChoice] = await tx
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.ownerEmail, userEmail),
              eq(
                schema.documentVersions.groupId,
                `draft-recovery:${args.expectedDraftId}`,
              ),
              eq(schema.documentVersions.checkpointKind, "recovery"),
              inArray(schema.documentVersions.operation, [
                "claim-preview-draft-keep_mine",
                "claim-preview-draft-save_separately",
                "use-saved-preview-draft",
              ]),
              or(
                eq(schema.documentVersions.documentId, args.documentId),
                eq(
                  schema.documentVersions.documentId,
                  schema.documentVersions.id,
                ),
              ),
              sql`(${schema.documentVersions.chatContext}::jsonb ->> 'editorSessionId') IS NOT DISTINCT FROM ${args.expectedDraftEditorSessionId}`,
              sql`(${schema.documentVersions.chatContext}::jsonb ->> 'editGeneration') IS NOT DISTINCT FROM ${args.expectedDraftEditGeneration === null ? null : String(args.expectedDraftEditGeneration)}`,
            ),
          )
          .orderBy(
            desc(schema.documentVersions.createdAt),
            desc(schema.documentVersions.id),
          )
          .limit(1);
        // A page timestamp identifies a reviewed version, not a new recovery decision.
        if (previousChoice && (automatic || args.choice !== "keep_mine")) {
          claimId = previousChoice.id;
          claimDocumentId =
            ownerEmail === userEmail ? args.documentId : claimId;
          recoveryId = `recovery-${claimId.slice("draft-claim-".length)}`;
          destinationId = recoveryId;
        }
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
        let payload: z.infer<typeof durableClaimPayload> | undefined;
        if (claim) {
          if (
            claim.title !== args.expectedDraftTitle ||
            claim.content !== args.expectedDraftContent ||
            !claim.chatContext
          )
            conflict("The saved draft changed during recovery.");
          payload = durableClaimPayload.parse(JSON.parse(claim.chatContext));
          if (!sourceIdentityMatches(payload))
            return {
              status: "recovery_required" as const,
              reason: "draft_changed" as const,
              document: currentDocument ?? null,
            };
          if (automatic) {
            await fenceClaimGeneration(tx, payload);
            return {
              status: "recovery_required" as const,
              reason: "prior_choice" as const,
              choice: payload.choice,
              recoveryVersionId: claim.id,
              document: currentDocument ?? null,
            };
          }
          if (
            previousChoice?.id === claim.id &&
            args.choice !== "keep_mine" &&
            payload.choice === args.choice &&
            sourceDraft &&
            currentDocument &&
            currentDocument.updatedAt === args.expectedDocumentUpdatedAt &&
            (args.expectedDocumentTitle === undefined ||
              currentDocument.title === args.expectedDocumentTitle)
          ) {
            payload = {
              ...payload,
              expectedDocumentUpdatedAt: args.expectedDocumentUpdatedAt,
              reviewedDocumentTitle: currentDocument.title,
            };
          }
          if (!sourceIdentityMatches(payload))
            conflict("The saved draft changed during recovery.");
          if (payload.choice !== args.choice)
            conflict("This draft was already resolved with another choice.");
          reviewedDocumentTitle = payload.reviewedDocumentTitle;
          if (
            args.expectedDraftBaseTitle !== undefined &&
            args.expectedDraftBaseTitle !== (payload.baseTitle ?? null)
          )
            conflict("The saved draft changed during recovery.");
          if (
            args.expectedDocumentTitle !== undefined &&
            payload.reviewedDocumentTitle !== undefined &&
            args.expectedDocumentTitle !== payload.reviewedDocumentTitle
          )
            conflict("The reviewed page title changed during recovery.");
          if (args.choice === "keep_mine")
            titleIntent(
              { title: claim.title, baseTitle: payload.baseTitle },
              reviewedDocumentTitle,
            );
          if (payload.status === "resolved") {
            // Historical resolved claims may have no fence. Repair it before
            // releasing the page lock or acquiring any draft row lock.
            await settleClaimGeneration(tx, payload);
            if (
              payload.editorSessionId == null ||
              payload.editGeneration == null
            ) {
              const [draft] = await tx
                .select({ id: schema.documentPreviewDrafts.id })
                .from(schema.documentPreviewDrafts)
                .where(draftFilter)
                .for("update")
                .limit(1);
              if (draft) {
                if (
                  payload.draftId !== draft.id ||
                  payload.expectedDocumentUpdatedAt !==
                    args.expectedDocumentUpdatedAt
                )
                  conflict("The saved draft changed during recovery.");
                if (
                  !currentDocument ||
                  currentDocument.updatedAt !== args.expectedDocumentUpdatedAt
                ) {
                  return {
                    status: "document_conflict" as const,
                    document: currentDocument ?? null,
                  };
                }
                await tx
                  .delete(schema.documentPreviewDrafts)
                  .where(draftFilter);
              }
            }
            return { status: "resolved" as const };
          }
        }
        const draft = sourceDraft;
        if (!draft) {
          if (automatic)
            return {
              status: "recovery_required" as const,
              reason: "draft_changed" as const,
              document: currentDocument ?? null,
            };
          if (!claim || !payload) {
            conflict("The saved draft changed during recovery.");
          }
          const expectedUpdatedAt =
            payload.expectedDocumentUpdatedAt ?? args.expectedDocumentUpdatedAt;
          if (
            args.expectedDocumentUpdatedAt !== expectedUpdatedAt ||
            !currentDocument ||
            (currentDocument.updatedAt !== expectedUpdatedAt &&
              !claimMatchesDocument(claim, payload, currentDocument))
          ) {
            return {
              status: "document_conflict" as const,
              document: currentDocument ?? null,
            };
          }
          await fenceClaimGeneration(tx, payload);
          return {
            status: "claimed" as const,
            draft: {
              id: payload.draftId,
              ownerEmail: userEmail,
              orgId,
              documentId: args.documentId,
              title: claim.title,
              content: claim.content,
              baseTitle: payload.baseTitle ?? null,
              baseDocumentUpdatedAt: payload.baseDocumentUpdatedAt,
              baseContentHash: payload.baseContentHash ?? null,
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
          currentDocument.updatedAt !== args.expectedDocumentUpdatedAt ||
          (args.expectedDocumentTitle !== undefined &&
            currentDocument.title !== args.expectedDocumentTitle)
        ) {
          return {
            status: "document_conflict" as const,
            document: currentDocument ?? null,
          };
        }
        if (!claim) reviewedDocumentTitle = currentDocument.title;
        if (args.choice === "keep_mine")
          titleIntent(draft, reviewedDocumentTitle);
        const now = new Date().toISOString();
        if (!claim) {
          payload = {
            choice: args.choice,
            trigger,
            status: "processing",
            expectedDocumentUpdatedAt: args.expectedDocumentUpdatedAt,
            processingToken,
            processingStartedAt: now,
            draftId: draft.id,
            baseTitle: draft.baseTitle,
            reviewedDocumentTitle: currentDocument.title,
            baseDocumentUpdatedAt: draft.baseDocumentUpdatedAt,
            baseContentHash: draft.baseContentHash,
            loadedContentWasEmpty: draft.loadedContentWasEmpty,
            deferredReason: draft.deferredReason,
            editorSessionId: draft.editorSessionId,
            editGeneration: draft.editGeneration,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt,
          };
          const inserted = await tx
            .insert(schema.documentVersions)
            .values({
              id: claimId,
              ownerEmail: userEmail,
              documentId: claimDocumentId,
              title: draft.title,
              content: draft.content,
              chatContext: JSON.stringify(payload),
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
          // The page lock serializes creation of this deterministic claim.
          if (inserted.length !== 1) conflict("The recovery claim was lost.");
        } else {
          if (!payload) conflict("The recovery claim was lost.");
          if (
            payload.draftId !== draft.id ||
            (payload.baseTitle ?? null) !== draft.baseTitle ||
            payload.baseDocumentUpdatedAt !== draft.baseDocumentUpdatedAt ||
            (payload.baseContentHash ?? null) !== draft.baseContentHash ||
            (payload.editorSessionId ?? null) !== draft.editorSessionId ||
            (payload.editGeneration ?? null) !== draft.editGeneration
          )
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
                trigger,
                status: "processing",
                processingToken,
                processingStartedAt: now,
              }),
              updatedAt: now,
            })
            .where(eq(schema.documentVersions.id, claimId));
        }
        if (!payload) conflict("The recovery claim was lost.");
        if (automatic) {
          if (
            (draft.editorSessionId !== null && draft.editGeneration !== null) ||
            args.choice === "keep_mine"
          ) {
            await assertAutomaticPreviewDraftGeneration({
              db: tx,
              ownerEmail: userEmail,
              orgId,
              documentId: args.documentId,
              editorSessionId: draft.editorSessionId,
              editGeneration: draft.editGeneration,
              now,
            });
          }
          if (args.choice === "keep_mine") {
            const intent = titleIntent(draft, currentDocument.title);
            if (
              (draft.content !== currentDocument.content &&
                draft.baseContentHash !==
                  documentContentHash(currentDocument.content)) ||
              (intent.changesTitle &&
                currentDocument.title !== draft.baseTitle &&
                currentDocument.title !== draft.title)
            )
              conflict("The page requires a reviewed recovery choice.");
          }
        }
        await fenceClaimGeneration(tx, payload, now);
        // The lineage read above takes no D lock: draft writers acquire S
        // first. Revalidate the whole snapshot once that order is established.
        const [lockedDraft] = await tx
          .select()
          .from(schema.documentPreviewDrafts)
          .where(draftFilter)
          .for("update")
          .limit(1);
        if (
          !lockedDraft ||
          (Object.keys(draft) as (keyof typeof draft)[]).some(
            (key) => lockedDraft[key] !== draft[key],
          )
        )
          conflict("The saved draft changed during recovery.");
        const deleted = await tx
          .delete(schema.documentPreviewDrafts)
          .where(draftFilter)
          .returning({ id: schema.documentPreviewDrafts.id });
        if (deleted.length !== 1)
          conflict("The saved draft changed during recovery.");
        return { status: "claimed" as const, draft, acquired: true };
      });
    const settleAndResolveClaim = async (
      tx: ClaimTransaction,
      chatContext: string,
      payload: z.infer<typeof durableClaimPayload>,
    ) => {
      const resolvedAt = new Date().toISOString();
      await settleClaimGeneration(tx, payload, resolvedAt);
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
            eq(schema.documentVersions.chatContext, chatContext),
          ),
        )
        .returning({ id: schema.documentVersions.id });
      return resolved.length === 1;
    };
    const acquireClaim = async () =>
      db.transaction(async (tx) => {
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
        if (!sourceIdentityMatches(payload))
          conflict("The saved draft changed during recovery.");
        if (payload.choice !== args.choice)
          conflict("This draft was already resolved with another choice.");
        if (payload.status === "resolved") {
          await settleClaimGeneration(tx, payload);
          return false;
        }
        if (
          !currentDocument ||
          (currentDocument.updatedAt !== args.expectedDocumentUpdatedAt &&
            !claimMatchesDocument(claim, payload, currentDocument))
        ) {
          conflict("The page changed after this recovery choice was reviewed.");
        }
        if (payload.status === "processing") {
          const alreadyApplied =
            args.choice === "use_saved" ||
            claimMatchesDocument(claim, payload, currentDocument) ||
            (args.choice === "save_separately" &&
              (await findExistingRecovery(tx)) !== null);
          if (!alreadyApplied) {
            if (
              !payload.processingStartedAt ||
              Date.now() - Date.parse(payload.processingStartedAt) <
                PROCESSING_LEASE_MS
            ) {
              conflict("This recovery choice is already being applied.");
            }
          } else {
            if (!(await settleAndResolveClaim(tx, claim.chatContext, payload)))
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
              trigger,
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
        // The claim before the settlement row, in recovery's lock order.
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
          .for("update")
          .limit(1);
        if (!claim?.chatContext) conflict("The recovery claim was lost.");
        const payload = durableClaimPayload.parse(
          JSON.parse(claim.chatContext),
        );
        if (!sourceIdentityMatches(payload))
          conflict("The saved draft changed during recovery.");
        if (payload.choice !== args.choice) {
          conflict("This draft was already resolved with another choice.");
        }
        if (payload.status === "resolved") {
          await settleClaimGeneration(tx, payload);
          return;
        }
        if (payload.processingToken !== processingToken)
          conflict("This recovery choice is already being applied.");
        if (!(await settleAndResolveClaim(tx, claim.chatContext, payload)))
          conflict("The recovery claim was lost.");
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
            draft.editGeneration <= settledGeneration &&
            !automatic &&
            (payload.choice !== "save_separately" ||
              (await findExistingRecovery(tx)) !== null)
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
      if (
        claimed.status === "document_conflict" ||
        claimed.status === "recovery_required"
      )
        return claimed;
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
      const intent = titleIntent(draft, reviewedDocumentTitle);
      try {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .limit(1);
        if (
          current?.title === intent.title &&
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
            ...(intent.changesTitle
              ? { title: intent.title, baseTitle: reviewedDocumentTitle }
              : {}),
            content: draft.content,
            baseUpdatedAt: args.expectedDocumentUpdatedAt,
            recoveryExpectedUpdatedAt: args.expectedDocumentUpdatedAt,
            baseRevision,
            authoredBaseRevision: baseRevision,
            authoredBaseContent: current.content,
            authoredCandidateContent: draft.content,
            browserSaveAttemptId: processingToken,
            loadedUpdatedAt: draft.baseDocumentUpdatedAt ?? undefined,
            loadedContentWasEmpty: draft.loadedContentWasEmpty === 1,
            historySessionId: `draft-recovery:${draft.id}`,
            editorSessionId: automatic ? draft.editorSessionId! : claimId,
            editorEditGeneration: automatic ? draft.editGeneration! : 0,
            editorSnapshotTitle: intent.title,
            editorSnapshotContent: draft.content,
            preserveLeadingTitleHeading: true,
            reuseLabels: [],
          },
          automatic
            ? withAutomaticPreviewDraftRecoveryContext(
                withContentRecoverySaveContext({ ...ctx, caller: "frontend" }),
              )
            : withContentRecoverySaveContext({ ...ctx, caller: "frontend" }),
        );
        if ("conflict" in saved && saved.conflict === true) {
          const [winner] = await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, args.documentId))
            .limit(1);
          if (
            winner?.title === intent.title &&
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
          resultDocument.title !== intent.title ||
          !("content" in resultDocument) ||
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
      if (
        claimed.status === "document_conflict" ||
        claimed.status === "recovery_required"
      )
        return claimed;
      if (claimed.status === "resolved")
        return { status: "resolved" as const, choice: args.choice };
      if (!claimed.acquired && !(await acquireClaim()))
        return { status: "resolved" as const, choice: args.choice };
      await markClaimResolved();
      return { status: "resolved" as const, choice: args.choice };
    }

    const claimed = await claimExactDraft();
    if (
      claimed.status === "document_conflict" ||
      claimed.status === "recovery_required"
    )
      return claimed;
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
          withContentRecoverySaveContext({
            ...ctx,
            caller: ctx?.caller ?? "frontend",
          }),
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
