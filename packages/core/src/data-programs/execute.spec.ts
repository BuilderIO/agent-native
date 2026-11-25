import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_PROGRAM_SENTINEL } from "./contract.js";
import type { DataProgramRow, DataProgramRunRow } from "./store.js";

const PROGRAM_ID = "dp_abc123";
const OWNER = "owner@example.com";

function makeProgram(overrides: Partial<DataProgramRow> = {}): DataProgramRow {
  return {
    id: PROGRAM_ID,
    appId: "test-app",
    name: "cohort",
    title: "Cohort",
    description: "",
    code: "emit([{a:1}])",
    paramsSchema: null,
    defaultParams: null,
    outputColumns: null,
    refreshMode: "ttl",
    refreshTtlMs: 300_000,
    background: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    archivedAt: null,
    ownerEmail: OWNER,
    orgId: null,
    visibility: "private",
    ...overrides,
  };
}

function makeRun(
  overrides: Partial<DataProgramRunRow> = {},
): DataProgramRunRow {
  return {
    id: "dpr_1",
    programId: PROGRAM_ID,
    paramsHash: "hash",
    paramsJson: "{}",
    status: "succeeded",
    rowsJson: JSON.stringify([{ a: 1 }]),
    schemaJson: JSON.stringify([{ name: "a", type: "number" }]),
    truncated: false,
    rowCount: 1,
    byteSize: 20,
    errorCode: null,
    errorMessage: null,
    logsTail: null,
    executionId: null,
    triggeredBy: "agent",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    durationMs: 5,
    ...overrides,
  };
}

const storeMocks = vi.hoisted(() => ({
  getDataProgram: vi.fn(),
  getLatestSuccessfulRun: vi.fn(),
  getLatestFinishedRunOutcome: vi.fn(),
  getActiveRun: vi.fn(),
  recordDataProgramRun: vi.fn(),
  updateDataProgramRun: vi.fn(),
  MAX_PROGRAM_ROWS: 10_000,
  MAX_PROGRAM_RESULT_BYTES: 4 * 1024 * 1024,
}));

const sandboxMocks = vi.hoisted(() => ({
  discardSandboxExecutionOutput: vi.fn(),
}));

const accessMocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
}));

vi.mock("./store.js", () => storeMocks);
vi.mock("../sharing/access.js", () => accessMocks);

async function loadExecute() {
  return import("./execute.js");
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  storeMocks.getDataProgram.mockReset();
  storeMocks.getLatestSuccessfulRun.mockReset();
  storeMocks.getLatestFinishedRunOutcome.mockReset();
  storeMocks.getActiveRun.mockReset();
  storeMocks.recordDataProgramRun.mockReset();
  storeMocks.updateDataProgramRun.mockReset();
  accessMocks.resolveAccess.mockReset();
  sandboxMocks.discardSandboxExecutionOutput.mockReset();

  storeMocks.getActiveRun.mockResolvedValue(null);
  storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(null);
  storeMocks.recordDataProgramRun.mockResolvedValue(
    makeRun({ id: "dpr_running", status: "running" }),
  );
  storeMocks.updateDataProgramRun.mockResolvedValue(true);
  sandboxMocks.discardSandboxExecutionOutput.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.doUnmock("../coding-tools/run-code.js");
  vi.doUnmock("../coding-tools/sandbox/index.js");
});

