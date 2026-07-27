import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite behind the raw getDbExec client so the claim/lease/
// finalize guards are exercised with genuine UPDATE ... WHERE semantics
// (rowsAffected) instead of mocks. A fresh DB per test plus the store's
// test-only init reset keeps CREATE TABLE idempotent across cases.
let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => unknown) => fn(),
  isServerlessRuntime: () => false,
}));

const {
  SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS,
  SANDBOX_EXECUTION_MAX_STORED_OUTPUT_CHARS,
  claimSandboxExecution,
  createSandboxExecution,
  failExpiredSandboxExecution,
  finalizeSandboxExecution,
  getSandboxExecutionForOwner,
  getSandboxExecutionInternal,
  listDueSandboxExecutions,
  renewSandboxExecutionLease,
  resetSandboxExecutionsStoreForTests,
} = await import("./executions-store.js");

const OWNER = "alice@example.com";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    owner: OWNER,
    orgId: "org-1",
    threadId: "thread-1",
    code: "console.log(1)",
    timeoutMs: 600_000,
    maxOutputChars: 50_000,
    ...overrides,
  };
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  resetSandboxExecutionsStoreForTests();
});

describe("sandbox executions store", () => {
  it("creates a queued row with defaults and scoping columns", async () => {
    const row = await createSandboxExecution(baseInput());
    expect(row.id).toMatch(/^sbx_/);
    expect(row.status).toBe("queued");
    expect(row.owner).toBe(OWNER);
    expect(row.orgId).toBe("org-1");
    expect(row.threadId).toBe("thread-1");
    expect(row.attemptCount).toBe(0);
    expect(row.maxAttempts).toBe(SANDBOX_EXECUTION_DEFAULT_MAX_ATTEMPTS);
    expect(row.timeoutMs).toBe(600_000);
    expect(row.claimToken).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
  });

  it("scopes owner reads: another owner cannot see the row", async () => {
    const row = await createSandboxExecution(baseInput());
    expect(await getSandboxExecutionForOwner(row.id, OWNER)).not.toBeNull();
    expect(
      await getSandboxExecutionForOwner(row.id, "mallory@example.com"),
    ).toBeNull();
    // Internal (executor) read stays unscoped.
    expect(await getSandboxExecutionInternal(row.id)).not.toBeNull();
  });

  it("claims a queued row exactly once", async () => {
    const row = await createSandboxExecution(baseInput());
    const now = Date.now();

    const first = await claimSandboxExecution(row.id, "token-a", 90_000, now);
    expect(first).not.toBeNull();
    expect(first!.status).toBe("running");
    expect(first!.attemptCount).toBe(1);
    expect(first!.claimToken).toBe("token-a");
    expect(first!.leaseExpiresAt).toBe(now + 90_000);

    // A racing second claim loses while the lease is fresh.
    const second = await claimSandboxExecution(row.id, "token-b", 90_000, now);
    expect(second).toBeNull();
  });

  it("reclaims a running row only after the lease expires, within the attempt budget", async () => {
    const row = await createSandboxExecution(baseInput());
    const t0 = Date.now();
    await claimSandboxExecution(row.id, "token-a", 90_000, t0);

    // Before expiry: no reclaim.
    expect(
      await claimSandboxExecution(row.id, "token-b", 90_000, t0 + 60_000),
    ).toBeNull();

    // After expiry: reclaim succeeds and bumps the attempt count.
    const reclaimed = await claimSandboxExecution(
      row.id,
      "token-b",
      90_000,
      t0 + 90_001,
    );
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.attemptCount).toBe(2);
    expect(reclaimed!.claimToken).toBe("token-b");

    // Attempts exhausted (default max 2): a third expiry cannot be claimed.
    expect(
      await claimSandboxExecution(row.id, "token-c", 90_000, t0 + 300_000),
    ).toBeNull();
  });

  it("renews the lease only for the live claim token", async () => {
    const row = await createSandboxExecution(baseInput());
    const t0 = Date.now();
    await claimSandboxExecution(row.id, "token-a", 90_000, t0);

    expect(
      await renewSandboxExecutionLease(row.id, "token-a", 90_000, t0 + 30_000),
    ).toBe(true);
    const renewed = await getSandboxExecutionInternal(row.id);
    expect(renewed!.leaseExpiresAt).toBe(t0 + 30_000 + 90_000);

    expect(
      await renewSandboxExecutionLease(row.id, "stale-token", 90_000),
    ).toBe(false);
  });

  it("finalizes only with the matching claim token (single-writer)", async () => {
    const row = await createSandboxExecution(baseInput());
    const t0 = Date.now();
    await claimSandboxExecution(row.id, "token-a", 90_000, t0);
    // Simulate a lease expiry + reclaim by a second executor.
    await claimSandboxExecution(row.id, "token-b", 90_000, t0 + 90_001);

    // The displaced executor's finalize is discarded.
    expect(
      await finalizeSandboxExecution(row.id, "token-a", {
        status: "succeeded",
        stdout: "stale result",
        exitCode: 0,
      }),
    ).toBe(false);

    // The live claimer's finalize lands.
    expect(
      await finalizeSandboxExecution(row.id, "token-b", {
        status: "succeeded",
        stdout: "fresh result",
        stderr: "",
        exitCode: 0,
        bridgeToolsUsed: ["web-request"],
      }),
    ).toBe(true);

    const done = await getSandboxExecutionForOwner(row.id, OWNER);
    expect(done!.status).toBe("succeeded");
    expect(done!.stdout).toBe("fresh result");
    expect(done!.exitCode).toBe(0);
    expect(done!.bridgeToolsUsed).toEqual(["web-request"]);
    expect(done!.finishedAt).not.toBeNull();
    expect(done!.leaseExpiresAt).toBeNull();

    // Terminal rows cannot be finalized again.
    expect(
      await finalizeSandboxExecution(row.id, "token-b", {
        status: "failed",
        error: "late",
      }),
    ).toBe(false);
  });

  it("caps stored stdout/stderr at maxOutputChars with truncation flags", async () => {
    const row = await createSandboxExecution(
      baseInput({ maxOutputChars: 100 }),
    );
    await claimSandboxExecution(row.id, "token-a", 90_000);
    await finalizeSandboxExecution(row.id, "token-a", {
      status: "succeeded",
      stdout: "x".repeat(500),
      stderr: "y".repeat(50),
      exitCode: 0,
    });
    const done = await getSandboxExecutionInternal(row.id);
    expect(done!.stdout).toHaveLength(100);
    expect(done!.stdoutTruncated).toBe(true);
    expect(done!.stderr).toBe("y".repeat(50));
    expect(done!.stderrTruncated).toBe(false);
    // Row cap can never exceed the hard storage ceiling.
    expect(done!.stdout.length).toBeLessThanOrEqual(
      SANDBOX_EXECUTION_MAX_STORED_OUTPUT_CHARS,
    );
  });

  it("reaps an expired row to failed only after the attempt budget is exhausted", async () => {
    const row = await createSandboxExecution(baseInput());
    const t0 = Date.now();
    await claimSandboxExecution(row.id, "token-a", 90_000, t0);

    // Attempt budget not exhausted yet — reap refuses.
    expect(await failExpiredSandboxExecution(row.id, "lost", t0 + 90_001)).toBe(
      false,
    );

    await claimSandboxExecution(row.id, "token-b", 90_000, t0 + 90_002);
    // Live lease — reap refuses.
    expect(await failExpiredSandboxExecution(row.id, "lost", t0 + 90_003)).toBe(
      false,
    );
    // Expired + exhausted — reap lands.
    expect(
      await failExpiredSandboxExecution(row.id, "executor lost", t0 + 200_000),
    ).toBe(true);
    const done = await getSandboxExecutionInternal(row.id);
    expect(done!.status).toBe("failed");
    expect(done!.error).toBe("executor lost");
  });

  it("lists due rows: stale queued and lease-expired running, not fresh or terminal", async () => {
    const now = Date.now();
    const staleQueued = await createSandboxExecution(baseInput());
    const freshQueued = await createSandboxExecution(baseInput());
    const expiredRunning = await createSandboxExecution(baseInput());
    const liveRunning = await createSandboxExecution(baseInput());
    const finished = await createSandboxExecution(baseInput());

    // Backdate the stale queued row.
    sqlite
      .prepare(`UPDATE sandbox_executions SET updated_at = ? WHERE id = ?`)
      .run(now - 120_000, staleQueued.id);
    await claimSandboxExecution(expiredRunning.id, "t1", 1_000, now - 60_000);
    await claimSandboxExecution(liveRunning.id, "t2", 600_000, now);
    await claimSandboxExecution(finished.id, "t3", 600_000, now);
    await finalizeSandboxExecution(finished.id, "t3", {
      status: "succeeded",
      exitCode: 0,
    });

    const due = await listDueSandboxExecutions({
      limit: 10,
      queuedOlderThanMs: 30_000,
      now,
    });
    const ids = due.map((d) => d.id).sort();
    expect(ids).toEqual([staleQueued.id, expiredRunning.id].sort());
    expect(ids).not.toContain(freshQueued.id);
    expect(ids).not.toContain(liveRunning.id);
    expect(ids).not.toContain(finished.id);
  });
});
