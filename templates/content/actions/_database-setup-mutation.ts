import { ActionContractError } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import {
  assertSchema,
  databaseMutationAgentTargetSchema,
  digest,
  loadContext,
  type MutationContext,
} from "./_database-row-mutation.js";
import { nanoid } from "./_property-utils.js";

export const setupGuardSchema = z.object({
  target: databaseMutationAgentTargetSchema.strict(),
  expectedSchemaRevision: z
    .string()
    .min(1)
    .describe(
      "Fresh schema revision from describe-content-database or get-content-database",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .describe("Unique intent key; reuse unchanged after a lost response"),
});

export const setupLifecycleSchema = z
  .object({
    target: databaseMutationAgentTargetSchema.strict(),
    expectedConfigurationRevision: z
      .string()
      .min(1)
      .describe(
        "Fresh configuration revision from database discovery or the last lifecycle receipt",
      ),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .describe("Unique intent key; reuse unchanged after a lost response"),
  })
  .strict();

type Db = ReturnType<typeof getDb>;
type Target = z.infer<typeof databaseMutationAgentTargetSchema>;
type Database = typeof schema.contentDatabases.$inferSelect;
export type DatabaseSetupReceipt = {
  receiptId: string;
  operation: string;
  outcome: "created" | "updated" | "unchanged" | "trashed" | "restored";
  target: Target;
  propertyId?: string;
  viewId?: string;
  idempotency: {
    key: string;
    result: "applied" | "replayed";
    payloadDigest: string;
  };
  revisions: {
    schemaBefore: string | null;
    schemaAfter: string;
    configurationBefore: string | null;
    configurationAfter: string;
  };
  readback: { verified: true };
  url: string;
};

export function setupAuditSummary(result: unknown, fallback: string): string {
  const receipt = (result as { receipt?: DatabaseSetupReceipt } | null)
    ?.receipt;
  if (!receipt) return fallback;
  const verb =
    receipt.idempotency.result === "replayed"
      ? "Verified earlier operation"
      : receipt.operation;
  return `${verb}; receipt ${receipt.receiptId}; property ${receipt.propertyId ?? "none"}; view ${receipt.viewId ?? "none"}; schema ${receipt.revisions.schemaBefore ?? "none"} -> ${receipt.revisions.schemaAfter}; configuration ${receipt.revisions.configurationBefore ?? "none"} -> ${receipt.revisions.configurationAfter}`;
}

export async function refreshAfterSetup(
  receipt: DatabaseSetupReceipt,
): Promise<void> {
  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch {
    setupError(
      "READBACK_UNAVAILABLE",
      `Operation committed (receipt ${receipt.receiptId}), but its refresh signal failed. Retry the same input and idempotency key.`,
      503,
    );
  }
}

export function configurationRevision(database: Database): string {
  return digest({
    viewConfigJson: database.viewConfigJson,
    deletedAt: database.deletedAt,
    ownerDocumentId: database.ownerDocumentId,
    ownerBlockId: database.ownerBlockId,
  });
}

export function setupError(
  errorCode: string,
  message: string,
  statusCode = 409,
): never {
  throw new ActionContractError(message, { errorCode, statusCode });
}

export async function assertSetupAccess(
  tx: Db,
  target: Target,
  role: "editor" | "admin" = "editor",
) {
  const [document] = await tx
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, target.databaseDocumentId),
        accessFilter(schema.documents, schema.documentShares, undefined, role),
      ),
    );
  if (!document)
    setupError(
      "DATABASE_NOT_FOUND",
      "Content database is unavailable or you cannot edit it.",
      404,
    );
}

type StoredResult<T> = { receipt: DatabaseSetupReceipt; value: T };
type Claim = typeof schema.contentDatabaseSetupReceipts.$inferSelect;

export async function claimSetupIntent(
  tx: Db,
  operation: string,
  scopeId: string,
  idempotencyKey: string,
  payload: unknown,
): Promise<Claim> {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email)
    setupError("UNAUTHORIZED", "Sign in to change a Content database.", 401);
  const payloadDigest = digest(payload);
  const table = schema.contentDatabaseSetupReceipts;
  const inserted = await tx
    .insert(table)
    .values({
      id: nanoid(),
      actorEmail: email,
      operation,
      scopeId,
      idempotencyKey,
      payloadDigest,
    })
    .onConflictDoNothing()
    .returning({ id: table.id });
  // The unique claim serializes identical requests across hosted workers, including creation before a database exists.
  const [claim] = await tx
    .update(table)
    .set({ payloadDigest: sql`${table.payloadDigest}` })
    .where(
      and(
        eq(table.actorEmail, email),
        eq(table.operation, operation),
        eq(table.scopeId, scopeId),
        eq(table.idempotencyKey, idempotencyKey),
      ),
    )
    .returning();
  if (!claim)
    setupError(
      "RECEIPT_MISMATCH",
      "The database operation claim could not be read.",
    );
  if (claim.payloadDigest !== payloadDigest)
    setupError(
      "IDEMPOTENCY_KEY_REUSED",
      "This key was already used for a different database operation. Use the original payload to retry it.",
    );
  if (inserted.length === 0 && claim.resultJson === null)
    setupError(
      "RECEIPT_MISMATCH",
      "A saved operation is missing its receipt. It cannot safely be applied again.",
    );
  return claim;
}

