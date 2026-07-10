import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";

// Real in-memory sqlite behind getDbExec so run-code's background param and
// executionId polling exercise the genuine enqueue → claim → execute →
// finalize path (including a REAL sandbox child process for the end-to-end
// case). Self-dispatch is mocked; the runtime is treated as long-lived Node so
// drives run in-process.
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

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => unknown) => fn(),
  isServerlessRuntime: () => serverless,
  isLocalDatabase: () => true,
}));

const fireInternalDispatch = vi.fn(async () => {});
vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: (...args: unknown[]) =>
    fireInternalDispatch(...(args as [])),
}));

const { createRunCodeEntry, createGetCodeExecutionEntry } =
  await import("./run-code.js");
const { getSandboxExecutionInternal, resetSandboxExecutionsStoreForTests } =
  await import("./sandbox/executions-store.js");
const { resetSandboxBackgroundForTests } =
  await import("./sandbox/background.js");
const { resetSandboxAdapterForTests } = await import("./sandbox/index.js");

const OWNER = "alice@example.com";
const ctx: ActionRunContext = {
  caller: "tool",
  userEmail: OWNER,
  orgId: "org-1",
  threadId: "thread-1",
};

const tool = {
  description: "test action",
  parameters: { type: "object", properties: {} },
};

function makeActions(): Record<string, ActionEntry> {
  return {
    "read-things": {
      tool,
      readOnly: true,
      run: async () => ({ ok: true }),
    },
  };
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  serverless = false;
  resetSandboxExecutionsStoreForTests();
  resetSandboxBackgroundForTests();
  resetSandboxAdapterForTests();
  fireInternalDispatch.mockClear();
  // Keep the CLI env fallback out of identity assertions.
  vi.stubEnv("AGENT_USER_EMAIL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSandboxAdapterForTests();
  resetSandboxBackgroundForTests();
});

describe("run-code background param", () => {
  it("advertises background + executionId in the tool schema", () => {
    const entry = createRunCodeEntry(makeActions);
    expect(entry.tool.description).toContain("background: true");
    const props = (
      entry.tool.parameters as { properties: Record<string, unknown> }
    ).properties;
    expect(props.background).toBeDefined();
    expect(props.executionId).toBeDefined();
  });

  it("still requires code for non-poll calls", async () => {
    const entry = createRunCodeEntry(makeActions);
    expect(await entry.run({}, ctx)).toBe("Error: code is required.");
  });

  it("returns a structured error when background is requested without identity", async () => {
    const entry = createRunCodeEntry(makeActions);
    const result = (await entry.run({
      code: "console.log(1)",
      background: "true",
    })) as string;
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("error");
    expect(parsed.error.code).toBe("identity_required");
    expect(result.startsWith("Error")).toBe(false);
  });

  it("enqueues, returns guidance, executes for real, and serves the result on poll", async () => {
    const entry = createRunCodeEntry(makeActions);
    const enqueueResult = (await entry.run(
      { code: "console.log('bg says ' + (40 + 2))", background: true as never },
      ctx,
    )) as string;
    const enqueued = JSON.parse(enqueueResult);
    expect(enqueued.status).toBe("queued");
    expect(enqueued.executionId).toMatch(/^sbx_/);
    // Generous background default budget, not the 120s foreground default.
    expect(enqueued.timeoutMs).toBe(600_000);
    expect(enqueued.guidance).toContain(enqueued.executionId);
    expect(enqueued.guidance).toMatch(/continue other/i);
    expect(enqueued.guidance).toContain("run-code");

    // Row is owner-scoped and carries the raw code.
    const row = await getSandboxExecutionInternal(enqueued.executionId);
    expect(row!.owner).toBe(OWNER);
    expect(row!.orgId).toBe("org-1");
    expect(row!.code).toContain("40 + 2");

    // The in-process drive runs the code through the real local sandbox.
    await vi.waitFor(
      async () => {
        const updated = await getSandboxExecutionInternal(enqueued.executionId);
        expect(updated!.status).toBe("succeeded");
      },
      { timeout: 30_000, interval: 250 },
    );

    const pollResult = (await entry.run(
      { executionId: enqueued.executionId },
      ctx,
    )) as string;
    expect(pollResult).toContain('"status": "succeeded"');
    expect(pollResult).toContain("bg says 42");
  }, 40_000);

  it("dispatches to the processor route instead of running inline on serverless", async () => {
    serverless = true;
    const entry = createRunCodeEntry(makeActions);
    const result = JSON.parse(
      (await entry.run(
        { code: "console.log('later')", background: "true" },
        ctx,
      )) as string,
    );
    expect(result.status).toBe("queued");
    expect(fireInternalDispatch).toHaveBeenCalledTimes(1);
    const row = await getSandboxExecutionInternal(result.executionId);
    expect(row!.status).toBe("queued");
  });

  it("queues every call when AGENT_NATIVE_SANDBOX=background", async () => {
    serverless = true; // keep the drive as a mocked dispatch (no real exec)
    vi.stubEnv("AGENT_NATIVE_SANDBOX", "background");
    resetSandboxAdapterForTests();
    const entry = createRunCodeEntry(makeActions);
    const result = JSON.parse(
      (await entry.run({ code: "console.log('env queued')" }, ctx)) as string,
    );
    expect(result.status).toBe("queued");
    expect(result.executionId).toMatch(/^sbx_/);
  });

  it("honors a caller timeoutMs clamped to the background maximum", async () => {
    serverless = true;
    const entry = createRunCodeEntry(makeActions);
    const result = JSON.parse(
      (await entry.run(
        {
          code: "console.log(1)",
          background: "true",
          timeoutMs: 99_999_999 as never,
        },
        ctx,
      )) as string,
    );
    expect(result.timeoutMs).toBe(30 * 60_000);
  });
});

