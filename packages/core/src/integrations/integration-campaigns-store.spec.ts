import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const atomicBatchMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());
const isPostgresMock = vi.hoisted(() => vi.fn(() => false));
const ensureTableExistsMock = vi.hoisted(() => vi.fn());
const ensureIndexExistsMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: getDbExecMock,
  isPostgres: isPostgresMock,
  intType: () => "INTEGER",
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: ensureTableExistsMock,
  ensureIndexExists: ensureIndexExistsMock,
}));

async function loadStore() {
  vi.resetModules();
  return import("./integration-campaigns-store.js");
}

function sqlOf(query: string | { sql: string }): string {
  return typeof query === "string" ? query : query.sql;
}

function argsOf(query: string | { args?: unknown[] }): unknown[] {
  return typeof query === "string" ? [] : (query.args ?? []);
}

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    integration_task_id: "task-1",
    thread_id: "thread-1",
    turn_id: "turn-1",
    status: "pending",
    chunk_count: 0,
    current_run_id: null,
    lease_token: null,
    lease_expires_at: null,
    next_run_at: 1,
    progress_ref: "progress-ref-1",
    checkpoint: '{"cursor":"next"}',
    error_message: null,
    created_at: 1,
    updated_at: 1,
    completed_at: null,
    ...overrides,
  };
}

