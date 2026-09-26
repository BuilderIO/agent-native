import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { coreScripts } from "@agent-native/core/scripts";
import {
  getThread,
  registerRecurringSweepHandler,
  runWithRequestContext,
} from "@agent-native/core/server";

import {
  extractAnalyticsMemoryCandidates,
  type AnalyticsMemoryMessage,
} from "./analytics-memory-extractor.js";

export const ANALYTICS_MEMORY_CAPTURE_IDLE_MS = 15 * 60_000;
const WORKER_LEASE_MS = 10 * 60_000;
const MAX_CAPTURE_ATTEMPTS = 5;
const THREAD_ENTRY_SCAN_LIMIT = 2_000;
const THREAD_MESSAGE_LIMIT = 80;
const USER_TEXT_LIMIT = 321;
const ASSISTANT_TEXT_LIMIT = 300;
const QUEUE_TABLE = "analytics_memory_capture_queue";
const WORKER_LEASE_TABLE = "analytics_memory_capture_worker_lease";
const LOST_CAPTURE_WINDOW = Symbol("analytics-memory-capture-window-lost");
// ponytail: one lease serializes Memory.md updates; split per owner if throughput matters.

type CaptureJob = {
  owner_email: string;
  org_id: string | null;
  thread_id: string;
  attempt_count: number | string;
  lease_token: string;
  ready_at: number | string;
};

type CaptureOutcome =
  | "saved"
  | "no_candidates"
  | "skipped"
  | "retrying"
  | "failed";

function requestContext(owner: string, orgId: string | null) {
  return {
    userEmail: owner,
    run: { owner },
    ...(orgId ? { orgId } : { orgScope: "personal" as const }),
  };
}

function threadMessages(threadData: string): AnalyticsMemoryMessage[] {
  const parsed: unknown = JSON.parse(threadData);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Analytics memory capture found invalid thread data.");
  }
  const entries = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(entries)) {
    throw new Error("Analytics memory capture found no thread messages.");
  }

  const entriesById = new Map<string, Record<string, unknown>>();
  const orderedEntries = entries
    .slice(-THREAD_ENTRY_SCAN_LIMIT)
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    );
  for (const entry of orderedEntries) {
    const message =
      entry.message && typeof entry.message === "object"
        ? (entry.message as Record<string, unknown>)
        : entry;
    if (typeof message.id === "string") entriesById.set(message.id, entry);
  }

  const headId = (parsed as { headId?: unknown }).headId;
  if (typeof headId !== "string" || !headId || !entriesById.has(headId)) {
    return [];
  }

  const lineage: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let currentId: string | null = headId;
  while (
    currentId &&
    !seen.has(currentId) &&
    lineage.length < THREAD_ENTRY_SCAN_LIMIT
  ) {
    seen.add(currentId);
    const entry = entriesById.get(currentId);
    if (!entry) break;
    lineage.push(entry);
    currentId = typeof entry.parentId === "string" ? entry.parentId : null;
  }
  lineage.reverse();

  return lineage.slice(-THREAD_MESSAGE_LIMIT).flatMap((entry) => {
    const message =
      entry.message && typeof entry.message === "object"
        ? (entry.message as Record<string, unknown>)
        : entry;
    const role = message.role;
    if (role !== "user" && role !== "assistant") return [];

    const rawContent = message.content;
    const textParts = Array.isArray(rawContent)
      ? rawContent.flatMap((part) =>
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
            ? [(part as { text: string }).text]
            : [],
        )
      : typeof rawContent === "string"
        ? [rawContent]
        : typeof message.text === "string"
          ? [message.text]
          : [];
    const textLimit = role === "user" ? USER_TEXT_LIMIT : ASSISTANT_TEXT_LIMIT;
    let text = "";
    for (const part of textParts) {
      const remaining = textLimit - text.length;
      if (remaining <= 0) break;
      const separator = text ? "\n" : "";
      text += `${separator}${part.slice(0, Math.max(0, remaining - separator.length))}`;
    }
    if (!text) return [];

    return [
      {
        id: typeof message.id === "string" ? message.id : null,
        role,
        text,
      },
    ];
  });
}

