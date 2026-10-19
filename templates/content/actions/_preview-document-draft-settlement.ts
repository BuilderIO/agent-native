import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";

type ContentDb = any;

export type PreviewDraftEditIdentity = {
  editorSessionId: string;
  editGeneration: number;
};

function settlementId() {
  return crypto.randomUUID();
}

const RECOVERY_CLAIM_OPERATIONS = [
  "use-saved-preview-draft",
  "claim-preview-draft-keep_mine",
  "claim-preview-draft-save_separately",
];

const recoveryClaimIdentity = z.object({
  choice: z.enum(["keep_mine", "use_saved", "save_separately"]),
  status: z.string(),
  editorSessionId: z.string().nullable().optional(),
  editGeneration: z.number().int().nullable().optional(),
});

type SettlementScope = {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  editorSessionId: string;
  now: string;
};

async function writePreviewDraftSettlement(
  input: SettlementScope & { editGeneration: number; discarded?: boolean },
) {
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

// The session's recovery claims as one JSON array, read in the same statement
// that locks its settlement row. That read sees claims as they were before the
// statement waited on the lock. It is enough only because a current resolver
// marks a claim resolved under this lock, once the row covers its generation,
// so a claim resolved during the wait is already in the locked row.
function recoveryClaimsOf(input: SettlementScope) {
  return input.db
    .select({
      chatContexts: sql`COALESCE(json_agg(${schema.documentVersions.chatContext}), '[]'::json)::text`,
    })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, input.ownerEmail),
        inArray(schema.documentVersions.operation, RECOVERY_CLAIM_OPERATIONS),
        or(
          eq(schema.documentVersions.documentId, input.documentId),
          eq(schema.documentVersions.documentId, schema.documentVersions.id),
        ),
        sql`strpos(${schema.documentVersions.chatContext}, ${`"editorSessionId":${JSON.stringify(input.editorSessionId)}`}) > 0`,
      ),
    );
}

/**
 * Resolvers before a claim and its settlement were written together could
 * mark a recovery choice resolved without settling its editor generation, and
 * those claims are still stored. Settle them under the session's settlement
 * lock, before any write trusts the watermark, so an edit the person chose to
 * discard stays refused when its tab or draft journal sends it again.
 */
async function settleResolvedRecoveryClaims(
  input: SettlementScope,
  locked: {
    settledGeneration: number;
    discardedGeneration: number | null;
    recoveryClaims: string;
  },
) {
  let settled: number | null = null;
  let discarded: number | null = null;
  for (const chatContext of z
    .array(z.string())
    .parse(JSON.parse(locked.recoveryClaims))) {
    const payload = recoveryClaimIdentity.parse(JSON.parse(chatContext));
    if (
      payload.status !== "resolved" ||
      payload.editorSessionId !== input.editorSessionId ||
      payload.editGeneration === null ||
      payload.editGeneration === undefined
    )
      continue;
    settled = Math.max(settled ?? -1, payload.editGeneration);
    if (payload.choice === "use_saved")
      discarded = Math.max(discarded ?? -1, payload.editGeneration);
  }
  if (settled === null) return false;
  let repaired = false;
  if (discarded !== null && discarded > (locked.discardedGeneration ?? -1)) {
    await writePreviewDraftSettlement({
      ...input,
      editGeneration: discarded,
      discarded: true,
    });
    repaired = true;
  }
  if (settled > Math.max(locked.settledGeneration, discarded ?? -1)) {
    await writePreviewDraftSettlement({ ...input, editGeneration: settled });
    repaired = true;
  }
  return repaired;
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
  const [locked] = await input.db
    .select({
      settledGeneration:
        schema.documentPreviewDraftSettlements.settledGeneration,
      discardedGeneration:
        schema.documentPreviewDraftSettlements.discardedGeneration,
      recoveryClaims: sql<string>`${recoveryClaimsOf(input)}`,
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
    .for("update", { of: schema.documentPreviewDraftSettlements });
  if (!locked)
    // guard:allow-bare-error — invariant: this transaction just upserted the row, and nothing deletes settlement rows.
    throw new Error(
      "The editor session's settlement row was not found after it was written",
    );
  if (await settleResolvedRecoveryClaims(input, locked))
    return readSettledPreviewDraftGeneration(input);
  return locked.settledGeneration;
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
  await writePreviewDraftSettlement(input);
}
