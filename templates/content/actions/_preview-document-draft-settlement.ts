import { and, eq, lte, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";

type ContentDb = any;

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
  return readSettledPreviewDraftGeneration(input);
}

export async function settlePreviewDocumentDraft(input: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
  editGeneration: number;
  discarded?: boolean;
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
      ),
    );
}
