import { ActionContractError } from "@agent-native/core";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import { asc, inArray, sql, type SQL } from "drizzle-orm";

import type { getDb } from "../db/index.js";
import { documents } from "../db/schema.js";
import {
  assertLegacyBodyWritePath,
  isLiveBodyWriterPage,
  liveBodyWriterGateForRow,
  liveBodyWriterPageColumns,
} from "./live-body-writer.js";

type ContentDb = Pick<ReturnType<typeof getDb>, "select">;

export type LegacyBodyWrites = {
  /** The `body_revision` a SQL write of `content` leaves on a locked page. */
  bodyRevision(content: string | SQL): SQL<number>;
};

// Postgres caps one statement at 65,535 bound parameters.
const LOCK_BATCH = 1_000;

function bodyRevisionForContent(content: string | SQL) {
  return sql<number>`CASE WHEN ${documents.content} <> ${content} THEN ${documents.bodyRevision} + 1 ELSE ${documents.bodyRevision} END`;
}

/** True for the refusal of a page that takes body writes through its live copy. */
export function isUnsupportedBodyWriter(
  error: unknown,
): error is ActionContractError {
  return (
    error instanceof ActionContractError &&
    error.errorCode === "LIVE_BODY_WRITER_UNSUPPORTED"
  );
}

type LegacyBodyWriter = {
  operation: string;
  /** What to do instead, for a writer that has one, such as an action. */
  instead?: string;
};

function unsupportedBodyWriter(documentId: string, writer: LegacyBodyWriter) {
  return new ActionContractError(
    `Page ${documentId} takes body writes through its live copy, and ${writer.operation} can't write a body there yet. Retrying won't change that.${writer.instead ? ` ${writer.instead}` : ""}`,
    {
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      statusCode: 409,
      details: { documentId, operation: writer.operation },
    },
  );
}

/**
 * Locks the pages a SQL body write is about to change, in id order, and
 * refuses the write when any of them takes body writes through its live
 * copy: a SQL write there would never reach the copy or the tabs open on it.
 * Call it in the write's transaction, right before its UPDATE, so the pages
 * lock where the UPDATE would have locked them. Pages that don't exist are
 * left to the writer's own handling.
 *
 * A writer whose switched pages take another path passes `routed`, and a
 * page that switched while it was in flight refuses with the retryable
 * LIVE_BODY_WRITE_PATH_CHANGED. Any other writer refuses with
 * LIVE_BODY_WRITER_UNSUPPORTED, which a retry doesn't change.
 *
 * The flags and the live copy's version are read on `exec`, which defaults to
 * `getDbExec()`. That is the transaction only inside `getDb().transaction()`:
 * a writer inside a raw `getDbExec().transaction()` callback passes that
 * callback's exec, or the reads take a second pool connection, which a
 * one-connection serverless pool refuses as a self-deadlock.
 */
export async function lockLegacyBodyWrites(
  tx: ContentDb,
  documentIds: readonly string[],
  options: LegacyBodyWriter & { routed?: boolean; exec?: DbExec },
): Promise<LegacyBodyWrites> {
  const exec = options.exec ?? getDbExec();
  const ids = [...new Set(documentIds)].sort();
  for (let start = 0; start < ids.length; start += LOCK_BATCH) {
    // guard:allow-unscoped — locks pages the writer already resolved, and reads only their write-path columns.
    const rows = await tx
      .select(liveBodyWriterPageColumns)
      .from(documents)
      .where(inArray(documents.id, ids.slice(start, start + LOCK_BATCH)))
      .orderBy(asc(documents.id))
      .for("update");
    for (const row of rows) {
      if (options.routed) {
        await assertLegacyBodyWritePath(row, { transaction: exec });
        continue;
      }
      const gate = await liveBodyWriterGateForRow(row, { transaction: exec });
      if (gate.writePath === "live_copy") {
        throw unsupportedBodyWriter(row.id, options);
      }
    }
  }
  return { bodyRevision: bodyRevisionForContent };
}

/**
 * Refuses, before it changes anything outside Content, a writer that ends in
 * a SQL body write `lockLegacyBodyWrites` would refuse, such as a push that
 * writes the provider's copy of the body back. It reads the page unlocked,
 * so the writer still locks its pages before that write.
 */
export async function assertLegacyBodyWriter(
  documentId: string,
  options: LegacyBodyWriter,
): Promise<void> {
  if (await isLiveBodyWriterPage(documentId)) {
    throw unsupportedBodyWriter(documentId, options);
  }
}
