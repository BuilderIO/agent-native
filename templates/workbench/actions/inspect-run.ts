/**
 * Full detail for a single local agent-native run. Returns the underlying
 * `agent_runs` row, all persisted events, and best-effort derived metadata
 * (touched files, tool-call counts, current blocker) computed from event
 * payloads.
 *
 * Ownership: the run is reachable only through its parent thread, scoped
 * by `chat_threads.owner_email`. We refuse to return events if the user
 * doesn't own the thread.
 */
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import type { RunStatus } from "./list-runs.js";

export interface InspectRunEvent {
  seq: number;
  /** Parsed event payload — see `AgentChatEvent` for the shape. */
  event: Record<string, unknown>;
}

export interface InspectRunDetail {
  runId: string;
  threadId: string;
  title: string;
  status: RunStatus;
  displayStatus: "running" | "paused" | "completed" | "failed" | "stopped";
  startedAt: number;
  completedAt: number | null;
  heartbeatAt: number | null;
  lastProgressAt: number | null;
  source: "agent-native";
  /** Parsed events in order. */
  events: InspectRunEvent[];
  /** Aggregate counts derived from events. */
  toolCallCount: number;
  errorCount: number;
  /** Distinct file paths referenced in tool calls (best-effort heuristic). */
  touchedFiles: string[];
  /** When the run looks stalled / waiting for the user. */
  currentBlocker: string | null;
  /** Run appears to be running but not progressing. */
  appearsStuck: boolean;
  /** Whether the agent run is in a state that can resume. */
  canResume: boolean;
  /** Whether the agent run is in a state that can be stopped. */
  canStop: boolean;
}

const PAUSED_PROGRESS_THRESHOLD_MS = 20_000;

function mapDisplayStatus(
  status: RunStatus,
  lastProgressAt: number | null,
): InspectRunDetail["displayStatus"] {
  if (status === "running") {
    if (
      lastProgressAt &&
      Date.now() - lastProgressAt > PAUSED_PROGRESS_THRESHOLD_MS
    ) {
      return "paused";
    }
    return "running";
  }
  if (status === "completed") return "completed";
  if (status === "errored") return "failed";
  return "stopped";
}

/**
 * Tool input keys we treat as file references for the touched-files panel.
 * We deliberately stay broad — a tool param called `path`, `file`,
 * `filePath`, `target`, or `id` (when the value looks path-like) all count.
 */
const FILE_LIKE_KEYS = new Set([
  "path",
  "file",
  "filePath",
  "file_path",
  "target",
  "targetPath",
  "filename",
  "files",
]);

function looksLikeFilePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 2 || value.length > 400) return false;
  // Plain file path heuristic: has a `/` or starts with a dot or has a
  // common file extension. Avoids matching URLs or random IDs.
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  return /[\/.]/.test(value) && /[A-Za-z]/.test(value);
}

function collectFiles(input: unknown, out: Set<string>): void {
  if (!input) return;
  if (typeof input === "string") {
    if (looksLikeFilePath(input)) out.add(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectFiles(item, out);
    return;
  }
  if (typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (FILE_LIKE_KEYS.has(k)) collectFiles(v, out);
    }
  }
}

export default defineAction({
  description:
    "Get full detail for a single agent-native run — status, events, touched files, current blocker.",
  schema: z.object({
    runId: z.string().min(1).describe("Run id"),
  }),
  http: { method: "GET" },
  run: async ({ runId }): Promise<InspectRunDetail | null> => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) return null;

    const client = getDbExec();

    // Single-roundtrip ownership-scoped lookup of the run + its thread.
    const { rows: runRows } = await client.execute({
      sql: `
        SELECT
          r.id,
          r.thread_id,
          r.status,
          r.started_at,
          r.completed_at,
          r.heartbeat_at,
          r.last_progress_at,
          t.title AS thread_title
        FROM agent_runs r
        INNER JOIN chat_threads t ON t.id = r.thread_id
        WHERE r.id = ? AND t.owner_email = ?
      `,
      args: [runId, userEmail],
    });

    if (runRows.length === 0) return null;

    const r = runRows[0] as {
      id: string;
      thread_id: string;
      status: string;
      started_at: number | string;
      completed_at: number | string | null;
      heartbeat_at: number | string | null;
      last_progress_at: number | string | null;
      thread_title: string | null;
    };

    const { rows: eventRows } = await client.execute({
      sql: `
        SELECT seq, event_data
        FROM agent_run_events
        WHERE run_id = ?
        ORDER BY seq ASC
      `,
      args: [runId],
    });

    const events: InspectRunEvent[] = [];
    const touched = new Set<string>();
    let toolCallCount = 0;
    let errorCount = 0;
    let lastQuestion: string | null = null;
    let lastAssistantText: string | null = null;
    let lastErrorText: string | null = null;

    for (const row of eventRows) {
      const er = row as { seq: number | string; event_data: string };
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(er.event_data);
      } catch {
        continue;
      }
      if (!parsed) continue;
      events.push({ seq: Number(er.seq), event: parsed });

      const type = parsed.type as string | undefined;
      if (type === "tool_start") {
        toolCallCount += 1;
        collectFiles(parsed.input, touched);
      } else if (type === "error") {
        errorCount += 1;
        if (typeof parsed.error === "string") lastErrorText = parsed.error;
      } else if (type === "text" && typeof parsed.text === "string") {
        lastAssistantText = parsed.text;
        const trimmed = parsed.text.trim();
        if (trimmed.endsWith("?")) {
          // The last short question-shaped message tends to be the blocker.
          const lines = trimmed.split(/\n+/);
          const lastLine = lines[lines.length - 1]?.trim() ?? "";
          if (lastLine.endsWith("?") && lastLine.length < 280) {
            lastQuestion = lastLine;
          }
        }
      }
    }

    const status = r.status as RunStatus;
    const lastProgressAt =
      r.last_progress_at == null ? null : Number(r.last_progress_at);
    const displayStatus = mapDisplayStatus(status, lastProgressAt);
    const appearsStuck =
      status === "running" &&
      lastProgressAt !== null &&
      Date.now() - lastProgressAt > PAUSED_PROGRESS_THRESHOLD_MS;

    let currentBlocker: string | null = null;
    if (displayStatus === "paused") {
      currentBlocker =
        lastQuestion ?? lastAssistantText ?? "Awaiting your input.";
    } else if (displayStatus === "failed") {
      currentBlocker = lastErrorText ?? "Run ended with an error.";
    } else if (appearsStuck) {
      currentBlocker = "Run hasn't made progress recently.";
    }

    return {
      runId: r.id,
      threadId: r.thread_id,
      title: r.thread_title?.trim() || "Untitled run",
      status,
      displayStatus,
      startedAt: Number(r.started_at),
      completedAt: r.completed_at == null ? null : Number(r.completed_at),
      heartbeatAt: r.heartbeat_at == null ? null : Number(r.heartbeat_at),
      lastProgressAt,
      source: "agent-native",
      events,
      toolCallCount,
      errorCount,
      touchedFiles: Array.from(touched).slice(0, 50),
      currentBlocker,
      appearsStuck,
      canResume: status !== "running",
      canStop: status === "running",
    };
  },
});
