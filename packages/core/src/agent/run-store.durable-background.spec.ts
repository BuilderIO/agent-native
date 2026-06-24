import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Durable-background run-store semantics:
 *  - `insertRun` stamps `dispatch_mode` so the reaper widens the stale window.
 *  - `claimBackgroundRun` is an atomic, idempotent, conditional claim (a second
 *    delivery no-ops — no double-execution).
 *  - the stale reaper is background-aware: a background run that has gone quiet
 *    for >15s (cold start) is NOT reaped, while a foreground run past 15s is.
 *
 * Backed by a small stateful in-memory `agent_runs` table that honors the real
 * conditional WHERE clauses, so we exercise the actual SQL, not a stub.
 */

interface RunRow {
  id: string;
  thread_id: string;
  status: string;
  started_at: number;
  heartbeat_at: number | null;
  last_progress_at: number | null;
  turn_id: string | null;
  dispatch_mode: string | null;
  completed_at: number | null;
  error_code: string | null;
  error_detail: string | null;
}

let rows: RunRow[] = [];

// Mirror the two constants used by `backgroundAwareStaleCutoffSql`. The SQL
// inlines them as literals, so we evaluate the CASE in JS to decide reaping.
const RUN_STALE_MS = 15_000;
const BACKGROUND_RUN_STALE_MS = 90_000;

function rowStaleWindow(row: RunRow): number {
  return row.dispatch_mode && row.dispatch_mode.startsWith("background")
    ? BACKGROUND_RUN_STALE_MS
    : RUN_STALE_MS;
}

