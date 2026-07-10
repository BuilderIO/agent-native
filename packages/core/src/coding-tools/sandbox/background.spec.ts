import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite behind getDbExec (same setup as executions-store.spec)
// so the enqueue → claim → execute → finalize lifecycle runs against genuine
// atomic-claim semantics. Self-dispatch is mocked so the serverless drive path
// is observable without a network.
let sqlite: Database.Database;
let serverless = false;

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
  isServerlessRuntime: () => serverless,
  isLocalDatabase: () => true,
}));

const fireInternalDispatch = vi.fn(async () => {});
vi.mock("../../server/self-dispatch.js", () => ({
  fireInternalDispatch: (...args: unknown[]) =>
    fireInternalDispatch(...(args as [])),
}));

const {
  BackgroundQueueAdapter,
  driveSandboxExecution,
  drainDueSandboxExecutions,
  enqueueSandboxExecution,
  isQueuedSandboxAdapter,
  processQueuedSandboxExecution,
  registerSandboxExecutionRunner,
  resetSandboxBackgroundForTests,
  SANDBOX_PROCESS_EXECUTION_PATH,
} = await import("./background.js");
const {
  claimSandboxExecution,
  createSandboxExecution,
  getSandboxExecutionInternal,
  resetSandboxExecutionsStoreForTests,
} = await import("./executions-store.js");
const {
  getSandboxAdapter,
  resolveExecutionSandboxAdapter,
  resetSandboxAdapterForTests,
} = await import("./index.js");

const OWNER = "alice@example.com";

function makeExecution(overrides: Record<string, unknown> = {}) {
  return createSandboxExecution({
    owner: OWNER,
    orgId: "org-1",
    threadId: "thread-1",
    code: "console.log('hi')",
    timeoutMs: 600_000,
    maxOutputChars: 50_000,
    ...overrides,
  });
}

function okRunner(
  output: Partial<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    bridgeToolsUsed: string[];
  }> = {},
) {
  const execute = vi.fn(async () => ({
    stdout: "done",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    bridgeToolsUsed: [],
    ...output,
  }));
  registerSandboxExecutionRunner({ execute }, { replace: true });
  return execute;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  serverless = false;
  resetSandboxExecutionsStoreForTests();
  resetSandboxBackgroundForTests();
  fireInternalDispatch.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSandboxAdapterForTests();
});

describe("queued adapter selection", () => {
  it("selects the background queue adapter via AGENT_NATIVE_SANDBOX", () => {
    vi.stubEnv("AGENT_NATIVE_SANDBOX", "background");
    resetSandboxAdapterForTests();
    const adapter = getSandboxAdapter();
    expect(adapter).toBeInstanceOf(BackgroundQueueAdapter);
    expect(isQueuedSandboxAdapter(adapter)).toBe(true);
    // Actual module execution must never route into the queue.
    const execAdapter = resolveExecutionSandboxAdapter();
    expect(isQueuedSandboxAdapter(execAdapter)).toBe(false);
    expect(execAdapter.id).toBe("local-child-process");
  });

  it("keeps the local adapter as the default", () => {
    resetSandboxAdapterForTests();
    const adapter = getSandboxAdapter();
    expect(isQueuedSandboxAdapter(adapter)).toBe(false);
    expect(adapter.id).toBe("local-child-process");
  });

  it("refuses direct module execution with a descriptive error", async () => {
    await expect(new BackgroundQueueAdapter().run()).rejects.toThrow(
      /does not execute prepared modules directly/,
    );
  });
});

