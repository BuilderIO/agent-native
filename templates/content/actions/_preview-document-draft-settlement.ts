import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { and, eq, lte, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";

type ContentDb = any;

const automaticRecoveryContexts = new WeakSet<ActionRunContext>();

export function withAutomaticPreviewDraftRecoveryContext(
  ctx: ActionRunContext,
) {
  automaticRecoveryContexts.add(ctx);
  return ctx;
}

export function isAutomaticPreviewDraftRecovery(ctx?: ActionRunContext) {
  return ctx !== undefined && automaticRecoveryContexts.has(ctx);
}

export async function assertAutomaticPreviewDraftGeneration(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string | null;
  editGeneration: number | null;
  now: string;
}) {
  if (input.editorSessionId === null || input.editGeneration === null) {
    throw new ActionContractError(
      "Automatic recovery requires the original editor generation.",
      {
        errorCode: "PREVIEW_DRAFT_AUTOMATIC_RECOVERY_REFUSED",
        statusCode: 409,
        details: { reason: "unknown_source" },
      },
    );
  }
  const reason = await previewDraftGenerationRefusal({
    ...input,
    editorSessionId: input.editorSessionId,
    editGeneration: input.editGeneration,
  });
  if (reason) {
    throw new ActionContractError(
      "This editor generation requires a reviewed recovery choice.",
      {
        errorCode: "PREVIEW_DRAFT_AUTOMATIC_RECOVERY_REFUSED",
        statusCode: 409,
        details: { reason },
      },
    );
  }
}

export async function previewDraftGenerationRefusal(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
  editGeneration: number;
  now: string;
}) {
  const settled = await lockPreviewDocumentDraftSettlement(input);
  const discarded = await readDiscardedPreviewDraftGeneration(input);
  if (discarded !== null && input.editGeneration <= discarded)
    return "discarded" as const;
  if (input.editGeneration <= settled) return "settled" as const;
  return null;
}

export type PreviewDraftEditIdentity = {
  editorSessionId: string;
  editGeneration: number;
};

function settlementId() {
  return crypto.randomUUID();
}

export async function readSettledPreviewDraftGeneration(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
}) {
  const [settlement] = await input.db
    .select({
      settledGeneration:
        schema.documentPreviewDraftSettlements.settledGeneration,
    })
    .from(schema.documentPreviewDraftSettlements)
    .where(
      and(
        eq(schema.documentPreviewDraftSettlements.ownerEmail, input.ownerEmail),
        eq(schema.documentPreviewDraftSettlements.orgId, input.orgId),
        eq(schema.documentPreviewDraftSettlements.documentId, input.documentId),
        eq(
          schema.documentPreviewDraftSettlements.editorSessionId,
          input.editorSessionId,
        ),
      ),
    )
    .limit(1);
  return settlement?.settledGeneration ?? null;
}

export async function readDiscardedPreviewDraftGeneration(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
}) {
  const [settlement] = await input.db
    .select({
      discardedGeneration:
        schema.documentPreviewDraftSettlements.discardedGeneration,
    })
    .from(schema.documentPreviewDraftSettlements)
    .where(
      and(
        eq(schema.documentPreviewDraftSettlements.ownerEmail, input.ownerEmail),
        eq(schema.documentPreviewDraftSettlements.orgId, input.orgId),
        eq(schema.documentPreviewDraftSettlements.documentId, input.documentId),
        eq(
          schema.documentPreviewDraftSettlements.editorSessionId,
          input.editorSessionId,
        ),
      ),
    )
    .limit(1);
  return settlement?.discardedGeneration ?? null;
}