/** Effective liveness timestamp = COALESCE(heartbeat_at, started_at). */
function liveness(row: RunRow): number {
  return row.heartbeat_at ?? row.started_at;
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

const mockDb = {
  execute: vi.fn(async (q: string | { sql: string; args?: unknown[] }) => {
    const sql = norm(typeof q === "string" ? q : q.sql);
    const args = (typeof q === "string" ? [] : (q.args ?? [])) as any[];

    if (/^CREATE TABLE|^CREATE INDEX|^ALTER TABLE/i.test(sql)) {
      return { rows: [], rowsAffected: 0 };
    }

    // insertRun
    if (/^INSERT INTO agent_runs/i.test(sql)) {
      const [
        id,
        thread_id,
        started_at,
        heartbeat_at,
        last_progress_at,
        turn_id,
        dispatch_mode,
      ] = args;
      if (rows.some((r) => r.id === id)) {
        // Emulate a PK-collision throw so the .catch(() => {}) path is real.
        throw new Error("UNIQUE constraint failed: agent_runs.id");
      }
      rows.push({
        id,
        thread_id,
        status: "running",
        started_at,
        heartbeat_at,
        last_progress_at,
        turn_id,
        dispatch_mode: dispatch_mode ?? null,
        completed_at: null,
        error_code: null,
        error_detail: null,
      });
      return { rows: [], rowsAffected: 1 };
    }

    // claimBackgroundRun
    if (
      /UPDATE agent_runs SET dispatch_mode = 'background-processing'/i.test(sql)
    ) {
      const [id] = args;
      const row = rows.find(
        (r) =>
          r.id === id &&
          r.status === "running" &&
          r.dispatch_mode === "background",
      );
      if (row) {
        row.dispatch_mode = "background-processing";
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    }

    // reapIfStale (UPDATE ... WHERE id = ? AND status='running' AND <stale>)
    if (
      /UPDATE agent_runs SET status = 'errored'/i.test(sql) &&
      /WHERE id = \?/i.test(sql)
    ) {
      const completedAt = args[0] as number;
      const id = args[3] as string;
      const lastBound = args[4] as number;
      // Default path inlines the background-aware CASE and binds `now`; the
      // explicit-maxStaleMs path inlines a plain `?` and binds a pre-computed
      // cutoff. Distinguish by the SQL fragment, not the arg type.
      const usesBackgroundAwareWindow =
        /CASE WHEN dispatch_mode LIKE 'background%'/i.test(sql);
      const row = rows.find((r) => r.id === id && r.status === "running");
      if (!row) return { rows: [], rowsAffected: 0 };
      const cutoff = usesBackgroundAwareWindow
        ? lastBound - rowStaleWindow(row) // lastBound === now
        : lastBound; // already (now - maxStaleMs)
      if (liveness(row) < cutoff) {
        row.status = "errored";
        row.completed_at = completedAt;
        row.error_code = args[1] as string;
        row.error_detail = args[2] as string;
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    }

    // getRunStatus
    if (/SELECT status FROM agent_runs WHERE id = \?/i.test(sql)) {
      const row = rows.find((r) => r.id === args[0]);
      return {
        rows: row ? [{ status: row.status }] : [],
        rowsAffected: 0,
      };
    }

    // tryClaimRunSlot (default, background-aware) — SELECT a live running row.
    if (
      /SELECT id FROM agent_runs WHERE thread_id = \?/i.test(sql) &&
      />=/.test(sql)
    ) {
      const [threadId, now] = args;
      const flatCutoff = typeof args[2] === "number" ? args[2] : undefined;
      const live = rows
        .filter((r) => r.thread_id === threadId && r.status === "running")
        .filter((r) => {
          const cutoff =
            flatCutoff !== undefined ? flatCutoff : now - rowStaleWindow(r);
          return liveness(r) >= cutoff;
        })
        .sort((a, b) => b.started_at - a.started_at);
      return {
        rows: live.length ? [{ id: live[0].id }] : [],
        rowsAffected: 0,
      };
    }

    // append-terminal-event read / insert paths used by safeAppendTerminalRunEvent
    if (/SELECT seq, event_data FROM agent_run_events/i.test(sql)) {
      return { rows: [], rowsAffected: 0 };
    }
    if (/INSERT INTO agent_run_events/i.test(sql)) {
      return { rows: [], rowsAffected: 1 };
    }

    return { rows: [], rowsAffected: 0 };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../server/capture-error.js", () => ({
  captureError: vi.fn(),
}));

const {
  insertRun,
  claimBackgroundRun,
  reapIfStale,
  tryClaimRunSlot,
  getRunStatus,
  RUN_STALE_MS: STORE_RUN_STALE_MS,
  BACKGROUND_RUN_STALE_MS: STORE_BACKGROUND_RUN_STALE_MS,
} = await import("./run-store.js");

describe("run-store durable background", () => {
  beforeEach(() => {
    rows = [];
    vi.clearAllMocks();
  });

  it("exports the tight foreground + wide background stale windows", () => {
    expect(STORE_RUN_STALE_MS).toBe(15_000);
    expect(STORE_BACKGROUND_RUN_STALE_MS).toBe(90_000);
    expect(STORE_BACKGROUND_RUN_STALE_MS).toBeGreaterThan(STORE_RUN_STALE_MS);
  });

  it("insertRun stamps dispatch_mode='background' for a background dispatch", async () => {
    await insertRun("r-bg", "t1", "turn-1", { dispatchMode: "background" });
    const row = rows.find((r) => r.id === "r-bg");
    expect(row?.dispatch_mode).toBe("background");
    expect(row?.status).toBe("running");
    expect(row?.turn_id).toBe("turn-1");
  });

  it("insertRun leaves dispatch_mode null for the normal foreground path", async () => {
    await insertRun("r-fg", "t1");
    expect(rows.find((r) => r.id === "r-fg")?.dispatch_mode).toBeNull();
  });

  it("claimBackgroundRun: first delivery wins, duplicate delivery no-ops (idempotent)", async () => {
    await insertRun("r-claim", "t1", "turn", { dispatchMode: "background" });

    const first = await claimBackgroundRun("r-claim");
    expect(first).toBe(true);
    expect(rows.find((r) => r.id === "r-claim")?.dispatch_mode).toBe(
      "background-processing",
    );

    // A duplicate Netlify delivery sees 'background-processing' and loses.
    const second = await claimBackgroundRun("r-claim");
    expect(second).toBe(false);
  });

  it("claimBackgroundRun cannot claim a terminal/missing run", async () => {
    expect(await claimBackgroundRun("does-not-exist")).toBe(false);

    await insertRun("r-done", "t1", "turn", { dispatchMode: "background" });
    rows.find((r) => r.id === "r-done")!.status = "completed";
    expect(await claimBackgroundRun("r-done")).toBe(false);
  });

  it("stale reaper does NOT reap an actively-heartbeating background run", async () => {
    const now = Date.now();
    await insertRun("r-live-bg", "t1", "turn", { dispatchMode: "background" });
    const row = rows.find((r) => r.id === "r-live-bg")!;
    // Heartbeat 30s ago: past the 15s foreground window, but well within the
    // 90s background window — must NOT be reaped.
    row.heartbeat_at = now - 30_000;

    const reaped = await reapIfStale("r-live-bg");
    expect(reaped).toBe(false);
    expect(await getRunStatus("r-live-bg")).toBe("running");
  });

  it("stale reaper reaps a background run only after the wide 90s window", async () => {
    const now = Date.now();
    await insertRun("r-dead-bg", "t1", "turn", { dispatchMode: "background" });
    const row = rows.find((r) => r.id === "r-dead-bg")!;
    row.heartbeat_at = now - 120_000; // > 90s — genuinely dead worker.

    const reaped = await reapIfStale("r-dead-bg");
    expect(reaped).toBe(true);
    expect(await getRunStatus("r-dead-bg")).toBe("errored");
  });

  it("stale reaper still reaps a foreground run past the tight 15s window", async () => {
    const now = Date.now();
    await insertRun("r-dead-fg", "t1"); // foreground (no dispatch_mode)
    const row = rows.find((r) => r.id === "r-dead-fg")!;
    row.heartbeat_at = now - 30_000; // > 15s — foreground producer died.

    const reaped = await reapIfStale("r-dead-fg");
    expect(reaped).toBe(true);
    expect(await getRunStatus("r-dead-fg")).toBe("errored");
  });

  it("tryClaimRunSlot treats a quiet (30s) background run as still active", async () => {
    const now = Date.now();
    await insertRun("r-hold-bg", "thread-bg", "turn", {
      dispatchMode: "background",
    });
    rows.find((r) => r.id === "r-hold-bg")!.heartbeat_at = now - 30_000;

    const slot = await tryClaimRunSlot("thread-bg");
    // Background-aware window → the cold-starting run still holds the slot.
    expect(slot.claimed).toBe(false);
    expect(slot.activeRunId).toBe("r-hold-bg");
  });

  it("tryClaimRunSlot frees the slot when a foreground run goes stale (30s)", async () => {
    const now = Date.now();
    await insertRun("r-stale-fg", "thread-fg");
    rows.find((r) => r.id === "r-stale-fg")!.heartbeat_at = now - 30_000;

    const slot = await tryClaimRunSlot("thread-fg");
    expect(slot.claimed).toBe(true);
    expect(slot.activeRunId).toBeNull();
  });
});