describe("driveSandboxExecution", () => {
  it("self-dispatches to the processor route on serverless runtimes", async () => {
    serverless = true;
    await driveSandboxExecution("sbx_test", {});
    expect(fireInternalDispatch).toHaveBeenCalledTimes(1);
    const call = fireInternalDispatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(call.path).toBe(SANDBOX_PROCESS_EXECUTION_PATH);
    expect(call.taskId).toBe("sbx_test");
    expect(call.body).toEqual({ executionId: "sbx_test" });
  });

  it("executes in-process on long-lived runtimes", async () => {
    const execute = okRunner();
    const row = await makeExecution();
    await driveSandboxExecution(row.id);
    await vi.waitFor(async () => {
      const updated = await getSandboxExecutionInternal(row.id);
      expect(updated!.status).toBe("succeeded");
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fireInternalDispatch).not.toHaveBeenCalled();
  });
});

describe("processQueuedSandboxExecution", () => {
  it("claims, executes with the owner context, and finalizes as succeeded", async () => {
    const execute = okRunner({
      stdout: "42",
      bridgeToolsUsed: ["provider-api-request"],
    });
    const row = await makeExecution();

    const result = await processQueuedSandboxExecution(row.id);
    expect(result).toEqual({ status: "completed", finalStatus: "succeeded" });

    const input = execute.mock.calls[0][0] as {
      code: string;
      timeoutMs: number;
      context?: { userEmail?: string; orgId?: string | null; caller?: string };
    };
    expect(input.code).toBe("console.log('hi')");
    expect(input.timeoutMs).toBe(600_000);
    expect(input.context?.userEmail).toBe(OWNER);
    expect(input.context?.orgId).toBe("org-1");
    expect(input.context?.caller).toBe("tool");

    const done = await getSandboxExecutionInternal(row.id);
    expect(done!.status).toBe("succeeded");
    expect(done!.stdout).toBe("42");
    expect(done!.bridgeToolsUsed).toEqual(["provider-api-request"]);
    expect(done!.finishedAt).not.toBeNull();
  });

  it("maps a timed-out run to timed_out with a structured error", async () => {
    okRunner({ timedOut: true, exitCode: null, stderr: "killed" });
    const row = await makeExecution();
    const result = await processQueuedSandboxExecution(row.id);
    expect(result.finalStatus).toBe("timed_out");
    const done = await getSandboxExecutionInternal(row.id);
    expect(done!.status).toBe("timed_out");
    expect(done!.timedOut).toBe(true);
    expect(done!.error).toMatch(/background timeout/);
  });

  it("maps a non-zero exit to failed and a runner throw to failed with error detail", async () => {
    okRunner({ exitCode: 3, stderr: "boom" });
    const failing = await makeExecution();
    expect((await processQueuedSandboxExecution(failing.id)).finalStatus).toBe(
      "failed",
    );

    registerSandboxExecutionRunner(
      {
        execute: async () => {
          throw new Error("bridge exploded");
        },
      },
      { replace: true },
    );
    const throwing = await makeExecution();
    expect((await processQueuedSandboxExecution(throwing.id)).finalStatus).toBe(
      "failed",
    );
    const done = await getSandboxExecutionInternal(throwing.id);
    expect(done!.error).toMatch(/Sandbox executor error: bridge exploded/);
  });

  it("returns not_due for terminal or actively running rows", async () => {
    okRunner();
    const row = await makeExecution();
    await processQueuedSandboxExecution(row.id);
    expect(await processQueuedSandboxExecution(row.id)).toEqual({
      status: "not_due",
      finalStatus: "succeeded",
    });

    const running = await makeExecution();
    await claimSandboxExecution(running.id, "live-token", 600_000);
    expect((await processQueuedSandboxExecution(running.id)).status).toBe(
      "not_due",
    );
  });

  it("leaves the row queued when no runner is registered", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = await makeExecution();
    expect(await processQueuedSandboxExecution(row.id)).toEqual({
      status: "runner_unavailable",
    });
    const still = await getSandboxExecutionInternal(row.id);
    expect(still!.status).toBe("queued");
    expect(still!.attemptCount).toBe(0);
    errorSpy.mockRestore();
  });

  it("reclaims a lease-expired row and reaps it once attempts are exhausted", async () => {
    okRunner({ stdout: "second try" });
    const row = await makeExecution();
    // First executor claimed and died (expired lease).
    await claimSandboxExecution(row.id, "dead-token", 1, Date.now() - 10_000);

    const retry = await processQueuedSandboxExecution(row.id);
    expect(retry.finalStatus).toBe("succeeded");
    const done = await getSandboxExecutionInternal(row.id);
    expect(done!.attemptCount).toBe(2);
    expect(done!.stdout).toBe("second try");

    // Exhausted case: expired lease with no attempts left is reaped to failed.
    const exhausted = await makeExecution();
    await claimSandboxExecution(exhausted.id, "t1", 1, Date.now() - 20_000);
    await claimSandboxExecution(exhausted.id, "t2", 1, Date.now() - 10_000);
    const reaped = await processQueuedSandboxExecution(exhausted.id);
    expect(reaped).toEqual({ status: "completed", finalStatus: "failed" });
    const failedRow = await getSandboxExecutionInternal(exhausted.id);
    expect(failedRow!.status).toBe("failed");
    expect(failedRow!.error).toMatch(/lease expired/i);
  });

  it("returns not_found for unknown ids", async () => {
    expect(await processQueuedSandboxExecution("sbx_missing")).toEqual({
      status: "not_found",
    });
  });
});

