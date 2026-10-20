import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { claimSetupIntent, setupError } from "./_database-setup-mutation.js";

type Db = ReturnType<typeof getDb>;
type Claim = Awaited<ReturnType<typeof claimSetupIntent>>;

export type DocumentLifecycleOperation = "delete-document" | "restore-document";

export type DocumentLifecycleReceipt = {
  receiptId: string;
  operation: DocumentLifecycleOperation;
  outcome: "trashed" | "restored" | "unchanged";
  documentId: string;
  idempotency: {
    key: string;
    result: "applied" | "replayed";
    payloadDigest: string;
  };
  readback: { verified: true };
  url: string;
};

export type DocumentLifecycleValue = {
  documentId: string;
  title: string;
  updatedAt: string;
  trashedAt: string | null;
  trashRootId: string | null;
  affectedDocumentIds: string[];
  affectedDocumentCount: number;
  affectedDocumentIdsComplete: boolean;
};

type StoredLifecycleResult = {
  receipt: DocumentLifecycleReceipt;
  value: DocumentLifecycleValue;
};

const AFFECTED_ID_LIMIT = 100;
const AGENT_CALLERS = new Set(["tool", "mcp", "webmcp", "a2a"]);

export function usesDocumentLifecycleProtocol(
  args: object,
  ctx?: { caller?: string },
): boolean {
  return AGENT_CALLERS.has(ctx?.caller ?? "") || "idempotencyKey" in args;
}

export function parseDocumentLifecycleInput<T extends z.ZodType>(
  inputSchema: T,
  args: unknown,
  requirement: string,
): z.infer<T> {
  const parsed = inputSchema.safeParse(args);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  return setupError(
    "DOCUMENT_LIFECYCLE_PROTOCOL_REQUIRED",
    `${requirement} (${issues})`,
    400,
  );
}

export async function lockLifecycleDocument(
  tx: Db,
  documentId: string,
  ownerEmail: string,
) {
  const [document] = await tx
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      updatedAt: schema.documents.updatedAt,
      trashedAt: schema.documents.trashedAt,
      trashRootId: schema.documents.trashRootId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.ownerEmail, ownerEmail),
      ),
    )
    .for("update");
  if (!document)
    setupError(
      "DOCUMENT_NOT_FOUND",
      `Document "${documentId}" not found.`,
      404,
    );
  return document;
}

export async function assertPageLifecycleTarget(
  tx: Db,
  documentId: string,
  operation: DocumentLifecycleOperation,
) {
  const [database] = await tx
    .select({
      id: schema.contentDatabases.id,
      systemRole: schema.contentDatabases.systemRole,
      ownerDocumentId: schema.contentDatabases.ownerDocumentId,
    })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, documentId))
    .limit(1);
  if (!database) return;
  if (database.systemRole)
    setupError(
      "SYSTEM_DOCUMENT",
      "System Content pages cannot move to or from Trash.",
      400,
    );
  if (database.ownerDocumentId)
    setupError(
      "UNSUPPORTED_DATABASE",
      `This page backs an inline collection on page "${database.ownerDocumentId}". Manage it from that page.`,
      400,
    );
  setupError(
    "COLLECTION_PAGE",
    operation === "delete-document"
      ? `This page is collection "${database.id}". Move it to Trash with delete-content-database.`
      : `This page is collection "${database.id}". Restore it with restore-content-database.`,
    400,
  );
}

export async function claimDocumentLifecycleIntent(
  tx: Db,
  operation: DocumentLifecycleOperation,
  documentId: string,
  idempotencyKey: string,
  payload: unknown,
) {
  const claim = await claimSetupIntent(
    tx,
    operation,
    documentId,
    idempotencyKey,
    payload,
  );
  return { claim, replay: replayDocumentLifecycleIntent(claim) };
}

function replayDocumentLifecycleIntent(
  claim: Claim,
): StoredLifecycleResult | null {
  if (claim.resultJson === null) return null;
  let parsed: StoredLifecycleResult;
  try {
    parsed = JSON.parse(claim.resultJson);
  } catch {
    return setupError(
      "RECEIPT_MISMATCH",
      "The saved page operation receipt is unreadable.",
    );
  }
  const receipt = parsed?.receipt;
  if (
    receipt?.receiptId !== claim.id ||
    receipt.operation !== claim.operation ||
    receipt.documentId !== claim.scopeId ||
    parsed.value?.documentId !== claim.scopeId ||
    receipt.idempotency?.key !== claim.idempotencyKey ||
    receipt.idempotency.payloadDigest !== claim.payloadDigest ||
    receipt.readback?.verified !== true
  ) {
    setupError(
      "RECEIPT_MISMATCH",
      "The saved page operation receipt is inconsistent.",
    );
  }
  return {
    value: parsed.value,
    receipt: {
      ...receipt,
      idempotency: { ...receipt.idempotency, result: "replayed" },
    },
  };
}

export async function finishDocumentLifecycleIntent(
  tx: Db,
  claim: Claim,
  outcome: DocumentLifecycleReceipt["outcome"],
  document: {
    id: string;
    title: string;
    updatedAt: string;
    trashedAt: string | null;
    trashRootId: string | null;
  },
  affectedDocumentIds: string[],
): Promise<StoredLifecycleResult> {
  const completed: StoredLifecycleResult = {
    value: {
      documentId: document.id,
      title: document.title.trim() || "Untitled",
      updatedAt: document.updatedAt,
      trashedAt: document.trashedAt,
      trashRootId: document.trashRootId,
      affectedDocumentIds: affectedDocumentIds.slice(0, AFFECTED_ID_LIMIT),
      affectedDocumentCount: affectedDocumentIds.length,
      affectedDocumentIdsComplete:
        affectedDocumentIds.length <= AFFECTED_ID_LIMIT,
    },
    receipt: {
      receiptId: claim.id,
      operation: claim.operation as DocumentLifecycleOperation,
      outcome,
      documentId: document.id,
      idempotency: {
        key: claim.idempotencyKey,
        result: "applied",
        payloadDigest: claim.payloadDigest,
      },
      readback: { verified: true },
      url: document.trashedAt
        ? "/trash"
        : `/page/${encodeURIComponent(document.id)}`,
    },
  };
  await tx
    .update(schema.contentDatabaseSetupReceipts)
    .set({ resultJson: JSON.stringify(completed) })
    .where(eq(schema.contentDatabaseSetupReceipts.id, claim.id));
  return completed;
}

export async function refreshAfterDocumentLifecycle(
  receipt: DocumentLifecycleReceipt,
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
