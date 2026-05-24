/**
 * List local agent-native runs the current user owns.
 *
 * Joins `agent_runs` -> `chat_threads` on `thread_id` to scope by
 * `owner_email`. The framework's `run-manager` tables don't carry user/org
 * columns themselves — ownership flows through the thread that started the
 * run. v1.1+ will add adapters for Claude Code / Codex / Cursor sessions.
 */
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export type RunStatus = "running" | "completed" | "errored" | "aborted";

export type RunListFilter = "active" | "needs-input" | "recent" | "all";
export type RunListSort = "recent" | "started" | "status";

export interface RunCard {
  runId: string;
  threadId: string;
  title: string;
  status: RunStatus;
  /** Display-friendly status pill: running / paused / completed / failed / stopped. */
  displayStatus: "running" | "paused" | "completed" | "failed" | "stopped";
  startedAt: number;
  completedAt: number | null;
  heartbeatAt: number | null;
  lastProgressAt: number | null;
  /** Source kind — only "agent-native" in v1.0. */
  source: "agent-native";
  /** Last message snippet shown on the card. */
  preview: string;
  /** True when status is "running" but progress has stalled. */
  appearsStuck: boolean;
}

/**
 * A "needs input" run is one that is currently running but hasn't emitted
 * progress in the last 20 seconds. The framework doesn't have an explicit
 * "paused" status — agents pause by emitting a question and waiting for the
 * user's next turn, so we infer paused from progress stalling.
 */
const PAUSED_PROGRESS_THRESHOLD_MS = 20_000;

function mapDisplayStatus(
  status: RunStatus,
  lastProgressAt: number | null,
): RunCard["displayStatus"] {
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

export default defineAction({
  description:
    "List local agent-native runs (active, paused, recent) scoped to the current user.",
  schema: z.object({
    filter: z
      .enum(["active", "needs-input", "recent", "all"])
      .default("recent")
      .describe(
        "Which runs to surface. `active` = running + paused, `needs-input` = paused, `recent` = both active and last 24h, `all` = everything.",
      ),
    sort: z
      .enum(["recent", "started", "status"])
      .default("recent")
      .describe("Sort order."),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  http: { method: "GET" },
  run: async ({ filter, sort, limit }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      return { runs: [] as RunCard[] };
    }

    const client = getDbExec();

    // Status filter clause. "needs-input" maps to running rows whose progress
    // is stale; we still pull running rows here and filter in JS so the
    // display status matches the SQL we read.
    let statusClause = "";
    if (filter === "active" || filter === "needs-input") {
      statusClause = "AND r.status = 'running'";
    } else if (filter === "recent") {
      // running OR finished within the last 24h
      statusClause = `AND (
        r.status = 'running'
        OR (r.completed_at IS NOT NULL AND r.completed_at >= ?)
      )`;
    }

    const args: (string | number)[] = [userEmail];
    if (filter === "recent") {
      args.push(Date.now() - 24 * 60 * 60 * 1000);
    }
    args.push(limit);

    const sortClause =
      sort === "started"
        ? "ORDER BY r.started_at DESC"
        : sort === "status"
          ? "ORDER BY CASE r.status WHEN 'running' THEN 0 WHEN 'errored' THEN 1 WHEN 'aborted' THEN 2 ELSE 3 END, r.started_at DESC"
          : "ORDER BY COALESCE(r.completed_at, r.started_at) DESC";

    const { rows } = await client.execute({
      sql: `
        SELECT
          r.id,
          r.thread_id,
          r.status,
          r.started_at,
          r.completed_at,
          r.heartbeat_at,
          r.last_progress_at,
          t.title AS thread_title,
          t.preview AS thread_preview
        FROM agent_runs r
        INNER JOIN chat_threads t ON t.id = r.thread_id
        WHERE t.owner_email = ?
        ${statusClause}
        ${sortClause}
        LIMIT ?
      `,
      args,
    });

    const runs: RunCard[] = rows.map((row) => {
      const r = row as {
        id: string;
        thread_id: string;
        status: string;
        started_at: number | string;
        completed_at: number | string | null;
        heartbeat_at: number | string | null;
        last_progress_at: number | string | null;
        thread_title: string | null;
        thread_preview: string | null;
      };
      const status = r.status as RunStatus;
      const lastProgressAt =
        r.last_progress_at == null ? null : Number(r.last_progress_at);
      const displayStatus = mapDisplayStatus(status, lastProgressAt);
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
        preview: r.thread_preview?.trim() || "",
        appearsStuck:
          status === "running" &&
          lastProgressAt !== null &&
          Date.now() - lastProgressAt > PAUSED_PROGRESS_THRESHOLD_MS,
      };
    });

    const filtered =
      filter === "needs-input"
        ? runs.filter((r) => r.displayStatus === "paused")
        : runs;

    return {
      runs: filtered,
      counts: {
        active: filtered.filter(
          (r) => r.displayStatus === "running" || r.displayStatus === "paused",
        ).length,
        total: filtered.length,
      },
    };
  },
});
