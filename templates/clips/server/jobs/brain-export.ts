import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";

import exportToBrain from "../../actions/export-to-brain.js";
import { getDb, schema } from "../db/index.js";
import {
  BRAIN_EXPORT_STATE_PREFIX,
  parseBrainExportState,
  writeBrainExportState,
} from "../lib/brain-export-state.js";
import { ownerEmailMatches } from "../lib/recordings.js";

const SWEEP_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 8;
const SWEEP_LIMIT = 4;
const DISCOVERY_LIMIT = 20;
const BACKFILL_DAYS = 7;
let skippingLogged = false;

async function seedRecentBrainExports(): Promise<void> {
  const now = new Date();
  const { rows } = await getDbExec().execute({
    sql: `SELECT recordings.id, recordings.owner_email, recordings.org_id
      FROM recordings
      INNER JOIN recording_transcripts
        ON recording_transcripts.recording_id = recordings.id
      WHERE recordings.status = ?
        AND recordings.trashed_at IS NULL
        AND recordings.org_id IS NOT NULL
        AND recordings.created_at >= ?
        AND recording_transcripts.status = ?
        AND LENGTH(TRIM(COALESCE(recording_transcripts.full_text, ''))) > 0
        AND NOT EXISTS (
          SELECT 1 FROM application_state
          WHERE application_state.session_id = recordings.owner_email
            AND application_state.key = ? || recordings.id
        )
      ORDER BY recordings.created_at DESC
      LIMIT ?`,
    args: [
      "ready",
      new Date(
        now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
      "ready",
      BRAIN_EXPORT_STATE_PREFIX,
      DISCOVERY_LIMIT,
    ],
  });
  for (const row of rows as Array<{
    id?: unknown;
    owner_email?: unknown;
    org_id?: unknown;
  }>) {
    const recordingId = typeof row.id === "string" ? row.id.trim() : "";
    const ownerEmail =
      typeof row.owner_email === "string" ? row.owner_email.trim() : "";
    const orgId = typeof row.org_id === "string" ? row.org_id.trim() : "";
    if (!recordingId || !ownerEmail || !orgId) continue;
    await runWithRequestContext({ userEmail: ownerEmail, orgId }, () =>
      writeBrainExportState({
        recordingId,
        status: "pending",
        attempts: 0,
        updatedAt: now.toISOString(),
        nextAttemptAt: now.toISOString(),
      }),
    );
  }
}

export async function runBrainExportSweepOnce(): Promise<void> {
  await seedRecentBrainExports();
  const { rows } = await getDbExec().execute({
    sql: "SELECT session_id, key, value FROM application_state WHERE key LIKE ? AND (value LIKE ? OR value LIKE ?) ORDER BY updated_at ASC LIMIT ?",
    args: [
      `${BRAIN_EXPORT_STATE_PREFIX}%`,
      '%"status":"pending"%',
      '%"status":"failed"%',
      SWEEP_LIMIT,
    ],
  });
  const now = Date.now();
  for (const row of rows as Array<{
    session_id?: unknown;
    key?: unknown;
    value?: unknown;
  }>) {
    const ownerEmail =
      typeof row.session_id === "string" ? row.session_id.trim() : "";
    const key = typeof row.key === "string" ? row.key : "";
    const recordingId = key.slice(BRAIN_EXPORT_STATE_PREFIX.length);
    let raw: unknown;
    try {
      raw = JSON.parse(typeof row.value === "string" ? row.value : "");
    } catch {
      continue;
    }
    const state = parseBrainExportState(raw);
    if (
      !ownerEmail ||
      !recordingId ||
      !state ||
      state.recordingId !== recordingId ||
      !["pending", "failed"].includes(state.status) ||
      state.attempts >= MAX_ATTEMPTS ||
      Date.parse(state.nextAttemptAt ?? "") > now
    )
      continue;
    try {
      const [recording] = await getDb()
        .select({
          ownerEmail: schema.recordings.ownerEmail,
          orgId: schema.recordings.orgId,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.status, "ready"),
            isNull(schema.recordings.trashedAt),
          ),
        )
        .limit(1);
      if (!recording) continue;
      await runWithRequestContext(
        {
          userEmail: recording.ownerEmail,
          orgId: recording.orgId ?? undefined,
        },
        () =>
          exportToBrain.run({ recordingId, retryAttempt: state.attempts + 1 }),
      );
    } catch (error) {
      const attempts = state.attempts + 1;
      await runWithRequestContext({ userEmail: ownerEmail }, () =>
        writeBrainExportState({
          recordingId,
          status: "failed",
          attempts,
          reason: "brain-export-worker-failed",
          updatedAt: new Date().toISOString(),
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1)),
          ).toISOString(),
        }),
      );
      console.warn("[brain-export] sweep item failed", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export default function registerBrainExportJob(): void {
  if (process.env.NETLIFY === "true") return;
  const enabled =
    process.env.RUN_BACKGROUND_JOBS === "1" ||
    (process.env.NODE_ENV === "production" &&
      process.env.RUN_BACKGROUND_JOBS !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[brain-export] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    runBrainExportSweepOnce().catch((error) =>
      console.error("[brain-export] interval failed:", error),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[brain-export] Recurring recovery sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
