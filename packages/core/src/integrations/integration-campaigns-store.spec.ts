import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const isPostgresMock = vi.hoisted(() => vi.fn(() => false));
const ensureTableExistsMock = vi.hoisted(() => vi.fn());
const ensureIndexExistsMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
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
      `chunk_count = CASE WHEN status = 'waiting' OR checkpoint = '{"waitingForA2A":true}' THEN chunk_count ELSE chunk_count + 1 END`,
    );
    expect(sqlOf(update!)).toContain("chunk_count < ?");
    expect(argsOf(update!)).toEqual([
      "processing",
      "run-1",
      "lease-1",
      expect.any(Number),
      expect.any(Number),
      "campaign-1",
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
      `CASE WHEN status = 'waiting' OR checkpoint = '{"waitingForA2A":true}' THEN chunk_count ELSE chunk_count + 1 END`,
    );
    expect(sqlOf(update!)).toContain(`checkpoint = '{"waitingForA2A":true}'`);
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