describe("data-programs/execute", () => {
  describe("hashDataProgramParams", () => {
    it("uses canonical key ordering for equivalent params", async () => {
      const { hashDataProgramParams } = await loadExecute();

      expect(hashDataProgramParams({ a: 1, b: { c: 2, d: 3 } })).toBe(
        hashDataProgramParams({ b: { d: 3, c: 2 }, a: 1 }),
      );
    });

    it("scopes hashes by viewer and org", async () => {
      const { hashDataProgramParams } = await loadExecute();

      const base = hashDataProgramParams({ q: "won" }, OWNER, "org_1");
      expect(hashDataProgramParams({ q: "won" }, OWNER, "org_1")).toBe(base);
      expect(hashDataProgramParams({ q: "won" }, OWNER, "org_2")).not.toBe(
        base,
      );
      expect(
        hashDataProgramParams({ q: "won" }, "other@example.com", "org_1"),
      ).not.toBe(base);
    });
  });

  describe("program_not_found / access_denied / archived", () => {
    it("returns program_not_found when the program does not exist", async () => {
      storeMocks.getDataProgram.mockResolvedValue(null);
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("program_not_found");
    });

    it("returns access_denied when resolveAccess returns null", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue(null);
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: "someone-else@example.com" },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("access_denied");
    });

    it("returns archived (with lastGoodRun) when the program is archived", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ archivedAt: new Date().toISOString() }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(makeRun());
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("archived");
      expect(result.lastGoodRun?.rows).toEqual([{ a: 1 }]);
    });
  });

  describe("cache hit / miss / forceRefresh", () => {
    beforeEach(() => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
    });

    it("returns cacheHit: true when a fresh successful run exists", async () => {
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now(), truncated: true }),
      );
      const { hashDataProgramParams, runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER, orgId: "org_1" },
        triggeredBy: "panel_view",
      });

      expect(storeMocks.getLatestSuccessfulRun).toHaveBeenCalledWith(
        PROGRAM_ID,
        hashDataProgramParams(undefined, OWNER, "org_1"),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cacheHit).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.rows).toEqual([{ a: 1 }]);
    });

    it("treats a run older than refreshTtlMs as a cache miss and re-executes", async () => {
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() - 1_000_000 }), // older than default 300_000ms ttl
      );
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout:
            DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ fresh: true }] }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cacheHit).toBe(false);
      expect(result.rows).toEqual([{ fresh: true }]);
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_running",
        expect.objectContaining({ status: "succeeded" }),
      );
    });

    it("treats a run from before the program's last save as a cache miss and re-executes", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({
          refreshMode: "manual",
          updatedAt: new Date(Date.now() - 500).toISOString(),
        }),
      );
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({
          startedAt: Date.now() - 60_100,
          finishedAt: Date.now() - 60_000,
        }),
      );
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout:
            DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ fresh: true }] }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cacheHit).toBe(false);
      expect(result.rows).toEqual([{ fresh: true }]);
    });

    it("manual refreshMode treats any prior success as fresh regardless of age", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ refreshMode: "manual" }),
      );
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() - 999_999_999 }),
      );
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cacheHit).toBe(true);
    });

    it("forceRefresh bypasses a fresh cache and re-executes", async () => {
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() }),
      );
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout:
            DATA_PROGRAM_SENTINEL +
            JSON.stringify({ rows: [{ forced: true }] }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
        forceRefresh: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cacheHit).toBe(false);
      expect(result.rows).toEqual([{ forced: true }]);
    });
  });

  describe("contract failure surfaces {ok:false} with lastGoodRun", () => {
    it("surfaces emit_missing and attaches the prior successful run", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun
        .mockResolvedValueOnce(makeRun({ finishedAt: Date.now() - 1_000_000 }))
        .mockResolvedValueOnce(makeRun({ finishedAt: Date.now() - 1_000_000 }));
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout: "no sentinel here",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("emit_missing");
      expect(result.lastGoodRun?.rows).toEqual([{ a: 1 }]);
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_running",
        expect.objectContaining({
          status: "failed",
          errorCode: "emit_missing",
        }),
      );
    });

    it.each([
      [
        "node",
        "Unhandled error: The panels haven't been saved yet\n",
        "The panels haven't been saved yet",
      ],
      [
        "node syntax error",
        [
          "file:///tmp/program.mjs:3",
          "  emit(",
          "  ^",
          "",
          "SyntaxError: missing ) after argument list",
          "    at compileSourceTextModule (node:internal/modules/esm/utils:340:16)",
          "",
          "Node.js v22.11.0",
          "",
        ].join("\n"),
        "SyntaxError: missing ) after argument list",
      ],
      [
        "Run",
        "RUN_ERROR: The panels haven't been saved yet",
        "The panels haven't been saved yet",
      ],
    ])(
      "reports what a program threw (%s) instead of emit_missing",
      async (_evaluator, stderr, message) => {
        storeMocks.getDataProgram.mockResolvedValue(makeProgram());
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
        vi.doMock("../coding-tools/run-code.js", () => ({
          executeSandboxCode: vi.fn().mockResolvedValue({
            stdout: "",
            stderr,
            exitCode: 1,
            timedOut: false,
            bridgeToolsUsed: [],
          }),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toEqual({ code: "program_error", message });
        expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
          "dpr_running",
          expect.objectContaining({
            status: "failed",
            errorCode: "program_error",
            errorMessage: message,
          }),
        );
      },
    );

    it("doesn't report the Run evaluator's own failure as what the program threw", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout: "",
          stderr: "Run was interrupted before it completed.",
          exitCode: 1,
          timedOut: false,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("sandbox_error");
    });

    it("records a fixed message, not the executor's own, when the sandbox executor throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi
          .fn()
          .mockRejectedValue(new Error("spawn /srv/sandbox/bin/node ENOENT")),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: "sandbox_error",
        message: "The sandbox failed before the program finished.",
      });
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_running",
        expect.objectContaining({
          errorCode: "sandbox_error",
          errorMessage: "The sandbox failed before the program finished.",
        }),
      );
    });

    it("surfaces timeout as a distinct error code", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout: "",
          stderr: "",
          exitCode: null,
          timedOut: true,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("timeout");
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_running",
        expect.objectContaining({ status: "timed_out" }),
      );
    });
  });

  describe("run_code_unavailable", () => {
    it("returns run_code_unavailable when the run-code module fails to import", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      vi.doMock("../coding-tools/run-code.js", () => {
        throw new Error("module not found");
      });
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("run_code_unavailable");
    });
  });

  describe("inline preview/dry-run path (code, no programId)", () => {
    it("executes inline code without touching the program store or cache", async () => {
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout:
            DATA_PROGRAM_SENTINEL +
            JSON.stringify({ rows: [{ preview: true }] }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
          bridgeToolsUsed: [],
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        code: "emit([{preview:true}])",
        ctx: { userEmail: OWNER },
        triggeredBy: "preview",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows).toEqual([{ preview: true }]);
      expect(result.cacheHit).toBe(false);
      expect(storeMocks.getDataProgram).not.toHaveBeenCalled();
      expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
    });

    it("returns program_not_found when neither programId nor code is given", async () => {
      const { runDataProgram } = await loadExecute();
      const result = await runDataProgram({
        ctx: { userEmail: OWNER },
        triggeredBy: "preview",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("program_not_found");
    });
  });

  describe("background execution enqueue dedupe", () => {
    it("enqueues a background run and serves lastGoodRun as stale when no active run exists", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun
        .mockResolvedValueOnce(null)
        .mockResolvedValue(
          makeRun({
            finishedAt: Date.now() - 1_000_000,
            truncated: true,
          }),
        );
      storeMocks.getActiveRun.mockResolvedValue(null);

      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_1" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(enqueueSandboxExecution).toHaveBeenCalledTimes(1);
      expect(enqueueSandboxExecution).toHaveBeenCalledWith(
        expect.objectContaining({ caller: null }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stale).toBe(true);
      expect(result.refreshPending).toBe(true);
      expect(result.truncated).toBe(true);
      expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: "queued", executionId: "exec_1" }),
      );
    });

    it.each([
      {
        failure: "queueing the run",
        enqueue: () => Promise.reject(new Error("sandbox down")),
        record: () => Promise.resolve(undefined),
      },
      {
        failure: "recording the queued run",
        enqueue: () => Promise.resolve({ execution: { id: "exec_1" } }),
        record: () => Promise.reject(new Error("connection reset")),
      },
    ])(
      "serves stale rows without a pending run when $failure fails",
      async ({ enqueue, record }) => {
        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({ background: true }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun
          .mockResolvedValueOnce(null)
          .mockResolvedValue(makeRun({ finishedAt: Date.now() - 1_000_000 }));
        storeMocks.getActiveRun.mockResolvedValue(null);
        storeMocks.recordDataProgramRun.mockImplementationOnce(record);

        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution: vi.fn().mockImplementation(enqueue),
          getSandboxExecutionForOwner: vi.fn(),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.stale).toBe(true);
        expect(result.refreshPending).toBeUndefined();
        expect(consoleError).toHaveBeenCalledWith(
          `[data-programs] failed to enqueue background run for ${PROGRAM_ID}:`,
          expect.any(Error),
        );
      },
    );

    it("keeps an outside agent's caller on the background run it queues", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      storeMocks.getActiveRun.mockResolvedValue(null);
      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_1" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      vi.doMock("../action-frame.js", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../action-frame.js")>()),
        currentActionOriginCaller: () => "mcp",
      }));
      try {
        const { runDataProgram } = await loadExecute();

        await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(enqueueSandboxExecution).toHaveBeenCalledWith(
          expect.objectContaining({ caller: "mcp" }),
        );
      } finally {
        vi.doUnmock("../action-frame.js");
      }
    });

    it("skips enqueueing a second background run when one is already active and young", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun
        .mockResolvedValueOnce(null)
        .mockResolvedValue(makeRun({ finishedAt: Date.now() - 1_000_000 }));
      const activeRun = makeRun({
        id: "dpr_active",
        status: "running",
        executionId: null,
        startedAt: Date.now(),
      });
      storeMocks.getActiveRun.mockResolvedValue(activeRun);

      const enqueueSandboxExecution = vi.fn();
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stale).toBe(true);
      expect(result.refreshPending).toBe(true);
    });

    it("serves a background run that just finished instead of queueing another", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      // Read after the queued run below is finalized.
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({
          finishedAt: Date.now(),
          rowsJson: JSON.stringify([{ done: true }]),
        }),
      );

      const queuedRun = makeRun({
        id: "dpr_queued",
        status: "queued",
        executionId: "exec_done",
        startedAt: Date.now() - 500,
      });
      storeMocks.getActiveRun
        .mockResolvedValueOnce(queuedRun)
        .mockResolvedValueOnce(null);

      const oversizedRows = Array.from(
        { length: storeMocks.MAX_PROGRAM_ROWS + 1 },
        (_, i) => ({ done: true, i }),
      );
      const getSandboxExecutionForOwner = vi.fn().mockResolvedValue({
        status: "succeeded",
        stdout: DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: oversizedRows }),
        stderr: "",
      });
      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_new" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner,
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(getSandboxExecutionForOwner).toHaveBeenCalledWith(
        "exec_done",
        OWNER,
        null,
      );
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_queued",
        expect.objectContaining({ status: "succeeded", truncated: true }),
      );
      expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stale).toBe(false);
      expect(result.rows).toEqual([{ done: true }]);
    });

    it("finalizes a finished background run even while older rows are fresh", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      // Rows from before a Refresh, still inside the TTL.
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() - 60_000 }),
      );
      storeMocks.getActiveRun
        .mockResolvedValueOnce(
          makeRun({
            id: "dpr_refresh",
            status: "queued",
            executionId: "exec_refresh",
            startedAt: Date.now() - 5_000,
          }),
        )
        .mockResolvedValueOnce(null);

      const executionFinishedAt = Date.now() - 2_000;
      const enqueueSandboxExecution = vi.fn();
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
          status: "succeeded",
          stdout: DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ a: 2 }] }),
          stderr: "",
          finishedAt: executionFinishedAt,
        }),
      }));
      const { runDataProgram } = await loadExecute();

      await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_refresh",
        expect.objectContaining({
          status: "succeeded",
          rowsJson: JSON.stringify([{ a: 2 }]),
          finishedAt: executionFinishedAt,
        }),
      );
      expect(enqueueSandboxExecution).not.toHaveBeenCalled();
    });

    it.each([
      { status: "queued", startedAgoMs: 5_000, stale: true },
      { status: "running", startedAgoMs: 5_000, stale: true },
      { status: "running", startedAgoMs: 11 * 60_000, stale: false },
    ])(
      "marks fresh rows stale only while a young queued run is $status",
      async ({ status, startedAgoMs, stale }) => {
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({ background: true }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(
          makeRun({ finishedAt: Date.now() - 60_000 }),
        );
        storeMocks.getActiveRun.mockResolvedValueOnce(
          makeRun({
            id: "dpr_refresh",
            status: "queued",
            executionId: "exec_refresh",
            startedAt: Date.now() - startedAgoMs,
          }),
        );

        const enqueueSandboxExecution = vi.fn();
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution,
          getSandboxExecutionForOwner: vi.fn().mockResolvedValue({ status }),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.cacheHit).toBe(true);
        expect(result.stale).toBe(stale);
        expect(result.refreshPending === true).toBe(stale);
        expect(result.rows).toEqual([{ a: 1 }]);
        expect(storeMocks.updateDataProgramRun).not.toHaveBeenCalled();
        expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      },
    );

    it("serves fresh cached rows when checking the queued run fails", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() - 60_000 }),
      );
      storeMocks.getActiveRun.mockResolvedValueOnce(
        makeRun({
          id: "dpr_refresh",
          status: "queued",
          executionId: "exec_refresh",
          startedAt: Date.now() - 5_000,
        }),
      );

      const enqueueSandboxExecution = vi.fn();
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi
          .fn()
          .mockRejectedValue(new Error("connection reset")),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cacheHit).toBe(true);
      expect(result.rows).toEqual([{ a: 1 }]);
      expect(storeMocks.updateDataProgramRun).not.toHaveBeenCalled();
      expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[data-programs] couldn't check background run dpr_refresh:",
        expect.any(Error),
      );
    });

    it.each([
      ["fails", () => Promise.reject(new Error("connection reset"))],
      ["finds no execution", () => Promise.resolve(null)],
    ])(
      "reports sandbox_error, not pending, when the queued run's check %s and there are no rows",
      async (_case, lookup) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({ background: true }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
        storeMocks.getActiveRun.mockResolvedValue(
          makeRun({
            id: "dpr_queued",
            status: "queued",
            executionId: "exec_queued",
            startedAt: Date.now() - 5_000,
          }),
        );

        const enqueueSandboxExecution = vi.fn();
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution,
          getSandboxExecutionForOwner: vi.fn().mockImplementation(lookup),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("sandbox_error");
        expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["fails", () => Promise.reject(new Error("connection reset"))],
      ["finds no execution", () => Promise.resolve(null)],
    ])(
      "serves stale rows without a pending run when the queued run's check %s",
      async (_case, lookup) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({ background: true }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(
          makeRun({ finishedAt: Date.now() - 1_000_000 }),
        );
        storeMocks.getActiveRun.mockResolvedValue(
          makeRun({
            id: "dpr_queued",
            status: "queued",
            executionId: "exec_queued",
            startedAt: Date.now() - 5_000,
          }),
        );

        const enqueueSandboxExecution = vi.fn();
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution,
          getSandboxExecutionForOwner: vi.fn().mockImplementation(lookup),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.stale).toBe(true);
        expect(result.refreshPending).toBeUndefined();
        expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      },
    );

    it.each([false, true])(
      "reports a finished run it couldn't save with the last good rows, then saves it on the next read (forceRefresh %s)",
      async (forceRefresh) => {
        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({ background: true }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(
          makeRun({ finishedAt: Date.now() - 60_000 }),
        );
        const queuedRun = makeRun({
          id: "dpr_refresh",
          status: "queued",
          executionId: "exec_refresh",
          startedAt: Date.now() - 5_000,
        });
        storeMocks.getActiveRun.mockResolvedValue(queuedRun);
        storeMocks.updateDataProgramRun.mockRejectedValueOnce(
          new Error("connection reset"),
        );

        const enqueueSandboxExecution = vi.fn();
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution,
          getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
            status: "succeeded",
            stdout:
              DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ a: 2 }] }),
            stderr: "",
          }),
        }));
        const { runDataProgram } = await loadExecute();
        const read = () =>
          runDataProgram({
            programId: PROGRAM_ID,
            ctx: { userEmail: OWNER },
            triggeredBy: "panel_view",
            ...(forceRefresh ? { forceRefresh: true } : {}),
          });

        const result = await read();

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("sandbox_error");
        expect(result.lastGoodRun?.rows).toEqual([{ a: 1 }]);
        expect(enqueueSandboxExecution).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith(
          "[data-programs] couldn't save background run dpr_refresh:",
          expect.any(Error),
        );

        await read();

        expect(storeMocks.updateDataProgramRun).toHaveBeenCalledTimes(2);
        expect(storeMocks.updateDataProgramRun).toHaveBeenLastCalledWith(
          "dpr_refresh",
          expect.objectContaining({
            status: "succeeded",
            rowsJson: JSON.stringify([{ a: 2 }]),
          }),
        );
      },
    );

    it("still queues a new background run on forceRefresh after finalizing one", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() }),
      );
      storeMocks.getActiveRun
        .mockResolvedValueOnce(
          makeRun({
            id: "dpr_queued",
            status: "queued",
            executionId: "exec_done",
            startedAt: Date.now() - 500,
          }),
        )
        .mockResolvedValueOnce(null);

      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_new" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
          status: "succeeded",
          stdout: DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ a: 1 }] }),
          stderr: "",
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
        forceRefresh: true,
      });

      expect(enqueueSandboxExecution).toHaveBeenCalledTimes(1);
      expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: "queued", executionId: "exec_new" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stale).toBe(true);
    });

    it("records a failed background run and returns its error instead of queueing another", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      storeMocks.getActiveRun
        .mockResolvedValueOnce(
          makeRun({
            id: "dpr_queued",
            status: "queued",
            executionId: "exec_failed",
            startedAt: Date.now() - 500,
          }),
        )
        .mockResolvedValueOnce(null);

      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_new" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
          status: "failed",
          stdout: "",
          stderr: "Unhandled error: The panels haven't been saved yet\n",
          error: null,
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_queued",
        expect.objectContaining({
          status: "failed",
          errorCode: "program_error",
          errorMessage: "The panels haven't been saved yet",
        }),
      );
      expect(result).toEqual({
        ok: false,
        error: {
          code: "program_error",
          message: "The panels haven't been saved yet",
        },
      });
      expect(enqueueSandboxExecution).not.toHaveBeenCalled();
    });

    it.each([
      ["returns its error", 1_000, null, false],
      ["queues the program again", 400_000, null, true],
      ["queues the edited program again", 1_000, 500, true],
    ])(
      "on a later read of a run that failed %s",
      async (_case, failedAgoMs, editedAgoMs, enqueues) => {
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({
            background: true,
            ...(editedAgoMs === null
              ? {}
              : {
                  updatedAt: new Date(Date.now() - editedAgoMs).toISOString(),
                }),
          }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
        storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
          makeRun({
            status: "failed",
            rowsJson: null,
            errorCode: "program_error",
            errorMessage: "The panels haven't been saved yet",
            startedAt: Date.now() - failedAgoMs - 100,
            finishedAt: Date.now() - failedAgoMs,
          }),
        );
        const enqueueSandboxExecution = vi.fn().mockResolvedValue({
          execution: { id: "exec_new" },
        });
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution,
          getSandboxExecutionForOwner: vi.fn(),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(enqueueSandboxExecution).toHaveBeenCalledTimes(enqueues ? 1 : 0);
        if (!enqueues) {
          expect(result).toEqual({
            ok: false,
            error: {
              code: "program_error",
              message: "The panels haven't been saved yet",
            },
          });
        }
      },
    );

    it("returns a failed refresh over rows that are still fresh", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() - 60_000 }),
      );
      storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
        makeRun({
          id: "dpr_refresh",
          status: "failed",
          rowsJson: null,
          errorCode: "program_error",
          errorMessage: "The panels haven't been saved yet",
          finishedAt: Date.now() - 1_000,
        }),
      );
      const enqueueSandboxExecution = vi.fn();
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(enqueueSandboxExecution).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: "program_error",
        message: "The panels haven't been saved yet",
      });
      expect(result.lastGoodRun?.rows).toEqual([{ a: 1 }]);
    });

    it("queues an edited program over a failed refresh and serves the rows from before the edit as stale", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({
          background: true,
          updatedAt: new Date(Date.now() - 500).toISOString(),
        }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({
          startedAt: Date.now() - 60_100,
          finishedAt: Date.now() - 60_000,
        }),
      );
      storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
        makeRun({
          id: "dpr_refresh",
          status: "failed",
          rowsJson: null,
          errorCode: "program_error",
          errorMessage: "The panels haven't been saved yet",
          startedAt: Date.now() - 1_100,
          finishedAt: Date.now() - 1_000,
        }),
      );
      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_new" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(enqueueSandboxExecution).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stale).toBe(true);
      expect(result.rows).toEqual([{ a: 1 }]);
    });

    it.each([
      ["the executor's own error", "", "Sandbox executor error: spawn ENOENT"],
      [
        "the Run evaluator's interruption",
        "Run was interrupted before it completed.",
        null,
      ],
    ])(
      "records %s as sandbox_error with a fixed message",
      async (_case, stderr, error) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        storeMocks.getDataProgram.mockResolvedValue(
          makeProgram({ background: true }),
        );
        accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
        storeMocks.getActiveRun
          .mockResolvedValueOnce(
            makeRun({
              id: "dpr_queued",
              status: "queued",
              executionId: "exec_failed",
              startedAt: Date.now() - 500,
            }),
          )
          .mockResolvedValueOnce(null);

        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution: vi.fn().mockResolvedValue({
            execution: { id: "exec_new" },
          }),
          getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
            status: "failed",
            stdout: "",
            stderr,
            error,
          }),
        }));
        const { runDataProgram } = await loadExecute();

        await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
          "dpr_queued",
          expect.objectContaining({
            status: "failed",
            errorCode: "sandbox_error",
            errorMessage: "Background execution failed.",
          }),
        );
      },
    );

    it("returns background_pending when no cache exists and nothing to serve", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      storeMocks.getActiveRun.mockResolvedValue(null);

      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_2" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("background_pending");
    });
  });

  describe("output cap", () => {
    function queuedBackgroundRun() {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getActiveRun
        .mockResolvedValueOnce(
          makeRun({
            id: "dpr_queued",
            status: "queued",
            executionId: "exec_done",
            startedAt: Date.now() - 500,
          }),
        )
        .mockResolvedValueOnce(null);
    }

    it("gives foreground runs room for a whole result", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      const executeSandboxCode = vi.fn().mockResolvedValue({
        stdout: DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ a: 1 }] }),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        bridgeToolsUsed: [],
      });
      vi.doMock("../coding-tools/run-code.js", () => ({ executeSandboxCode }));
      const { runDataProgram } = await loadExecute();

      await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(
        executeSandboxCode.mock.calls[0]?.[0].maxStdoutChars,
      ).toBeGreaterThan(storeMocks.MAX_PROGRAM_RESULT_BYTES);
    });

    it("queues background runs with room for a whole result", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      const enqueueSandboxExecution = vi.fn().mockResolvedValue({
        execution: { id: "exec_1" },
      });
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution,
        getSandboxExecutionForOwner: vi.fn(),
      }));
      const { runDataProgram } = await loadExecute();

      await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(
        enqueueSandboxExecution.mock.calls[0]?.[0].maxOutputChars,
      ).toBeGreaterThan(storeMocks.MAX_PROGRAM_RESULT_BYTES);
    });

    it("reports result_too_large when the sandbox cut emit()'s line off", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout: `${DATA_PROGRAM_SENTINEL}{"rows":[{"a":1},{"a`,
          stderr: "",
          exitCode: 0,
          timedOut: false,
          bridgeToolsUsed: [],
          stdoutTruncated: true,
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("result_too_large");
    });

    it("reports what a program threw after printing more than the sandbox keeps", async () => {
      storeMocks.getDataProgram.mockResolvedValue(makeProgram());
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
      vi.doMock("../coding-tools/run-code.js", () => ({
        executeSandboxCode: vi.fn().mockResolvedValue({
          stdout: "log line\nlog line",
          stderr: "Unhandled error: boom after logging",
          exitCode: 1,
          timedOut: false,
          bridgeToolsUsed: [],
          stdoutTruncated: true,
        }),
      }));
      const { runDataProgram } = await loadExecute();

      const result = await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "agent",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: "program_error",
        message: "boom after logging",
      });
    });

    it("saves a finished background run once, then discards the sandbox's copy", async () => {
      queuedBackgroundRun();
      storeMocks.getLatestSuccessfulRun.mockResolvedValue(
        makeRun({ finishedAt: Date.now() }),
      );
      vi.doMock("../coding-tools/sandbox/index.js", () => ({
        discardSandboxExecutionOutput:
          sandboxMocks.discardSandboxExecutionOutput,
        enqueueSandboxExecution: vi.fn(),
        getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
          id: "exec_done",
          status: "succeeded",
          stdout: DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ a: 1 }] }),
          stderr: "",
        }),
      }));
      const { runDataProgram } = await loadExecute();

      await runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: OWNER },
        triggeredBy: "panel_view",
      });

      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_queued",
        expect.objectContaining({ status: "succeeded", onlyIfActive: true }),
      );
      expect(sandboxMocks.discardSandboxExecutionOutput).toHaveBeenCalledWith(
        "exec_done",
      );
    });

    it.each([
      ["finished", "succeeded", ""],
      [
        "was stopped for printing too much",
        "failed",
        "[sandbox] output exceeded the 33554432-byte-per-stream safety limit; process was terminated.",
      ],
    ])(
      "reports a cut-off background result as result_too_large when the program %s",
      async (_label, status, stderr) => {
        queuedBackgroundRun();
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution: vi.fn(),
          getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
            id: "exec_done",
            status,
            stdout: `${DATA_PROGRAM_SENTINEL}{"rows":[{"a":1},{"a`,
            stderr,
            stdoutTruncated: true,
          }),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
          "dpr_queued",
          expect.objectContaining({
            status: "failed",
            errorCode: "result_too_large",
          }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("result_too_large");
      },
    );

    it.each([
      [
        "a whole result",
        DATA_PROGRAM_SENTINEL +
          JSON.stringify({ rows: [{ a: 1 }] }) +
          "\nlog line",
      ],
      ["no result", "log line\nlog line"],
    ])(
      "keeps what a background program threw when its output was cut off after %s",
      async (_label, stdout) => {
        queuedBackgroundRun();
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution: vi.fn(),
          getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
            id: "exec_done",
            status: "failed",
            stdout,
            stderr: "Unhandled error: boom after logging",
            stdoutTruncated: true,
          }),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
          "dpr_queued",
          expect.objectContaining({
            status: "failed",
            errorCode: "program_error",
            errorMessage: "boom after logging",
          }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toEqual({
          code: "program_error",
          message: "boom after logging",
        });
      },
    );

    it.each([
      [
        "its rows",
        { status: "succeeded" as const, errorCode: null, errorMessage: null },
        { ok: true, rows: [{ a: 3 }] },
      ],
      [
        "its error",
        {
          status: "failed" as const,
          errorCode: "program_error",
          errorMessage: "Rate limited",
        },
        {
          ok: false,
          error: { code: "program_error", message: "Rate limited" },
        },
      ],
    ])(
      "serves a run another read saved first with %s, without overwriting it",
      async (_case, outcome, served) => {
        queuedBackgroundRun();
        storeMocks.updateDataProgramRun.mockResolvedValue(false);
        storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
          makeRun({ id: "dpr_queued", ...outcome, startedAt: Date.now() }),
        );
        storeMocks.getLatestSuccessfulRun.mockResolvedValue(
          outcome.status === "succeeded"
            ? makeRun({
                id: "dpr_queued",
                finishedAt: Date.now(),
                rowsJson: JSON.stringify([{ a: 3 }]),
              })
            : makeRun({ finishedAt: Date.now() - 1_000_000 }),
        );
        const enqueueSandboxExecution = vi.fn();
        vi.doMock("../coding-tools/sandbox/index.js", () => ({
          discardSandboxExecutionOutput:
            sandboxMocks.discardSandboxExecutionOutput,
          enqueueSandboxExecution,
          getSandboxExecutionForOwner: vi.fn().mockResolvedValue({
            id: "exec_done",
            status: outcome.status,
            stdout: "",
            stderr: "",
          }),
        }));
        const { runDataProgram } = await loadExecute();

        const result = await runDataProgram({
          programId: PROGRAM_ID,
          ctx: { userEmail: OWNER },
          triggeredBy: "panel_view",
        });

        expect(
          sandboxMocks.discardSandboxExecutionOutput,
        ).not.toHaveBeenCalled();
        expect(enqueueSandboxExecution).not.toHaveBeenCalled();
        expect(result).toMatchObject(served);
      },
    );
  });
});
