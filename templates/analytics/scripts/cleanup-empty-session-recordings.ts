#!/usr/bin/env tsx

/**
 * One-time maintenance for session replay rows created before the capture fix.
 *
 * Two jobs:
 *  1. Delete empty "shell" recordings — rows that were created on ingest but
 *     never stored any replay data (chunk_count = 0, event_count = 0, and no
 *     session_replay_chunks rows). These exist because, before the ingest
 *     credential-scope fix, blob storage failed in production (no resolvable
 *     upload provider) and left unplayable husks behind. They are always
 *     filtered out of /sessions, so this is pure DB hygiene.
 *  2. Backfill visibility "private" -> "org" for org-scoped recordings, so
 *     existing recordings follow the same org-visible model new ingests now use
 *     (teammates in the org can see them, not only the key owner).
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. This connects to whatever
 * DATABASE_URL the app is configured with, so double-check the target before
 * using --apply against production.
 *
 *   pnpm --filter analytics exec tsx scripts/cleanup-empty-session-recordings.ts            # dry run
 *   pnpm --filter analytics exec tsx scripts/cleanup-empty-session-recordings.ts --apply    # mutate
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index";
import migrations from "../server/plugins/db";

const apply = process.argv.includes("--apply");

const emptyShellCondition = and(
  eq(schema.sessionRecordings.chunkCount, 0),
  eq(schema.sessionRecordings.eventCount, 0),
  sql`not exists (
    select 1 from ${schema.sessionReplayChunks}
    where ${schema.sessionReplayChunks.recordingId} = ${schema.sessionRecordings.id}
  )`,
);

const orgPrivateCondition = and(
  isNotNull(schema.sessionRecordings.orgId),
  eq(schema.sessionRecordings.visibility, "private"),
);

async function countWhere(condition: unknown): Promise<number> {
  const db = getDb() as any;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.sessionRecordings)
    .where(condition);
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  await migrations({});
  const db = getDb() as any;

  const emptyShells = await countWhere(emptyShellCondition);
  const orgPrivate = await countWhere(orgPrivateCondition);

  console.log(`[cleanup] mode: ${apply ? "APPLY (mutating)" : "dry-run"}`);
  console.log(`[cleanup] empty shell recordings to delete: ${emptyShells}`);
  console.log(
    `[cleanup] org-scoped recordings to make org-visible: ${orgPrivate}`,
  );

  if (!apply) {
    console.log("[cleanup] dry-run only — re-run with --apply to mutate.");
    return;
  }

  // Backfill visibility first so we don't widen rows we're about to delete.
  await db
    .update(schema.sessionRecordings)
    .set({ visibility: "org" })
    .where(orgPrivateCondition);
  console.log(
    `[cleanup] backfilled ${orgPrivate} recordings to visibility=org`,
  );

  await db.delete(schema.sessionRecordings).where(emptyShellCondition);
  console.log(`[cleanup] deleted ${emptyShells} empty shell recordings`);
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