export async function lockPreviewDocumentDraftSettlement(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
  now: string;
}) {
  await input.db
    .insert(schema.documentPreviewDraftSettlements)
    .values({
      id: settlementId(),
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
      documentId: input.documentId,
      editorSessionId: input.editorSessionId,
      settledGeneration: -1,
      updatedAt: input.now,
    })
    .onConflictDoNothing({
      target: [
        schema.documentPreviewDraftSettlements.ownerEmail,
        schema.documentPreviewDraftSettlements.orgId,
        schema.documentPreviewDraftSettlements.documentId,
        schema.documentPreviewDraftSettlements.editorSessionId,
      ],
    });
  await input.db
    .select({ id: schema.documentPreviewDraftSettlements.id })
    .from(schema.documentPreviewDraftSettlements)
    .where(
      and(
        eq(schema.documentPreviewDraftSettlements.ownerEmail, input.ownerEmail),
        eq(schema.documentPreviewDraftSettlements.orgId, input.orgId),
        eq(schema.documentPreviewDraftSettlements.documentId, input.documentId),
        eq(
          schema.documentPreviewDraftSettlements.editorSessionId,
          input.editorSessionId,
        ),
      ),
    )
    .for("update");
  const settled = await readSettledPreviewDraftGeneration(input);
  if (settled === null)
    throw new ActionContractError(
      "The editor generation fence could not be read.",
      {
        errorCode: "PREVIEW_DRAFT_SETTLEMENT_MISSING",
        statusCode: 500,
      },
    );
  return settled;
}

export async function fencePreviewDocumentDraftGeneration(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
  editGeneration: number;
  now: string;
}) {
  await lockPreviewDocumentDraftSettlement(input);
  // A chosen-away generation cannot write the source page while its recovery
  // copy is pending. Settlement and draft cleanup still wait for that copy.
  await input.db
    .update(schema.documentPreviewDraftSettlements)
    .set({
      discardedGeneration: sql`GREATEST(COALESCE(${schema.documentPreviewDraftSettlements.discardedGeneration}, -1), ${input.editGeneration})`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.documentPreviewDraftSettlements.ownerEmail, input.ownerEmail),
        eq(schema.documentPreviewDraftSettlements.orgId, input.orgId),
        eq(schema.documentPreviewDraftSettlements.documentId, input.documentId),
        eq(
          schema.documentPreviewDraftSettlements.editorSessionId,
          input.editorSessionId,
        ),
      ),
    );
}

export async function settlePreviewDocumentDraft(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
  editGeneration: number;
  discarded?: boolean;
  draftSnapshot?: { id: string; version: number };
  now: string;
}) {
  await lockPreviewDocumentDraftSettlement(input);
  await input.db
    .insert(schema.documentPreviewDraftSettlements)
    .values({
      id: settlementId(),
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
      documentId: input.documentId,
      editorSessionId: input.editorSessionId,
      settledGeneration: input.editGeneration,
      discardedGeneration: input.discarded ? input.editGeneration : null,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        schema.documentPreviewDraftSettlements.ownerEmail,
        schema.documentPreviewDraftSettlements.orgId,
        schema.documentPreviewDraftSettlements.documentId,
        schema.documentPreviewDraftSettlements.editorSessionId,
      ],
      set: {
        settledGeneration: sql`GREATEST(${schema.documentPreviewDraftSettlements.settledGeneration}, ${input.editGeneration})`,
        ...(input.discarded
          ? {
              discardedGeneration: sql`GREATEST(COALESCE(${schema.documentPreviewDraftSettlements.discardedGeneration}, -1), ${input.editGeneration})`,
            }
          : {}),
        updatedAt: input.now,
      },
    });

  await input.db
    .delete(schema.documentPreviewDrafts)
    .where(
      and(
        eq(schema.documentPreviewDrafts.ownerEmail, input.ownerEmail),
        eq(schema.documentPreviewDrafts.orgId, input.orgId),
        eq(schema.documentPreviewDrafts.documentId, input.documentId),
        eq(schema.documentPreviewDrafts.editorSessionId, input.editorSessionId),
        lte(schema.documentPreviewDrafts.editGeneration, input.editGeneration),
        ...(input.draftSnapshot === undefined
          ? []
          : [
              eq(schema.documentPreviewDrafts.id, input.draftSnapshot.id),
              eq(
                schema.documentPreviewDrafts.version,
                input.draftSnapshot.version,
              ),
            ]),
      ),
    );
}
