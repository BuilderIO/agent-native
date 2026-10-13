import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import type { IndexRunSummary, IndexRunTrigger } from "./brain-contract";

// A run still "running" after this long was abandoned (for example, the
// function was cut off mid-build) and must not block or pose as in-flight.
export const SOURCE_INDEX_RUN_STALE_AFTER_MS = 30 * 60 * 1000;

// The table is created by a migration in server/plugins/db.ts. Hosted request
// paths never run DDL, so this stays a documented constant to paste there.
export const SOURCE_INDEX_RUNS_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS source_index_runs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    entry_count INTEGER,
    source_revisions TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_by_email TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS source_index_runs_org_started_idx ON source_index_runs (org_id, started_at)`,
];

type RunRow = typeof schema.sourceIndexRuns.$inferSelect;

const sourceRevisionsSchema = z.record(z.string(), z.string());

export function toIndexRunSummary(row: RunRow): IndexRunSummary {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    entryCount: row.entryCount,
    sourceRevisions: sourceRevisionsSchema.parse(
      JSON.parse(row.sourceRevisions),
    ),
    error: row.error,
    createdByEmail: row.createdByEmail,
  };
}

export function requireSourceIndexReadOrg(): string {
  if (!getRequestUserEmail()) {
    fail("An authenticated user is required to read source index runs.", {
      errorCode: "authentication_required",
      statusCode: 401,
    });
  }
  const orgId = getRequestOrgId();
  if (!orgId) {
    fail("An active organization is required to read source index runs.", {
      errorCode: "organization_required",
      statusCode: 403,
    });
  }
  return orgId;
}

export async function createSourceIndexRun(input: {
  orgId: string;
  trigger: IndexRunTrigger;
  createdByEmail: string;
}): Promise<IndexRunSummary> {
  const row: RunRow = {
    id: randomUUID(),
    orgId: input.orgId,
    status: "running",
    trigger: input.trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    entryCount: null,
    sourceRevisions: "{}",
    error: null,
    createdByEmail: input.createdByEmail,
  };
  await getDb().insert(schema.sourceIndexRuns).values(row);
  return toIndexRunSummary(row);
}

export type SourceIndexRunOutcome =
  | {
      status: "succeeded";
      entryCount: number;
      sourceRevisions: Record<string, string>;
    }
  | { status: "failed"; error: string };

// Returns the row read back from the database, so the caller reports what was
// persisted rather than what it tried to write.
export async function finishSourceIndexRun(
  id: string,
  orgId: string,
  outcome: SourceIndexRunOutcome,
): Promise<IndexRunSummary> {
  const finishedAt = new Date().toISOString();
  const values =
    outcome.status === "succeeded"
      ? {
          status: outcome.status,
          finishedAt,
          entryCount: outcome.entryCount,
          sourceRevisions: JSON.stringify(outcome.sourceRevisions),
          error: null,
        }
      : {
          status: outcome.status,
          finishedAt,
          error: outcome.error,
        };
  await getDb()
    .update(schema.sourceIndexRuns)
    .set(values)
    .where(
      and(
        eq(schema.sourceIndexRuns.id, id),
        eq(schema.sourceIndexRuns.orgId, orgId),
      ),
    );
  const [row] = await getDb()
    .select()
    .from(schema.sourceIndexRuns)
    .where(
      and(
        eq(schema.sourceIndexRuns.id, id),
        eq(schema.sourceIndexRuns.orgId, orgId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(`Source index run ${id} is missing after it was finished.`);
  }
  return toIndexRunSummary(row);
}

export async function listSourceIndexRuns(
  orgId: string,
  limit: number,
): Promise<IndexRunSummary[]> {
  const rows = await getDb()
    .select()
    .from(schema.sourceIndexRuns)
    .where(eq(schema.sourceIndexRuns.orgId, orgId))
    .orderBy(desc(schema.sourceIndexRuns.startedAt))
    .limit(limit);
  return rows.map(toIndexRunSummary);
}
