/**
 * Tests for the data-program execution orchestrator. Mocks `./store.js` (the
 * run cache + program CRUD), `../sharing/access.js` (viewer-scoped access
 * checks), and the dynamically-imported `../coding-tools/run-code.js` /
 * `../coding-tools/sandbox/index.js` modules so the sandbox itself is never
 * actually spawned — these tests only exercise the orchestration logic
 * (cache hit/miss, access denial, contract failures, background dedupe).
 */

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
  getActiveRun: vi.fn(),
  recordDataProgramRun: vi.fn(),
  updateDataProgramRun: vi.fn(),
  MAX_PROGRAM_ROWS: 10_000,
  MAX_PROGRAM_RESULT_BYTES: 4 * 1024 * 1024,
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
  storeMocks.getActiveRun.mockReset();
  storeMocks.recordDataProgramRun.mockReset();
  storeMocks.updateDataProgramRun.mockReset();
  accessMocks.resolveAccess.mockReset();

  storeMocks.getActiveRun.mockResolvedValue(null);
  storeMocks.recordDataProgramRun.mockResolvedValue(
    makeRun({ id: "dpr_running", status: "running" }),
  );
  storeMocks.updateDataProgramRun.mockResolvedValue(undefined);
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
      // First call (cache check) — no fresh cache; force a miss via old timestamp.
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
      // First call (initial cache check) misses; every call after that
      // (stale-serve lookups, possibly more than one) sees the stale run.
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
      expect(result.truncated).toBe(true);
      expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: "queued", executionId: "exec_1" }),
      );
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
    });

    it("finalizes a terminal queued run before deciding whether to re-enqueue", async () => {
      storeMocks.getDataProgram.mockResolvedValue(
        makeProgram({ background: true }),
      );
      accessMocks.resolveAccess.mockResolvedValue({ role: "owner" });
      storeMocks.getLatestSuccessfulRun
        .mockResolvedValueOnce(null) // initial cache check
        .mockResolvedValue(
          makeRun({
            finishedAt: Date.now(),
            rowsJson: JSON.stringify([{ done: true }]),
          }),
        ); // every stale-serve / resolveCacheHit lookup after finalize

      const queuedRun = makeRun({
        id: "dpr_queued",
        status: "queued",
        executionId: "exec_done",
        startedAt: Date.now() - 500,
      });
      storeMocks.getActiveRun
        .mockResolvedValueOnce(queuedRun) // first check: finalize path
        .mockResolvedValueOnce(null); // after finalize: no longer active

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
      );
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_queued",
        expect.objectContaining({ status: "succeeded", truncated: true }),
      );
      expect(result.ok).toBe(true);
    });

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
});