describe("run-code executionId polling", () => {
  it("returns a structured not-found for unknown ids", async () => {
    const entry = createRunCodeEntry(makeActions);
    const parsed = JSON.parse(
      (await entry.run({ executionId: "sbx_nope" }, ctx)) as string,
    );
    expect(parsed.status).toBe("error");
    expect(parsed.error.code).toBe("execution_not_found");
  });

  it("hides other users' executions (owner-scoped access)", async () => {
    serverless = true;
    const entry = createRunCodeEntry(makeActions);
    const enqueued = JSON.parse(
      (await entry.run(
        { code: "console.log('secret')", background: "true" },
        ctx,
      )) as string,
    );
    const other: ActionRunContext = {
      caller: "tool",
      userEmail: "mallory@example.com",
      orgId: "org-1",
    };
    const parsed = JSON.parse(
      (await entry.run({ executionId: enqueued.executionId }, other)) as string,
    );
    expect(parsed.status).toBe("error");
    expect(parsed.error.code).toBe("execution_not_found");
  });

  it("reports queued status with poll guidance while pending", async () => {
    serverless = true;
    const entry = createRunCodeEntry(makeActions);
    const enqueued = JSON.parse(
      (await entry.run(
        { code: "console.log('pending')", background: "true" },
        ctx,
      )) as string,
    );
    const parsed = JSON.parse(
      (await entry.run({ executionId: enqueued.executionId }, ctx)) as string,
    );
    expect(parsed.status).toBe("queued");
    expect(parsed.guidance).toMatch(/poll again/i);
  });
});

describe("get-code-execution entry", () => {
  it("is a read-only tool that serves the same scoped poll surface", async () => {
    serverless = true;
    const runCode = createRunCodeEntry(makeActions);
    const getExec = createGetCodeExecutionEntry();
    expect(getExec.readOnly).toBe(true);

    const enqueued = JSON.parse(
      (await runCode.run(
        { code: "console.log('via get tool')", background: "true" },
        ctx,
      )) as string,
    );
    const parsed = JSON.parse(
      (await getExec.run({ executionId: enqueued.executionId }, ctx)) as string,
    );
    expect(parsed.status).toBe("queued");

    const missing = JSON.parse((await getExec.run({}, ctx)) as string);
    expect(missing.error.code).toBe("execution_id_required");
  });
});