async function trackCaptureOutcome(
  owner: string,
  orgId: string | null,
  outcome: CaptureOutcome,
  candidateCount: number,
  savedCount: number,
): Promise<void> {
  try {
    await runWithRequestContext(requestContext(owner, orgId), async () => {
      const { track } = await import("@agent-native/core/tracking");
      await track("analytics_memory_capture", {
        status: outcome,
        candidate_count: candidateCount,
        saved_count: savedCount,
      });
    });
  } catch (error) {
    console.warn("[analytics-memory-capture] outcome telemetry failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function enqueueAnalyticsMemoryCapture(input: {
  owner: string | null | undefined;
  orgId?: string | null;
  threadId: string;
}): Promise<boolean> {
  const owner = input.owner?.trim();
  const threadId = input.threadId.trim();
  if (!owner || !threadId) return false;

  const orgId = input.orgId ?? null;
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `INSERT INTO ${QUEUE_TABLE} (
      owner_email, thread_id, org_id, ready_at, attempt_count, created_at, updated_at
    )
    SELECT $1, $2, $3, $4, 0, $5, $5
    FROM chat_threads
    WHERE id = $2 AND owner_email = $1
      AND org_id IS NOT DISTINCT FROM $3
      AND source_app_id = 'analytics'
    ON CONFLICT (owner_email, thread_id) DO UPDATE SET
      org_id = EXCLUDED.org_id,
      ready_at = EXCLUDED.ready_at,
      attempt_count = 0,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = EXCLUDED.updated_at`,
    args: [owner, threadId, orgId, now + ANALYTICS_MEMORY_CAPTURE_IDLE_MS, now],
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
  return result.rowsAffected > 0;
}

async function acquireWorkerLease(
  token: string,
  now: number,
): Promise<boolean> {
  const { rows } = await getDbExec().execute({
    sql: `UPDATE ${WORKER_LEASE_TABLE}
    SET lease_token = $1, lease_expires_at = $2
    WHERE lease_id = 'analytics-memory-capture'
      AND (lease_token IS NULL OR lease_expires_at <= $3)
    RETURNING lease_id`,
    args: [token, now + WORKER_LEASE_MS, now],
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
  return rows.length > 0;
}

async function releaseWorkerLease(token: string): Promise<void> {
  await getDbExec().execute({
    sql: `UPDATE ${WORKER_LEASE_TABLE}
      SET lease_token = NULL, lease_expires_at = NULL
      WHERE lease_id = 'analytics-memory-capture' AND lease_token = $1`,
    args: [token],
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
}

async function claimDueJob(now: number): Promise<CaptureJob | null> {
  const token = randomUUID();
  const { rows } = await getDbExec().execute({
    sql: `WITH due AS (
      SELECT owner_email, thread_id
      FROM ${QUEUE_TABLE}
      WHERE ready_at <= $1
        AND (lease_token IS NULL OR lease_expires_at <= $1)
      ORDER BY ready_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${QUEUE_TABLE} AS queue
    SET lease_token = $2,
        lease_expires_at = $3,
        attempt_count = queue.attempt_count + 1,
        updated_at = $1
    FROM due
    WHERE queue.owner_email = due.owner_email AND queue.thread_id = due.thread_id
    RETURNING queue.owner_email, queue.org_id, queue.thread_id,
      queue.attempt_count, queue.lease_token, queue.ready_at`,
    args: [now, token, now + WORKER_LEASE_MS],
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
  return (rows[0] as CaptureJob | undefined) ?? null;
}

async function deleteJob(job: CaptureJob): Promise<void> {
  await getDbExec().execute({
    sql: `DELETE FROM ${QUEUE_TABLE}
      WHERE owner_email = $1 AND thread_id = $2 AND lease_token = $3`,
    args: [job.owner_email, job.thread_id, job.lease_token],
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
}

async function deferJob(job: CaptureJob, readyAt: number): Promise<void> {
  await getDbExec().execute({
    sql: `UPDATE ${QUEUE_TABLE}
      SET ready_at = $4, lease_token = NULL, lease_expires_at = NULL, updated_at = $5
      WHERE owner_email = $1 AND thread_id = $2 AND lease_token = $3`,
    args: [
      job.owner_email,
      job.thread_id,
      job.lease_token,
      readyAt,
      Date.now(),
    ],
    timeoutMs: 10_000,
    maxAttempts: 1,
  });
}

async function retryJob(job: CaptureJob): Promise<CaptureOutcome> {
  const attempts = Number(job.attempt_count);
  if (attempts >= MAX_CAPTURE_ATTEMPTS) {
    await deleteJob(job);
    return "failed";
  }
  const now = Date.now();
  const retryDelay = Math.min(60 * 60_000, 2 ** attempts * 60_000);
  await deferJob(job, now + retryDelay);
  return "retrying";
}

async function processJob(job: CaptureJob): Promise<void> {
  const owner = job.owner_email;
  const orgId = job.org_id ?? null;

  try {
    await runWithRequestContext(requestContext(owner, orgId), async () => {
      const thread = await getThread(job.thread_id);
      if (
        !thread ||
        thread.ownerEmail !== owner ||
        thread.orgId !== orgId ||
        thread.source?.appId !== "analytics"
      ) {
        await deleteJob(job);
        await trackCaptureOutcome(owner, orgId, "skipped", 0, 0);
        return;
      }

      const now = Date.now();
      const readyAt = Math.max(
        Number(job.ready_at),
        thread.updatedAt + ANALYTICS_MEMORY_CAPTURE_IDLE_MS,
      );
      if (readyAt > now) {
        await deferJob(job, readyAt);
        return;
      }

      const candidates = extractAnalyticsMemoryCandidates(
        threadMessages(thread.threadData),
      );
      if (candidates.length === 0) {
        await deleteJob(job);
        await trackCaptureOutcome(owner, orgId, "no_candidates", 0, 0);
        return;
      }

      const saveMemory = coreScripts["save-memory"];
      if (!saveMemory)
        throw new Error("Core save-memory script is unavailable.");

      let savedCount = 0;
      for (const candidate of candidates) {
        const args = [
          "--name",
          candidate.name,
          "--type",
          "reference",
          "--description",
          candidate.description,
          "--content",
          candidate.content,
        ];
        if (orgId) args.push("--scope", "current-org");
        args.push("--quiet", "true");
        try {
          await saveMemory(args, {
            beforeWrite: async (tx) => {
              const threadRows = await tx.execute({
                sql: `SELECT 1 FROM chat_threads
                  WHERE id = $1 AND owner_email = $2
                    AND org_id IS NOT DISTINCT FROM $3
                    AND updated_at = $4 AND source_app_id = 'analytics'
                  FOR UPDATE`,
                args: [job.thread_id, owner, orgId, thread.updatedAt],
                timeoutMs: 10_000,
                maxAttempts: 1,
              });
              if (threadRows.rows.length === 0) throw LOST_CAPTURE_WINDOW;

              const queueRows = await tx.execute({
                sql: `SELECT 1 FROM ${QUEUE_TABLE}
                  WHERE owner_email = $1 AND thread_id = $2
                    AND org_id IS NOT DISTINCT FROM $3
                    AND lease_token = $4 AND ready_at = $5
                  FOR UPDATE`,
                args: [
                  job.owner_email,
                  job.thread_id,
                  orgId,
                  job.lease_token,
                  job.ready_at,
                ],
                timeoutMs: 10_000,
                maxAttempts: 1,
              });
              if (queueRows.rows.length === 0) throw LOST_CAPTURE_WINDOW;
            },
          });
        } catch (error) {
          if (error === LOST_CAPTURE_WINDOW) {
            await trackCaptureOutcome(
              owner,
              orgId,
              "skipped",
              candidates.length,
              savedCount,
            );
            return;
          }
          throw error;
        }
        savedCount += 1;
      }

      await deleteJob(job);
      await trackCaptureOutcome(
        owner,
        orgId,
        "saved",
        candidates.length,
        savedCount,
      );
    });
  } catch (error) {
    const outcome = await retryJob(job);
    await trackCaptureOutcome(owner, orgId, outcome, 0, 0);
    console.warn("[analytics-memory-capture] thread processing failed", {
      attempt: Number(job.attempt_count),
      errorName: error instanceof Error ? error.name : "UnknownError",
      status: outcome,
    });
  }
}

export async function runAnalyticsMemoryCaptureSweep(): Promise<void> {
  const workerToken = randomUUID();
  if (!(await acquireWorkerLease(workerToken, Date.now()))) return;

  try {
    const job = await claimDueJob(Date.now());
    if (job) await processJob(job);
  } finally {
    await releaseWorkerLease(workerToken);
  }
}

registerRecurringSweepHandler(
  "analytics-memory-capture",
  runAnalyticsMemoryCaptureSweep,
);