export function replaySetupIntent<T>(
  claim: Claim,
  expectedTarget?: Partial<Target>,
): StoredResult<T> | null {
  if (claim.resultJson === null) return null;
  let parsed: StoredResult<T>;
  try {
    parsed = JSON.parse(claim.resultJson);
  } catch {
    return setupError(
      "RECEIPT_MISMATCH",
      "The saved database operation receipt is unreadable.",
    );
  }
  if (
    parsed?.receipt?.receiptId !== claim.id ||
    parsed.receipt.operation !== claim.operation ||
    parsed.receipt.target?.databaseId !== claim.databaseId ||
    parsed.receipt.idempotency?.payloadDigest !== claim.payloadDigest ||
    parsed.receipt.idempotency.key !== claim.idempotencyKey ||
    parsed.receipt.readback?.verified !== true ||
    Object.entries(expectedTarget ?? {}).some(
      ([key, value]) => parsed.receipt.target[key as keyof Target] !== value,
    )
  ) {
    setupError(
      "RECEIPT_MISMATCH",
      "The saved database operation receipt is inconsistent.",
    );
  }
  const value = parsed.value as Record<string, unknown> | null;
  if (
    !value ||
    typeof value !== "object" ||
    (value.databaseId !== undefined &&
      value.databaseId !== parsed.receipt.target.databaseId) ||
    (value.documentId !== undefined &&
      value.documentId !== parsed.receipt.target.databaseDocumentId) ||
    (parsed.receipt.propertyId !== undefined &&
      value.id !== parsed.receipt.propertyId) ||
    (parsed.receipt.viewId !== undefined &&
      value.id !== parsed.receipt.viewId &&
      value.defaultViewId !== parsed.receipt.viewId)
  ) {
    setupError(
      "RECEIPT_MISMATCH",
      "The saved database operation result does not match its receipt.",
    );
  }
  return {
    ...parsed,
    receipt: {
      ...parsed.receipt,
      idempotency: { ...parsed.receipt.idempotency, result: "replayed" },
    },
  };
}

export async function finishSetupIntent<T>(
  tx: Db,
  claim: Claim,
  target: Target,
  before: MutationContext | null,
  after: MutationContext,
  result: {
    outcome: DatabaseSetupReceipt["outcome"];
    propertyId?: string;
    viewId?: string;
    value: T;
  },
): Promise<StoredResult<T>> {
  if (
    (result.outcome === "trashed" && after.database.deletedAt === null) ||
    (result.outcome === "restored" && after.database.deletedAt !== null)
  )
    setupError(
      "READBACK_UNAVAILABLE",
      "The lifecycle change could not be verified and was rolled back.",
    );
  if (
    result.propertyId &&
    !after.definitions.some((definition) => definition.id === result.propertyId)
  )
    setupError(
      "READBACK_UNAVAILABLE",
      "The property change could not be verified and was rolled back.",
    );
  const { value, ...changed } = result;
  const url = `/page/${encodeURIComponent(target.databaseDocumentId)}${result.viewId ? `?viewId=${encodeURIComponent(result.viewId)}` : ""}`;
  const completed: StoredResult<T> = {
    value,
    receipt: {
      receiptId: claim.id,
      operation: claim.operation,
      target,
      ...changed,
      idempotency: {
        key: claim.idempotencyKey,
        result: "applied",
        payloadDigest: claim.payloadDigest,
      },
      revisions: {
        schemaBefore: before?.schemaRevision ?? null,
        schemaAfter: after.schemaRevision,
        configurationBefore: before
          ? configurationRevision(before.database)
          : null,
        configurationAfter: configurationRevision(after.database),
      },
      readback: { verified: true },
      url,
    },
  };
  await tx
    .update(schema.contentDatabaseSetupReceipts)
    .set({
      databaseId: target.databaseId,
      resultJson: JSON.stringify(completed),
    })
    .where(eq(schema.contentDatabaseSetupReceipts.id, claim.id));
  return completed;
}

export async function runDatabaseSetupMutation<T>(args: {
  operation: string;
  input: {
    target: Target;
    expectedSchemaRevision?: string;
    expectedConfigurationRevision?: string;
    idempotencyKey: string;
  };
  payload: unknown;
  role?: "editor" | "admin";
  includeDeleted?: boolean;
  lock?: (tx: Db) => Promise<unknown>;
  apply: (
    tx: Db,
    context: MutationContext,
  ) => Promise<{
    outcome: DatabaseSetupReceipt["outcome"];
    propertyId?: string;
    viewId?: string;
    value: T;
  }>;
}): Promise<StoredResult<T>> {
  const { input } = args;
  await assertAccess(
    "document",
    input.target.databaseDocumentId,
    args.role ?? "editor",
  );
  return getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    if (args.lock) await args.lock(tx);
    else await lockContentDatabaseMutation(tx, input.target.databaseId);
    await assertSetupAccess(tx, input.target, args.role);
    const before = await loadContext(
      input.target,
      "editor",
      tx,
      true,
      args.includeDeleted,
    );
    const claim = await claimSetupIntent(
      tx,
      args.operation,
      input.target.databaseId,
      input.idempotencyKey,
      args.payload,
    );
    const replay = replaySetupIntent<T>(claim, input.target);
    if (replay) return replay;
    if (input.expectedSchemaRevision !== undefined)
      assertSchema(before, input.expectedSchemaRevision);
    if (
      input.expectedConfigurationRevision !== undefined &&
      input.expectedConfigurationRevision !==
        configurationRevision(before.database)
    ) {
      setupError(
        "CONFIGURATION_REVISION_CONFLICT",
        "The database configuration changed. Read it again before choosing an update.",
      );
    }
    const result = await args.apply(tx, before);
    const after = await loadContext(
      input.target,
      "editor",
      tx,
      true,
      args.includeDeleted,
    );
    return finishSetupIntent(tx, claim, input.target, before, after, result);
  });
}
