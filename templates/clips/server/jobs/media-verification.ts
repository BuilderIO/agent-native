import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import finalizeRecording from "../../actions/finalize-recording.js";

const SWEEP_INTERVAL_MS = 60_000;
const DISPATCH_FALLBACK_GRACE_MS = 30_000;
const MAX_ATTEMPTS = 10;
const STATE_PREFIX = "recording-upload-";
let skippingLogged = false;

function stateString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function stateNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export async function runMediaVerificationSweepOnce(): Promise<void> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT session_id, key, value FROM application_state WHERE key LIKE ?`,
    args: [`${STATE_PREFIX}%`],
  });
  const now = Date.now();

  for (const row of rows as Array<{
    session_id?: unknown;
    key?: unknown;
    value?: unknown;
  }>) {
    const rawValue = typeof row.value === "string" ? row.value : "";
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(rawValue) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      state.status !== "processing" ||
      state.pendingMediaVerification !== true
    ) {
      continue;
    }

    const recordingId = stateString(state, "recordingId");
    const ownerEmail =
      stateString(state, "ownerEmail") ||
      (typeof row.session_id === "string" ? row.session_id : "");
    const nextAttemptAt = Date.parse(
      stateString(state, "mediaVerificationNextAttemptAt") ?? "",
    );
    const completedAttempts = Math.max(
      0,
      Math.floor(stateNumber(state, "mediaVerificationAttempt") ?? 0),
    );
    if (
      !recordingId ||
      !ownerEmail ||
      completedAttempts >= MAX_ATTEMPTS ||
      !Number.isFinite(nextAttemptAt) ||
      now < nextAttemptAt + DISPATCH_FALLBACK_GRACE_MS
    ) {
      continue;
    }

    try {
      await runWithRequestContext(
        {
          userEmail: ownerEmail,
          orgId: stateString(state, "orgId"),
        },
        async () => {
          await finalizeRecording.run({
            id: recordingId,
            mediaVerificationRetryAttempt: Math.min(
              MAX_ATTEMPTS,
              completedAttempts + 1,
            ),
          });
        },
      );
    } catch (err) {
      console.warn("[media-verification] sweep item failed", {
        key: String(row.key ?? ""),
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export default function registerMediaVerificationJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[media-verification] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    runMediaVerificationSweepOnce().catch((err) =>
      console.error("[media-verification] interval failed:", err),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[media-verification] Recurring recovery sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
