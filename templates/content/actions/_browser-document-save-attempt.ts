import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export interface BrowserSaveAttemptConfirmation {
  attemptId: string;
  result: "applied" | "replayed";
  revision: string;
  updatedAt: string;
  softDeletedDatabaseIds?: string[];
}

export interface BrowserSaveAttemptPreservation {
  kind: "preservation-required";
  attemptId: string;
  result: "applied" | "replayed";
  revision: string;
  updatedAt: string;
  reason: "structure" | "provenance";
  checkpointId: string;
}

export type BrowserSaveAttemptResult =
  | BrowserSaveAttemptConfirmation
  | BrowserSaveAttemptPreservation;

export function browserSavePayloadDigest(payload: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

export async function findBrowserSaveAttempt(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  actorEmail: string;
  orgId: string;
  attemptId: string;
}) {
  const [stored] = await args.db
    .select()
    .from(schema.documentBrowserSaveAttempts)
    .where(
      and(
        eq(schema.documentBrowserSaveAttempts.documentId, args.documentId),
        eq(schema.documentBrowserSaveAttempts.actorEmail, args.actorEmail),
        eq(schema.documentBrowserSaveAttempts.orgId, args.orgId),
        eq(schema.documentBrowserSaveAttempts.attemptId, args.attemptId),
      ),
    )
    .limit(1);
  return stored;
}

export function readBrowserSaveAttempt(
  stored: typeof schema.documentBrowserSaveAttempts.$inferSelect,
  payloadDigest?: string,
): BrowserSaveAttemptResult {
  if (payloadDigest && stored.payloadDigest !== payloadDigest) {
    throw new ActionContractError(
      "This browser save attempt ID was already used for a different payload.",
      { errorCode: "BROWSER_SAVE_ATTEMPT_REUSED", statusCode: 409 },
    );
  }
  const result = JSON.parse(stored.resultJson) as {
    kind?: unknown;
    revision?: unknown;
    updatedAt?: unknown;
    reason?: unknown;
    checkpointId?: unknown;
    softDeletedDatabaseIds?: unknown;
  };
  if (
    typeof result.revision !== "string" ||
    typeof result.updatedAt !== "string"
  ) {
    throw new ActionContractError(
      "The stored browser save receipt is inconsistent.",
      { errorCode: "BROWSER_SAVE_RECEIPT_INVALID", statusCode: 500 },
    );
  }
  if (result.kind === "preservation-required") {
    if (
      (result.reason !== "structure" && result.reason !== "provenance") ||
      typeof result.checkpointId !== "string" ||
      !result.checkpointId
    ) {
      throw new ActionContractError(
        "The stored browser preservation receipt is inconsistent.",
        { errorCode: "BROWSER_SAVE_RECEIPT_INVALID", statusCode: 500 },
      );
    }
    return {
      kind: "preservation-required",
      attemptId: stored.attemptId,
      result: "replayed",
      revision: result.revision,
      updatedAt: result.updatedAt,
      reason: result.reason,
      checkpointId: result.checkpointId,
    };
  }
  if (result.kind !== undefined) {
    throw new ActionContractError(
      "The stored browser save receipt has an unknown outcome.",
      { errorCode: "BROWSER_SAVE_RECEIPT_INVALID", statusCode: 500 },
    );
  }
  if (
    result.softDeletedDatabaseIds !== undefined &&
    (!Array.isArray(result.softDeletedDatabaseIds) ||
      result.softDeletedDatabaseIds.some((id) => typeof id !== "string"))
  ) {
    throw new ActionContractError(
      "The stored browser save receipt has invalid database IDs.",
      { errorCode: "BROWSER_SAVE_RECEIPT_INVALID", statusCode: 500 },
    );
  }
  return {
    attemptId: stored.attemptId,
    result: "replayed",
    revision: result.revision,
    updatedAt: result.updatedAt,
    softDeletedDatabaseIds: result.softDeletedDatabaseIds as
      | string[]
      | undefined,
  };
}
