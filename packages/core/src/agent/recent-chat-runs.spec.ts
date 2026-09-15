import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

/**
 * The Agent runs tray read only `progress_runs` and the background task
 * listings, so an ordinary chat turn - the work a user is literally watching
 * stream tool calls next to the tray - showed "No tracked work yet". The turn
 * was always persisted to `agent_runs`; nothing owner-scoped ever read it back.
 *
 * These run against a real PGlite engine because the fix hinges on the join
 * between `agent_runs` (no owner column) and `chat_threads` (owner/org/share
 * rules), which a stubbed client would not prove.
 */

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql) || /\breturning\b/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const { insertRun, updateRunStatus } = await import("./run-store.js");
const { listRecentChatRuns } = await import("./recent-chat-runs.js");

const OWNER = "owner@example.com";
const OTHER = "someone-else@example.com";

async function createThread(
  id: string,
  title: string,
  ownerEmail = OWNER,
  extra: { visibility?: string; orgId?: string | null } = {},
): Promise<void> {
  await pglite.query(
    `INSERT INTO chat_threads (id, title, preview, owner_email, visibility, org_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      "",
      ownerEmail,
      extra.visibility ?? "private",
      extra.orgId ?? null,
    ],
  );
}

beforeEach(async () => {
  await pglite.exec(`DROP TABLE IF EXISTS chat_threads`);
  await pglite.exec(`DROP TABLE IF EXISTS chat_thread_shares`);
  await pglite.exec(`DELETE FROM agent_runs`).catch(() => {});
  await pglite.exec(`
    CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )
  `);
  await pglite.exec(`
    CREATE TABLE chat_thread_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer'
    )
  `);
});

describe("listRecentChatRuns", () => {
  it("surfaces a foreground chat turn the moment its run row exists", async () => {
    await createThread("thread-1", "Build the triage app");
    await insertRun("run-1", "thread-1", "turn-1", {
      dispatchMode: "foreground",
    });

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "run-1",
      kind: "chat",
      status: "running",
      title: "Build the triage app",
      goalId: "agent-chat",
      sourceRecord: { threadId: "thread-1" },
    });
    expect(runs[0].metadata.threadId).toBe("thread-1");
  });

  it("reports the terminal outcome once the turn finishes", async () => {
    await createThread("thread-1", "Build the triage app");
    await insertRun("run-1", "thread-1", "turn-1");
    await updateRunStatus("run-1", "completed");

    const [completed] = await listRecentChatRuns({ ownerEmail: OWNER });
    expect(completed.status).toBe("completed");

    await createThread("thread-2", "Stopped turn");
    await insertRun("run-2", "thread-2", "turn-2");
    await updateRunStatus("run-2", "aborted");
    const aborted = (await listRecentChatRuns({ ownerEmail: OWNER })).find(
      (run) => run.id === "run-2",
    );
    expect(aborted?.status).toBe("cancelled");

    await createThread("thread-3", "Truncated turn");
    await insertRun("run-3", "thread-3", "turn-3");
    await updateRunStatus("run-3", "truncated");
    const truncated = (await listRecentChatRuns({ ownerEmail: OWNER })).find(
      (run) => run.id === "run-3",
    );
    // A cut-off turn is not a clean completion.
    expect(truncated?.status).toBe("errored");
  });

  it("collapses continuation chunks of one turn into a single row", async () => {
    await createThread("thread-1", "Long turn");
    await insertRun("chunk-1", "thread-1", "turn-1");
    await updateRunStatus("chunk-1", "truncated");
    await insertRun("chunk-2", "thread-1", "turn-1");

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("chunk-2");
    expect(runs[0].status).toBe("running");
  });

  it("never leaks another user's chat runs", async () => {
    await createThread("thread-mine", "Mine");
    await createThread("thread-theirs", "Theirs", OTHER);
    await insertRun("run-mine", "thread-mine", "turn-mine");
    await insertRun("run-theirs", "thread-theirs", "turn-theirs");

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });

    expect(runs.map((run) => run.id)).toEqual(["run-mine"]);
  });

  it("includes a thread shared with the caller", async () => {
    await createThread("thread-shared", "Shared", OTHER);
    await pglite.query(
      `INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role)
       VALUES (?, ?, ?, ?, ?)`,
      ["share-1", "thread-shared", "user", OWNER, "viewer"],
    );
    await insertRun("run-shared", "thread-shared", "turn-shared");

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });

    expect(runs.map((run) => run.id)).toEqual(["run-shared"]);
  });

  it("yields threads already represented by another run surface", async () => {
    await createThread("thread-team", "Agent team work");
    await insertRun("run-team", "thread-team", "turn-team");

    const runs = await listRecentChatRuns({
      ownerEmail: OWNER,
      excludeThreadIds: ["thread-team"],
    });

    expect(runs).toEqual([]);
  });

  it("keeps an active turn visible under a burst of newer finished turns", async () => {
    // The scan is bounded, and finished turns are newer than the run that is
    // still going. Ordering by recency alone drops the active one, which reads
    // as an idle tray and stops the polling that would have corrected it.
    await createThread("thread-live", "Still going");
    await insertRun("run-live", "thread-live", "turn-live");
    await pglite.query(`UPDATE agent_runs SET started_at = ? WHERE id = ?`, [
      Date.now() - 60 * 60 * 1000,
      "run-live",
    ]);

    for (let i = 0; i < 40; i++) {
      await createThread(`thread-done-${i}`, `Finished ${i}`);
      await insertRun(`run-done-${i}`, `thread-done-${i}`, `turn-done-${i}`);
      await updateRunStatus(`run-done-${i}`, "completed");
    }

    const runs = await listRecentChatRuns({ ownerEmail: OWNER, limit: 5 });

    expect(runs).toHaveLength(5);
    expect(runs.map((run) => run.id)).toContain("run-live");
  });

  it("keeps a long turn visible at the moment it completes", async () => {
    // Retention prunes on completion time, so this row is still stored. A
    // window measured from `started_at` would drop it the instant it finishes
    // — precisely when the user looks for it.
    await createThread("thread-long", "Long haul");
    await insertRun("run-long", "thread-long", "turn-long");
    await pglite.query(`UPDATE agent_runs SET started_at = ? WHERE id = ?`, [
      Date.now() - 30 * 60 * 60 * 1000,
      "run-long",
    ]);
    await updateRunStatus("run-long", "completed");

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });

    expect(runs.map((run) => run.id)).toEqual(["run-long"]);
    expect(runs[0].status).toBe("completed");
  });

  it("marks a shared thread's run unstoppable for the sharee", async () => {
    // /runs/:id/abort requires editor and answers a viewer with 404, so Stop
    // would only produce an optimistic cancel that snaps back.
    await createThread("thread-mine", "Mine");
    await insertRun("run-mine", "thread-mine", "turn-mine");
    await createThread("thread-shared", "Shared with me", OTHER);
    await pglite.query(
      `INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role)
       VALUES (?, ?, ?, ?, ?)`,
      ["share-stop", "thread-shared", "user", OWNER, "viewer"],
    );
    await insertRun("run-shared", "thread-shared", "turn-shared");

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });
    const byId = new Map(runs.map((run) => [run.id, run]));

    expect(byId.get("run-mine")?.metadata.canStop).toBe(true);
    expect(byId.get("run-shared")?.metadata.canStop).toBe(false);
  });

  it("keeps a still-running turn visible past the recent window", async () => {
    await createThread("thread-old", "Old but alive");
    await insertRun("run-old", "thread-old", "turn-old");
    await pglite.query(`UPDATE agent_runs SET started_at = ? WHERE id = ?`, [
      Date.now() - 5 * 24 * 60 * 60 * 1000,
      "run-old",
    ]);

    const runs = await listRecentChatRuns({ ownerEmail: OWNER });

    expect(runs.map((run) => run.id)).toEqual(["run-old"]);
  });
});
