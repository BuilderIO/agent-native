import { beforeEach, describe, expect, it, vi } from "vitest";

const { finishMock, renewMock, claimMock, submitMock } = vi.hoisted(() => ({
  finishMock: vi.fn(),
  renewMock: vi.fn(),
  claimMock: vi.fn(),
  submitMock: vi.fn(),
}));

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi.fn().mockResolvedValue({
    ownerEmail: "qa-fleet@builder.io",
    orgId: "org_1",
  }),
}));

vi.mock("../lib/analytics-capabilities.js", () => ({
  requirePreparedDraftSqlCapability: vi.fn().mockResolvedValue(undefined),
  requirePreparedNotebookSqlSource: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../model/notebook-results.js", () => ({
  checkNotebookAuthorities: vi.fn(),
  findCachedNotebookResult: vi.fn().mockResolvedValue(null),
  readNotebookKernelInput: vi.fn(),
  readNotebookResultAuthorities: vi.fn().mockResolvedValue([]),
  readNotebookResultChoices: vi.fn(),
}));

vi.mock("./warehouse-connector.js", () => ({
  withWarehouseSource: vi.fn(async (id: string | null, _actor, fn) =>
    fn({
      kind: "sample",
      id,
      generation: null,
      dialect: "sample",
      capabilities: { recover: false, arrow: false, cancel: false },
      authorize: async () => {},
      validate: async () => {},
      compile: (sql: string) => ({ sql, parameters: [] }),
      submit: submitMock,
    }),
  ),
}));

import type { Claim } from "../model/notebook-execution/run-store.js";
import { executeSampleQuery } from "../model/sample-query.js";
import { createNotebookWorker } from "./notebook-worker.js";

function makeClaim(source: string, dataConnectionId: string | null): Claim {
  return {
    work: {
      attemptId: "attempt-1",
      cellId: "cell-1",
      runId: "run-1",
      submissionId: "sub-1",
      dispatched: false,
      resultKind: "sql",
    },
    attempt: {
      attemptId: "attempt-1",
      cellId: "cell-1",
      runId: "run-1",
      namespaceId: "draft:org_1:proj-1",
      outputGeneration: "0",
    },
    run: {
      plan: {
        nodes: [
          {
            cellId: "cell-1",
            nodeId: "node-1",
            dependencies: [],
          },
        ],
        cells: [
          {
            dependencies: [],
            cell: {
              id: "cell-1",
              contents: {
                kind: "sql",
                source,
                dataConnectionId,
                connectionMode: "warehouse",
              },
            },
          },
        ],
        cacheDonor: null,
        admittedCellIds: ["cell-1"],
      },
      receipt: {
        runId: "run-1",
        request: {
          requestId: "req-1",
          mode: "run-cell",
          cache: "bypass",
          restart: false,
          snapshot: {
            inputRevision: "1",
            namespace: { kind: "draft" },
            ref: {
              projectId: "proj-1",
              workspaceId: "ws-1",
              eventSeq: "0",
              head: { versionId: "ver-1", revision: "0" },
            },
          },
        },
      },
    },
    dependencies: [],
  } as unknown as Claim;
}

describe("notebook-worker sample query error contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renewMock.mockResolvedValue({ status: "continue" });
    finishMock.mockResolvedValue(undefined);
  });

  it("reports project_connection_required when sample fallback returns null without a connection or sample table", async () => {
    claimMock.mockResolvedValueOnce(
      makeClaim("SELECT * FROM unknown_table", null),
    );
    submitMock.mockResolvedValueOnce(null);

    const store = {
      claim: claimMock,
      renew: renewMock,
      finish: finishMock,
      recordSegment: vi.fn(),
    } as unknown as Parameters<typeof createNotebookWorker>[0];
    const worker = createNotebookWorker(store, {} as never);

    const worked = await worker(
      { ownerEmail: "qa-fleet@builder.io", orgId: "org_1", caller: "frontend" },
      "run-1",
    );

    expect(worked).toBe(true);
    expect(finishMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        code: "project_connection_required",
        message: "Select a data connection before running this query.",
      }),
      undefined,
      undefined,
    );
  });

  it("reports project_sample_query_unsupported when sample fallback returns null for a sample table query", async () => {
    claimMock.mockResolvedValueOnce(
      makeClaim("SELECT * FROM orders", "builtin-sample-data"),
    );
    submitMock.mockResolvedValueOnce(null);

    const store = {
      claim: claimMock,
      renew: renewMock,
      finish: finishMock,
      recordSegment: vi.fn(),
    } as unknown as Parameters<typeof createNotebookWorker>[0];
    const worker = createNotebookWorker(store, {} as never);

    const worked = await worker(
      { ownerEmail: "qa-fleet@builder.io", orgId: "org_1", caller: "frontend" },
      "run-1",
    );

    expect(worked).toBe(true);
    expect(finishMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        code: "project_sample_query_unsupported",
        message:
          "This query uses the bundled sample data, which could not execute this SQL. Check the query or connect a data source.",
      }),
      undefined,
      undefined,
    );
  });

  it("confirms cancellation of a running built-in demo query by stopping the sample engine", async () => {
    claimMock.mockResolvedValueOnce(
      makeClaim(
        "select pg_sleep(30) from orders limit 1",
        "builtin-sample-data",
      ),
    );
    let leaseSignal: AbortSignal | undefined;
    submitMock.mockImplementationOnce(
      (compiled: { sql: string }, signal?: AbortSignal) => {
        leaseSignal = signal;
        return executeSampleQuery(compiled.sql, [], true, signal);
      },
    );
    renewMock.mockReset();
    renewMock
      .mockResolvedValueOnce({ status: "continue" })
      .mockResolvedValue({ status: "cancel" });

    const store = {
      claim: claimMock,
      renew: renewMock,
      finish: finishMock,
      recordSegment: vi.fn(),
    } as unknown as Parameters<typeof createNotebookWorker>[0];
    const worker = createNotebookWorker(store, {} as never);

    const startedAt = Date.now();
    const worked = await worker(
      { ownerEmail: "qa-fleet@builder.io", orgId: "org_1", caller: "frontend" },
      "run-1",
    );

    expect(worked).toBe(true);
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(leaseSignal?.aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(finishMock).toHaveBeenCalledTimes(1);
    expect(finishMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "cancelled",
        code: "cancel_confirmed",
      }),
      undefined,
      undefined,
    );
  });
});