describe("enqueueSandboxExecution", () => {
  it("creates a queued row and drives it immediately in-process", async () => {
    const execute = okRunner();
    const { execution, driveNote } = await enqueueSandboxExecution({
      code: "console.log('bg')",
      timeoutMs: 600_000,
      maxOutputChars: 50_000,
      owner: OWNER,
      orgId: "org-1",
      threadId: "thread-1",
    });
    expect(execution.status).toBe("queued");
    expect(driveNote).toBeUndefined();
    await vi.waitFor(async () => {
      const updated = await getSandboxExecutionInternal(execution.id);
      expect(updated!.status).toBe("succeeded");
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("dispatches instead of executing in-process on serverless", async () => {
    serverless = true;
    okRunner();
    const { execution } = await enqueueSandboxExecution({
      code: "console.log('bg')",
      timeoutMs: 600_000,
      maxOutputChars: 50_000,
      owner: OWNER,
    });
    expect(fireInternalDispatch).toHaveBeenCalledTimes(1);
    const call = fireInternalDispatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(call.taskId).toBe(execution.id);
    const still = await getSandboxExecutionInternal(execution.id);
    expect(still!.status).toBe("queued");
  });

  it("keeps the row queued with a note when the initial dispatch fails", async () => {
    serverless = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fireInternalDispatch.mockRejectedValueOnce(new Error("no APP_URL"));
    const { execution, driveNote } = await enqueueSandboxExecution({
      code: "console.log('bg')",
      timeoutMs: 600_000,
      maxOutputChars: 50_000,
      owner: OWNER,
    });
    expect(driveNote).toMatch(/stays queued/);
    const still = await getSandboxExecutionInternal(execution.id);
    expect(still!.status).toBe("queued");
    errorSpy.mockRestore();
  });
});

describe("drainDueSandboxExecutions", () => {
  it("is a zero-footprint no-op when the table does not exist", async () => {
    expect(await drainDueSandboxExecutions()).toBe(0);
    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain("sandbox_executions");
  });

  it("re-drives stale queued rows and reaps exhausted expired rows", async () => {
    okRunner({ stdout: "swept" });
    const stale = await makeExecution();
    sqlite
      .prepare(`UPDATE sandbox_executions SET updated_at = ? WHERE id = ?`)
      .run(Date.now() - 120_000, stale.id);

    const exhausted = await makeExecution();
    await claimSandboxExecution(exhausted.id, "t1", 1, Date.now() - 20_000);
    await claimSandboxExecution(exhausted.id, "t2", 1, Date.now() - 10_000);

    const driven = await drainDueSandboxExecutions({ limit: 10 });
    expect(driven).toBe(2);

    await vi.waitFor(async () => {
      const sweptRow = await getSandboxExecutionInternal(stale.id);
      expect(sweptRow!.status).toBe("succeeded");
    });
    const reaped = await getSandboxExecutionInternal(exhausted.id);
    expect(reaped!.status).toBe("failed");
    expect(reaped!.error).toMatch(/lease expired/i);
  });
});
