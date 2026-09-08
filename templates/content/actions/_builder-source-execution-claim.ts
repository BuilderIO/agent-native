import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { builderExecutionHasResponseEvidence } from "./_builder-source-execution-preservation.js";

function claimId(sourceId: string, idempotencyKey: string) {
  return createHash("sha256")
    .update(`${sourceId}\u0000${idempotencyKey}`)
    .digest("hex");
}

function evidenceRank(row: {
  state: string;
  payloadJson: string;
  updatedAt: string;
  id: string;
}) {
  const stateRank =
    row.state === "succeeded"
      ? 0
      : row.state === "response_received"
        ? 1
        : row.state === "reconciliation_required"
          ? 2
          : builderExecutionHasResponseEvidence(row.payloadJson)
            ? 3
            : row.state === "running"
              ? 4
              : 5;
  return { stateRank, updatedAt: row.updatedAt, id: row.id };
}

function canonicalExecution<
  T extends {
    state: string;
    payloadJson: string;
    updatedAt: string;
    id: string;
  },
>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const a = evidenceRank(left);
    const b = evidenceRank(right);
    return (
      a.stateRank - b.stateRank ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id.localeCompare(b.id)
    );
  })[0];
}

export async function claimBuilderSourceExecutionGate(args: {
  ownerEmail: string;
  sourceId: string;
  idempotencyKey: string;
  now: string;
}) {
  const db = getDb();
  const whereKey = and(
    eq(schema.contentDatabaseSourceExecutionClaims.ownerEmail, args.ownerEmail),
    eq(schema.contentDatabaseSourceExecutionClaims.sourceId, args.sourceId),
    eq(
      schema.contentDatabaseSourceExecutionClaims.idempotencyKey,
      args.idempotencyKey,
    ),
  );
  const [existingClaim] = await db
    .select()
    .from(schema.contentDatabaseSourceExecutionClaims)
    .where(whereKey)
    .limit(1);
  if (existingClaim) return existingClaim.executionId;

  const candidates = await db
    .select()
    .from(schema.contentDatabaseSourceExecutions)
    .where(
      and(
        eq(schema.contentDatabaseSourceExecutions.ownerEmail, args.ownerEmail),
        eq(schema.contentDatabaseSourceExecutions.sourceId, args.sourceId),
        eq(
          schema.contentDatabaseSourceExecutions.idempotencyKey,
          args.idempotencyKey,
        ),
      ),
    );
  const canonical = canonicalExecution(candidates);
  const executionId = canonical?.id ?? crypto.randomUUID();

  try {
    await db.insert(schema.contentDatabaseSourceExecutionClaims).values({
      id: claimId(args.sourceId, args.idempotencyKey),
      ownerEmail: args.ownerEmail,
      sourceId: args.sourceId,
      idempotencyKey: args.idempotencyKey,
      executionId,
      createdAt: args.now,
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(schema.contentDatabaseSourceExecutionClaims)
      .where(whereKey)
      .limit(1);
    if (!winner) throw error;
    return winner.executionId;
  }

  if (candidates.length > 1 && canonical) {
    await db
      .update(schema.contentDatabaseSourceExecutions)
      .set({
        state: "reconciliation_required",
        summary: "Duplicate execution gates require reconciliation.",
        lastError:
          "Multiple execution rows exist for this idempotency key. Evidence was preserved; do not retry.",
        updatedAt: args.now,
      })
      .where(eq(schema.contentDatabaseSourceExecutions.id, canonical.id));
  }
  return executionId;
}