describe("integration campaigns store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPostgresMock.mockReturnValue(false);
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
    transactionMock.mockImplementation(async (fn) =>
      fn({ execute: executeMock }),
    );
    atomicBatchMock.mockResolvedValue([]);
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      transaction: transactionMock,
    });
    ensureTableExistsMock.mockResolvedValue(undefined);
    ensureIndexExistsMock.mockResolvedValue(undefined);
  });

  it("creates portable additive DDL with one campaign per integration task", async () => {
    const { ensureIntegrationCampaignsTable } = await loadStore();

    await ensureIntegrationCampaignsTable();

    const calls = executeMock.mock.calls.map(([query]) => sqlOf(query));
    expect(calls[0]).toContain(
      "CREATE TABLE IF NOT EXISTS integration_campaigns",
    );
    expect(calls[0]).toContain("integration_task_id TEXT NOT NULL UNIQUE");
    expect(calls[0]).toContain("chunk_count INTEGER NOT NULL DEFAULT 0");
    expect(calls).toContain(
      "CREATE INDEX IF NOT EXISTS idx_integration_campaigns_due ON integration_campaigns(status, next_run_at)",
    );
  });

  it("uses DDL guards and Postgres RETURNING only on the Postgres path", async () => {
    isPostgresMock.mockReturnValue(true);
    const { claimIntegrationCampaign } = await loadStore();
    executeMock.mockResolvedValue({ rows: [] });

    await claimIntegrationCampaign("campaign-1", {
      runId: "run-1",
      leaseToken: "lease-1",
      leaseDurationMs: 1_000,
      maxChunks: 3,
    });

    expect(ensureTableExistsMock).toHaveBeenCalledWith(
      "integration_campaigns",
      expect.stringContaining(
        "CREATE TABLE IF NOT EXISTS integration_campaigns",
      ),
    );
    expect(ensureIndexExistsMock).toHaveBeenCalledTimes(2);
    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("UPDATE integration_campaigns"),
    )?.[0];
    expect(sqlOf(update!)).toContain("RETURNING *");
  });

  it("returns the existing campaign when a concurrent create wins the unique race", async () => {
    const { createIntegrationCampaign } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = sqlOf(query);
      if (sql.includes("INSERT INTO integration_campaigns")) {
        throw new Error(
          "UNIQUE constraint failed: integration_campaigns.integration_task_id",
        );
      }
      if (sql.includes("WHERE integration_task_id = ?")) {
        return { rows: [campaignRow({ id: "campaign-existing" })] };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(
      createIntegrationCampaign({
        integrationTaskId: "task-1",
        threadId: "thread-new",
        turnId: "turn-new",
      }),
    ).resolves.toMatchObject({
      id: "campaign-existing",
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("claims a due campaign atomically and increments its chunk count once", async () => {
    const { claimIntegrationCampaign } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = sqlOf(query);
      if (sql.includes("UPDATE integration_campaigns")) {
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("WHERE id = ? LIMIT 1")) {
        return {
          rows: [
            campaignRow({
              status: "processing",
              chunk_count: 1,
              current_run_id: "run-1",
              lease_token: "lease-1",
            }),
          ],
        };
      }
      return { rows: [], rowsAffected: 0 };
    });

    const result = await claimIntegrationCampaign("campaign-1", {
      runId: "run-1",
      leaseToken: "lease-1",
      leaseDurationMs: 1_000,
      maxChunks: 3,
    });

    expect(result).toMatchObject({
      kind: "claimed",
      campaign: { chunkCount: 1 },
    });
    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("UPDATE integration_campaigns"),
    )?.[0];
    expect(sqlOf(update!)).toContain(
      "chunk_count = CASE WHEN status = 'waiting' OR checkpoint = ? THEN chunk_count ELSE chunk_count + 1 END",
    );
    expect(sqlOf(update!)).toContain("chunk_count < ?");
    expect(argsOf(update!)).toEqual([
      "processing",
      '{"waitingForA2A":true}',
      "run-1",
      "lease-1",
      expect.any(Number),
      expect.any(Number),
      "campaign-1",
      '{"waitingForA2A":true}',
      3,
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it("allows an expired processing lease to be reclaimed by a successor", async () => {
    const { claimIntegrationCampaign } = await loadStore();
    isPostgresMock.mockReturnValue(true);
    executeMock.mockResolvedValue({
      rows: [
        campaignRow({
          status: "processing",
          chunk_count: 2,
          current_run_id: "run-successor",
          lease_token: "lease-successor",
        }),
      ],
    });

    await expect(
      claimIntegrationCampaign("campaign-1", {
        runId: "run-successor",
        leaseToken: "lease-successor",
        leaseDurationMs: 1_000,
        maxChunks: 3,
      }),
    ).resolves.toMatchObject({ kind: "claimed", campaign: { chunkCount: 2 } });

    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("UPDATE integration_campaigns"),
    )?.[0];
    expect(sqlOf(update!)).toContain("lease_expires_at <= ?");
  });

  it("rejects stale worker writes by requiring the current run and lease token", async () => {
    const { heartbeatIntegrationCampaign, scheduleNextIntegrationCampaign } =
      await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(
      heartbeatIntegrationCampaign("campaign-1", {
        runId: "run-stale",
        leaseToken: "lease-stale",
        leaseDurationMs: 1_000,
      }),
    ).resolves.toBe(false);
    await expect(
      scheduleNextIntegrationCampaign("campaign-1", {
        runId: "run-stale",
        leaseToken: "lease-stale",
        nextRunAt: 10,
      }),
    ).resolves.toBe(false);

    const updates = executeMock.mock.calls
      .map(([query]) => sqlOf(query))
      .filter((sql) => sql.includes("UPDATE integration_campaigns"));
    expect(updates).toHaveLength(2);
    expect(updates.every((sql) => sql.includes("current_run_id = ?"))).toBe(
      true,
    );
    expect(updates.every((sql) => sql.includes("lease_token = ?"))).toBe(true);
  });

  it("bounds due listings and leaves reclaiming to the atomic claim", async () => {
    const { listDueIntegrationCampaignIds } = await loadStore();
    executeMock.mockResolvedValue({ rows: [{ id: "campaign-1" }] });

    await expect(listDueIntegrationCampaignIds(10_000)).resolves.toEqual([
      "campaign-1",
    ]);

    const select = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("SELECT id FROM integration_campaigns"),
    )?.[0];
    expect(sqlOf(select!)).toContain("lease_expires_at <= ?");
    expect(sqlOf(select!)).not.toContain("UPDATE");
    expect(argsOf(select!)).toEqual([
      expect.any(Number),
      expect.any(Number),
      100,
    ]);
  });

  it("reports the chunk ceiling instead of looping a campaign forever", async () => {
    const { claimIntegrationCampaign } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      if (sqlOf(query).includes("WHERE id = ? LIMIT 1")) {
        return { rows: [campaignRow({ chunk_count: 3, status: "pending" })] };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(
      claimIntegrationCampaign("campaign-1", {
        runId: "run-4",
        leaseToken: "lease-4",
        leaseDurationMs: 1_000,
        maxChunks: 3,
      }),
    ).resolves.toMatchObject({
      kind: "chunk-limit",
      campaign: { chunkCount: 3 },
    });
  });

  it("does not classify a duplicate invocation during a live final chunk as exhausted", async () => {
    const { claimIntegrationCampaign } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      if (sqlOf(query).includes("WHERE id = ? LIMIT 1")) {
        return {
          rows: [
            campaignRow({
              chunk_count: 4,
              status: "processing",
              lease_expires_at: Date.now() + 60_000,
            }),
          ],
        };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(
      claimIntegrationCampaign("campaign-1", {
        runId: "run-duplicate",
        leaseToken: "lease-duplicate",
        leaseDurationMs: 1_000,
        maxChunks: 4,
      }),
    ).resolves.toEqual({ kind: "not-due" });
  });

  it("leases delivery recovery without consuming another campaign chunk", async () => {
    const { claimIntegrationCampaignDeliveryForTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = sqlOf(query);
      if (sql.includes("UPDATE integration_campaigns")) {
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("integration_task_id = ? LIMIT 1")) {
        return {
          rows: [
            campaignRow({
              status: "processing",
              current_run_id: "delivery-run",
              lease_token: "delivery-lease",
            }),
          ],
        };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(
      claimIntegrationCampaignDeliveryForTask("task-1", {
        runId: "delivery-run",
        leaseToken: "delivery-lease",
        leaseDurationMs: 60_000,
      }),
    ).resolves.toMatchObject({ currentRunId: "delivery-run" });
    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("UPDATE integration_campaigns"),
    )?.[0];
    expect(sqlOf(update!)).not.toContain("chunk_count");
  });

  it("reclaims a stale waiting-A2A poll without consuming another model chunk", async () => {
    const { claimIntegrationCampaign } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = sqlOf(query);
      if (sql.includes("UPDATE integration_campaigns")) {
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("WHERE id = ? LIMIT 1")) {
        return {
          rows: [
            campaignRow({
              status: "processing",
              chunk_count: 4,
              current_run_id: "run-waiting",
              lease_token: "lease-waiting",
              checkpoint: JSON.stringify({ waitingForA2A: true }),
            }),
          ],
        };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(
      claimIntegrationCampaign("campaign-1", {
        runId: "run-waiting",
        leaseToken: "lease-waiting",
        leaseDurationMs: 1_000,
        maxChunks: 4,
      }),
    ).resolves.toMatchObject({
      kind: "claimed",
      campaign: { chunkCount: 4 },
    });
    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("UPDATE integration_campaigns"),
    )?.[0];
    expect(sqlOf(update!)).toContain(
      "CASE WHEN status = 'waiting' OR checkpoint = ? THEN chunk_count ELSE chunk_count + 1 END",
    );
    expect(argsOf(update!)).toEqual(
      expect.arrayContaining([
        '{"waitingForA2A":true}',
        '{"waitingForA2A":true}',
      ]),
    );
  });

  it("scrubs terminal checkpoint and progress references", async () => {
    const { completeIntegrationCampaign, failIntegrationCampaign } =
      await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      completeIntegrationCampaign("campaign-1", {
        runId: "run-1",
        leaseToken: "lease-1",
      }),
    ).resolves.toBe(true);
    await expect(
      failIntegrationCampaign("campaign-2", {
        runId: "run-2",
        leaseToken: "lease-2",
        errorMessage: "example failure",
      }),
    ).resolves.toBe(true);

    const terminalUpdates = executeMock.mock.calls
      .map(([query]) => query)
      .filter((query) => sqlOf(query).includes("progress_ref = NULL"));
    expect(terminalUpdates).toHaveLength(2);
    expect(
      terminalUpdates.every((query) =>
        sqlOf(query).includes("checkpoint = NULL"),
      ),
    ).toBe(true);
    expect(
      terminalUpdates.every((query) =>
        sqlOf(query).includes("lease_token = NULL"),
      ),
    ).toBe(true);
  });

  it("atomically completes a leased campaign with its pending task", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock.mockResolvedValue([
      { rows: [], rowsAffected: 1 },
      { rows: [], rowsAffected: 1 },
    ]);
    const { completeIntegrationCampaignTask } = await loadStore();

    await expect(
      completeIntegrationCampaignTask("campaign-1", {
        integrationTaskId: "task-1",
        runId: "run-1",
        leaseToken: "lease-1",
      }),
    ).resolves.toBe(true);

    const statements = atomicBatchMock.mock.calls[0]![0];
    expect(sqlOf(statements[0]!)).toContain("status = 'completed'");
    expect(sqlOf(statements[0]!)).toContain(
      "current_run_id = ? AND lease_token = ?",
    );
    expect(sqlOf(statements[1]!)).toContain("payload = '{}'");
    expect(sqlOf(statements[1]!)).toContain("AND changes() = 1");
  });

  it("lets exactly one overlapping campaign completion keep lease custody", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock
      .mockResolvedValueOnce([
        { rows: [], rowsAffected: 1 },
        { rows: [], rowsAffected: 1 },
      ])
      .mockResolvedValueOnce([
        { rows: [], rowsAffected: 0 },
        { rows: [], rowsAffected: 0 },
      ]);
    const { completeIntegrationCampaignTask } = await loadStore();
    const input = {
      integrationTaskId: "task-1",
      runId: "run-1",
      leaseToken: "lease-1",
    };

    await expect(
      Promise.all([
        completeIntegrationCampaignTask("campaign-1", input),
        completeIntegrationCampaignTask("campaign-1", input),
      ]),
    ).resolves.toEqual([true, false]);
  });

  it("atomically fails a disabled campaign and releases its processing task", async () => {
    const { failDisabledIntegrationCampaignTask } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await failDisabledIntegrationCampaignTask("task-1");

    expect(transactionMock).toHaveBeenCalledOnce();
    const updates = executeMock.mock.calls
      .map(([query]) => query)
      .filter((query) => sqlOf(query).startsWith("UPDATE"));
    expect(updates).toHaveLength(2);
    expect(sqlOf(updates[0]!)).toContain("UPDATE integration_campaigns");
    expect(sqlOf(updates[0]!)).toContain(
      "status IN ('pending', 'processing', 'waiting')",
    );
    expect(sqlOf(updates[1]!)).toContain("UPDATE integration_pending_tasks");
    expect(sqlOf(updates[1]!)).toContain("status = 'failed'");
    expect(argsOf(updates[1]!).at(-1)).toBe("task-1");
  });

  it("atomically contains delivery failure and releases campaign custody", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock.mockResolvedValue([
      { rows: [], rowsAffected: 1 },
      { rows: [], rowsAffected: 1 },
    ]);
    const { failIntegrationCampaignTaskDeliveryContainment } =
      await loadStore();

    await expect(
      failIntegrationCampaignTaskDeliveryContainment(
        "task-1",
        "receipt checkpoint failed",
      ),
    ).resolves.toBe(true);

    const statements = atomicBatchMock.mock.calls[0]![0];
    expect(sqlOf(statements[0]!)).toContain("status = 'failed'");
    expect(sqlOf(statements[0]!)).toContain(
      "status IN ('pending', 'processing', 'waiting')",
    );
    expect(sqlOf(statements[1]!)).toContain("status = 'failed'");
    expect(sqlOf(statements[1]!)).toContain("NOT EXISTS");
  });

  it("lets exactly one overlapping containment caller release task custody", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock
      .mockResolvedValueOnce([
        { rows: [], rowsAffected: 1 },
        { rows: [], rowsAffected: 1 },
      ])
      .mockResolvedValueOnce([
        { rows: [], rowsAffected: 0 },
        { rows: [], rowsAffected: 0 },
      ]);
    const { failIntegrationCampaignTaskDeliveryContainment } =
      await loadStore();

    await expect(
      Promise.all([
        failIntegrationCampaignTaskDeliveryContainment(
          "task-1",
          "receipt checkpoint failed",
        ),
        failIntegrationCampaignTaskDeliveryContainment(
          "task-1",
          "receipt checkpoint failed",
        ),
      ]),
    ).resolves.toEqual([true, false]);
  });

  it("atomically terminalizes a campaign while staging delivery-only retry", async () => {
    const { transitionIntegrationCampaignTaskToDeliveryRetry } =
      await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      transitionIntegrationCampaignTaskToDeliveryRetry("task-1", {
        payload: '{"kind":"response-delivery"}',
        errorMessage: "provider unavailable",
        campaignStatus: "failed",
        campaignId: "campaign-1",
        runId: "run-1",
        leaseToken: "lease-1",
      }),
    ).resolves.toBe(true);

    expect(transactionMock).toHaveBeenCalledOnce();
    const updates = executeMock.mock.calls
      .map(([query]) => query)
      .filter((query) => sqlOf(query).startsWith("UPDATE"));
    expect(updates).toHaveLength(2);
    expect(argsOf(updates[0]!)[0]).toBe("failed");
    expect(argsOf(updates[0]!).slice(-4)).toEqual([
      "campaign-1",
      "task-1",
      "run-1",
      "lease-1",
    ]);
    expect(sqlOf(updates[1]!)).toContain("status = 'pending'");
    expect(argsOf(updates[1]!)).toEqual([
      '{"kind":"response-delivery"}',
      "provider unavailable",
      expect.any(Number),
      "task-1",
      "campaign-1",
      "task-1",
      "failed",
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it("does not requeue delivery when the campaign lease was superseded", async () => {
    const { transitionIntegrationCampaignTaskToDeliveryRetry } =
      await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(
      transitionIntegrationCampaignTaskToDeliveryRetry("task-1", {
        payload: '{"kind":"response-delivery"}',
        errorMessage: "provider unavailable",
        campaignStatus: "completed",
        campaignId: "campaign-1",
        runId: "stale-run",
        leaseToken: "stale-lease",
      }),
    ).resolves.toBe(false);

    const updates = executeMock.mock.calls
      .map(([query]) => query)
      .filter((query) => sqlOf(query).startsWith("UPDATE"));
    expect(updates).toHaveLength(1);
    expect(sqlOf(updates[0]!)).toContain(
      "current_run_id = ? AND lease_token = ?",
    );
  });

  it("causally fences the D1 batch task update to the preceding lease update", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock.mockResolvedValue([
      { rows: [], rowsAffected: 0 },
      { rows: [], rowsAffected: 0 },
    ]);
    const { transitionIntegrationCampaignTaskToDeliveryRetry } =
      await loadStore();

    await expect(
      transitionIntegrationCampaignTaskToDeliveryRetry("task-1", {
        payload: '{"kind":"response-delivery"}',
        errorMessage: "stale delivery",
        campaignStatus: "completed",
        campaignId: "campaign-1",
        runId: "stale-run",
        leaseToken: "stale-lease",
      }),
    ).resolves.toBe(false);

    const statements = atomicBatchMock.mock.calls[0]![0];
    expect(statements).toHaveLength(2);
    expect(sqlOf(statements[1]!)).toContain("AND changes() = 1");
  });

  it("atomically hands a partial A2A receipt from the campaign lease to the parent task", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock.mockResolvedValue([
      { rows: [], rowsAffected: 1 },
      { rows: [], rowsAffected: 1 },
    ]);
    const { transitionIntegrationCampaignTaskToA2AReceiptRetry } =
      await loadStore();

    await expect(
      transitionIntegrationCampaignTaskToA2AReceiptRetry("task-1", {
        payload: '{"kind":"response-delivery","awaitingA2ACompletion":true}',
        errorMessage: "history needs retry",
        campaignId: "campaign-1",
        runId: "run-1",
        leaseToken: "lease-1",
        nextRunAt: 1234,
      }),
    ).resolves.toBe(true);

    const statements = atomicBatchMock.mock.calls[0]![0];
    expect(sqlOf(statements[0]!)).toContain("SET status = 'waiting'");
    expect(sqlOf(statements[0]!)).toContain(
      "current_run_id = ? AND lease_token = ?",
    );
    expect(sqlOf(statements[1]!)).toContain("status = 'processing'");
    expect(sqlOf(statements[1]!)).toContain("AND changes() = 1");
  });

  it("refreshes a partial A2A receipt retry only while the campaign owns waiting custody", async () => {
    const { refreshIntegrationCampaignTaskA2AReceiptRetry } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      refreshIntegrationCampaignTaskA2AReceiptRetry("task-1", {
        payload: '{"kind":"response-delivery","awaitingA2ACompletion":true}',
        errorMessage: "history still needs retry",
      }),
    ).resolves.toBe(true);

    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("checkpoint = ?"),
    )?.[0];
    expect(sqlOf(update!)).toContain("status = 'processing'");
    expect(argsOf(update!)).toContain(JSON.stringify({ waitingForA2A: true }));
  });

  it("atomically completes an A2A parent campaign and its processing task", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    atomicBatchMock.mockResolvedValue([
      { rows: [], rowsAffected: 1 },
      { rows: [], rowsAffected: 1 },
    ]);
    const { completeIntegrationCampaignTaskAfterA2A } = await loadStore();

    await expect(
      completeIntegrationCampaignTaskAfterA2A("task-1"),
    ).resolves.toBe(true);

    const statements = atomicBatchMock.mock.calls[0]![0];
    expect(sqlOf(statements[0]!)).toContain("status = 'completed'");
    expect(sqlOf(statements[0]!)).toContain("status = 'waiting'");
    expect(sqlOf(statements[1]!)).toContain("payload = '{}'");
    expect(sqlOf(statements[1]!)).toContain("AND changes() = 1");
  });

  it("uses an atomic batch when interactive transactions are unavailable", async () => {
    getDbExecMock.mockReturnValue({
      execute: executeMock,
      atomicBatch: atomicBatchMock,
    });
    const { failDisabledIntegrationCampaignTask } = await loadStore();

    await failDisabledIntegrationCampaignTask("task-d1");

    expect(atomicBatchMock).toHaveBeenCalledOnce();
    expect(atomicBatchMock.mock.calls[0]![0]).toHaveLength(2);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("fails closed when no atomic cancellation mechanism exists", async () => {
    getDbExecMock.mockReturnValue({ execute: executeMock });
    const { failDisabledIntegrationCampaignTask } = await loadStore();

    await expect(
      failDisabledIntegrationCampaignTask("task-unsafe"),
    ).rejects.toThrow("does not support atomic campaign cancellation");
  });

  it("terminalizes a stale campaign that already exhausted its chunk ceiling", async () => {
    const { failExhaustedIntegrationCampaign } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      failExhaustedIntegrationCampaign("campaign-1", {
        maxChunks: 4,
        errorMessage: "chunk limit",
      }),
    ).resolves.toBe(true);

    const update = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("chunk_count >= ?"),
    )?.[0];
    expect(sqlOf(update!)).toContain("progress_ref = NULL");
    expect(sqlOf(update!)).toContain("checkpoint = NULL");
    expect(argsOf(update!)).toEqual([
      "chunk limit",
      expect.any(Number),
      expect.any(Number),
      "campaign-1",
      4,
      JSON.stringify({ waitingForA2A: true }),
      expect.any(Number),
    ]);
    expect(sqlOf(update!)).toContain("lease_expires_at <= ?");
  });

  it("reports pending and processing campaigns as active for the task reaper", async () => {
    const { hasActiveIntegrationCampaign } = await loadStore();
    executeMock.mockResolvedValue({ rows: [{ active: 1 }] });

    await expect(hasActiveIntegrationCampaign("task-1")).resolves.toBe(true);

    const select = executeMock.mock.calls.find(([query]) =>
      sqlOf(query).includes("SELECT 1 AS active FROM integration_campaigns"),
    )?.[0];
    expect(sqlOf(select!)).toContain(
      "status IN ('pending', 'processing', 'waiting')",
    );
    expect(argsOf(select!)).toEqual(["task-1"]);
  });
});
