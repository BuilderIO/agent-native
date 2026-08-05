import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const isPostgresMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  isPostgres: isPostgresMock,
  intType: () => "INTEGER",
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../db/migrations.js", () => ({
  isDuplicateColumnError: (err: unknown) =>
    /duplicate column name|column .* already exists/i.test(
      (err as Error | undefined)?.message ?? "",
    ),
}));

async function loadStore() {
  vi.resetModules();
  return import("./a2a-continuations-store.js");
}

function querySql(query: string | { sql: string }): string {
  return typeof query === "string" ? query : query.sql;
}

function queryArgs(query: string | { args?: unknown[] }): unknown[] {
  return typeof query === "string" ? [] : (query.args ?? []);
}

/**
 * `recoverDueA2AContinuationIds` short-circuits on a cheap
 * `status IN ('pending','processing','delivering')` probe, so a double that
 * answers every SELECT with zero rows never reaches the recovery statements
 * these tests assert on. Report one live row from the probe and nothing else.
 */
function mockEmptyExceptLiveProbe(): void {
  executeMock.mockImplementation(async (query: string | { sql: string }) =>
    querySql(query).includes(
      "status IN ('pending', 'processing', 'delivering')",
    )
      ? { rows: [{ id: "cont-live" }], rowsAffected: 0 }
      : { rows: [], rowsAffected: 0 },
  );
}

function continuationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cont-1",
    integration_task_id: "task-1",
    platform: "slack",
    external_thread_id: "C123:123.456",
    incoming_payload: JSON.stringify({
      platform: "slack",
      externalThreadId: "C123:123.456",
      text: "make a deck",
      timestamp: 1,
    }),
    placeholder_ref: null,
    progress_ref: null,
    progress_ref_claimed: 0,
    owner_email: "alice+qa@agent-native.test",
    org_id: null,
    agent_name: "Slides",
    agent_url: "https://slides.agent-native.test",
    dedupe_key: "message-hash-1",
    a2a_task_id: "a2a-task-1",
    a2a_auth_token: null,
    verified_artifact_checkpoint: null,
    terminal_delivery_kind: null,
    terminal_delivery_confirmed_at: null,
    terminal_history_payload: null,
    status: "processing",
    attempts: 1,
    next_check_at: 1,
    error_message: null,
    created_at: 1,
    updated_at: 2,
    completed_at: null,
    ...overrides,
  };
}

describe("A2A continuations store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPostgresMock.mockReturnValue(false);
  });

  it("adds migrated columns before indexing them", async () => {
    const { getA2AContinuationForIntegrationTask } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await getA2AContinuationForIntegrationTask("task-existing");

    const calls = executeMock.mock.calls.map(([query]) => querySql(query));
    const dedupeAlterIndex = calls.findIndex((sql) =>
      sql.includes("ADD COLUMN dedupe_key"),
    );
    const dedupeIndexIndex = calls.findIndex((sql) =>
      sql.includes("idx_a2a_continuations_dedupe_key"),
    );
    expect(dedupeAlterIndex).toBeGreaterThan(-1);
    expect(dedupeIndexIndex).toBeGreaterThan(-1);
    expect(dedupeAlterIndex).toBeLessThan(dedupeIndexIndex);
    expect(calls).toContainEqual(
      expect.stringContaining("ADD COLUMN progress_ref"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("ADD COLUMN verified_artifact_checkpoint"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("ADD COLUMN terminal_delivery_kind"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("ADD COLUMN terminal_delivery_confirmed_at"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("ADD COLUMN terminal_history_payload"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("SET terminal_delivery_kind = 'success'"),
    );
    const progressOwnerAlterIndex = calls.findIndex((sql) =>
      sql.includes("ADD COLUMN progress_ref_claimed"),
    );
    const progressOwnerIndexIndex = calls.findIndex((sql) =>
      sql.includes("idx_a2a_continuations_one_progress_owner"),
    );
    const progressOwnerBackfillIndex = calls.findIndex(
      (sql) =>
        sql.includes("SET progress_ref_claimed = 1") &&
        sql.includes("ORDER BY selected.created_at ASC, selected.id ASC"),
    );
    expect(progressOwnerAlterIndex).toBeGreaterThan(-1);
    expect(progressOwnerBackfillIndex).toBeGreaterThan(-1);
    expect(progressOwnerIndexIndex).toBeGreaterThan(-1);
    expect(progressOwnerAlterIndex).toBeLessThan(progressOwnerBackfillIndex);
    expect(progressOwnerBackfillIndex).toBeLessThan(progressOwnerIndexIndex);
  });

  it("applies terminal receipt and history migrations on Postgres", async () => {
    isPostgresMock.mockReturnValue(true);
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
    const { getA2AContinuationForIntegrationTask } = await loadStore();

    await getA2AContinuationForIntegrationTask("task-existing");

    const calls = executeMock.mock.calls.map(([query]) => querySql(query));
    expect(calls).toContainEqual(
      expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS terminal_delivery_confirmed_at",
      ),
    );
    expect(calls).toContainEqual(
      expect.stringContaining(
        "ADD COLUMN IF NOT EXISTS terminal_history_payload",
      ),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("SET terminal_delivery_kind = 'success'"),
    );
  });

  it("persists and verifies a bounded artifact checkpoint on an active continuation", async () => {
    const { saveA2AVerifiedArtifactCheckpoint } = await loadStore();
    let checkpoint: string | null = null;
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (sql.includes("SET verified_artifact_checkpoint = ?")) {
          checkpoint = String(args[0]);
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [
              continuationRow({ verified_artifact_checkpoint: checkpoint }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    await expect(
      saveA2AVerifiedArtifactCheckpoint(
        "cont-1",
        "  verified /page/content-1  ",
      ),
    ).resolves.toBe("verified /page/content-1");
  });

  it("rejects an oversized verified artifact checkpoint", async () => {
    const { saveA2AVerifiedArtifactCheckpoint } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(
      saveA2AVerifiedArtifactCheckpoint("cont-1", "x".repeat(16_001)),
    ).rejects.toThrow("exceeds 16000 characters");
  });

  it("retains an unconfirmed delivery claim until stale recovery", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { retainA2AUnconfirmedDeliveryClaim } = await loadStore();
    const before = Date.now();

    await retainA2AUnconfirmedDeliveryClaim("cont-1");

    const update = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("SET next_check_at = ?"),
    );
    expect(querySql(update![0])).toContain("status = 'delivering'");
    expect(queryArgs(update![0])).toEqual([
      expect.any(Number),
      expect.any(Number),
      "cont-1",
    ]);
    expect(Number(queryArgs(update![0])[0])).toBeGreaterThanOrEqual(
      before + 5 * 60_000,
    );
  });

  it.each([
    [[], "missing"],
    [
      [{ status: "processing", terminal_delivery_confirmed_at: null }],
      "active",
    ],
    [
      [{ status: "completed", terminal_delivery_confirmed_at: 10 }],
      "terminal-delivered",
    ],
    [[{ status: "delivering", terminal_delivery_confirmed_at: 10 }], "active"],
    [
      [
        { status: "delivering", terminal_delivery_confirmed_at: 10 },
        { status: "processing", terminal_delivery_confirmed_at: null },
      ],
      "active",
    ],
    [
      [{ status: "failed", terminal_delivery_confirmed_at: null }],
      "terminal-without-delivery",
    ],
  ])("classifies task continuation custody as %s", async (rows, expected) => {
    const { getA2AContinuationTaskOutcome } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      if (
        querySql(query).includes(
          "SELECT status, terminal_delivery_confirmed_at",
        )
      ) {
        return { rows, rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(getA2AContinuationTaskOutcome("task-1")).resolves.toBe(
      expected,
    );
  });

  it.each([
    [
      [
        {
          status: "failed",
          terminal_delivery_kind: null,
          terminal_delivery_confirmed_at: null,
          terminal_history_payload: null,
        },
      ],
      true,
    ],
    [
      [
        {
          status: "failed",
          terminal_delivery_kind: "failure",
          terminal_delivery_confirmed_at: 10,
          terminal_history_payload: null,
        },
      ],
      false,
    ],
  ])(
    "detects ambiguous legacy failed custody as %s",
    async (rows, expected) => {
      executeMock.mockImplementation(
        async (query: string | { sql: string }) => {
          if (
            querySql(query).includes("SELECT status, terminal_delivery_kind")
          ) {
            return { rows, rowsAffected: 0 };
          }
          return { rows: [], rowsAffected: 0 };
        },
      );
      const { hasOnlyLegacyFailedA2AContinuationsForIntegrationTask } =
        await loadStore();

      await expect(
        hasOnlyLegacyFailedA2AContinuationsForIntegrationTask("task-1"),
      ).resolves.toBe(expected);
    },
  );

  it("records provider-confirmed terminal delivery without terminalizing or scrubbing history custody", async () => {
    const persisted = new Map<string, Record<string, unknown>>();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (sql.includes("terminal_delivery_confirmed_at = COALESCE")) {
          persisted.set(String(args[6]), {
            status: "delivering",
            terminal_delivery_kind: args[0],
            terminal_delivery_confirmed_at: args[1],
            terminal_history_payload: args[2],
            error_message: args[5],
          });
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [continuationRow(persisted.get(String(args[0])) ?? {})],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );
    const { recordA2ATerminalDeliveryReceipt } = await loadStore();
    const history = {
      text: "Created /page/content-1",
      deliveredAt: new Date().toISOString(),
      messageRefs: ["slack-message-1"],
      artifacts: [
        {
          id: "content-1",
          resourceType: "document",
          sourceAction: "call-agent",
        },
      ],
    };

    const beforeReceipt = Date.now();
    await recordA2ATerminalDeliveryReceipt("cont-success", "success", history);
    await recordA2ATerminalDeliveryReceipt(
      "cont-failure",
      "failure",
      history,
      "remote failed",
    );

    const terminalUpdates = executeMock.mock.calls
      .map(([query]) => query)
      .filter(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("terminal_delivery_confirmed_at = COALESCE"),
      );
    expect(terminalUpdates).toHaveLength(2);
    expect(terminalUpdates[0].args).toEqual([
      "success",
      expect.any(Number),
      JSON.stringify(history),
      expect.any(Number),
      expect.any(Number),
      null,
      "cont-success",
      "success",
    ]);
    expect(terminalUpdates[1].args).toEqual([
      "failure",
      expect.any(Number),
      JSON.stringify(history),
      expect.any(Number),
      expect.any(Number),
      "remote failed",
      "cont-failure",
      "failure",
    ]);
    expect(Number(terminalUpdates[0].args[3])).toBeGreaterThanOrEqual(
      beforeReceipt + 60_000,
    );
    expect(Number(terminalUpdates[1].args[3])).toBeGreaterThanOrEqual(
      beforeReceipt + 60_000,
    );
  });

  it("fails loud when terminal delivery confirmation does not persist", async () => {
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      if (
        querySql(query).includes(
          "SELECT * FROM integration_a2a_continuations WHERE id = ?",
        )
      ) {
        return {
          rows: [continuationRow({ status: "delivering" })],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const { recordA2ATerminalDeliveryReceipt } = await loadStore();

    await expect(
      recordA2ATerminalDeliveryReceipt("cont-unconfirmed", "success", {
        text: "Created /page/content-1",
        deliveredAt: new Date().toISOString(),
        messageRefs: [],
        artifacts: [],
      }),
    ).rejects.toThrow("did not persist");
  });

  it("rejects an oversized terminal history payload before writing a receipt", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
    const { recordA2ATerminalDeliveryReceipt } = await loadStore();

    await expect(
      recordA2ATerminalDeliveryReceipt("cont-1", "success", {
        text: "x".repeat(64_001),
        deliveredAt: new Date().toISOString(),
        messageRefs: [],
        artifacts: [],
      }),
    ).rejects.toThrow("exceeds 64000 characters");
  });

  it("terminalizes and scrubs only after durable history persistence", async () => {
    let finalized = false;
    let finalizationSql = "";
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("terminal_history_payload = NULL")) {
          finalizationSql = sql;
          finalized = true;
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [
              continuationRow({
                status: finalized ? "completed" : "delivering",
                terminal_delivery_kind: "success",
                terminal_delivery_confirmed_at: 10,
                terminal_history_payload: finalized
                  ? null
                  : JSON.stringify({
                      text: "Created /page/content-1",
                      deliveredAt: new Date().toISOString(),
                      messageRefs: [],
                      artifacts: [],
                    }),
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );
    const { finalizeA2ATerminalHistory } = await loadStore();

    await expect(finalizeA2ATerminalHistory("cont-1")).resolves.toBeUndefined();
    expect(finalized).toBe(true);
    expect(finalizationSql).toContain(
      "status IN ('pending', 'processing', 'delivering')",
    );
  });

  it("finalizes receipt-backed history after stale delivery recovery and a fresh processing claim", async () => {
    const history = JSON.stringify({
      text: "Created /page/content-1",
      deliveredAt: new Date().toISOString(),
      messageRefs: ["slack-message-1"],
      artifacts: [],
    });
    const state = continuationRow({
      status: "delivering",
      terminal_delivery_kind: "success",
      terminal_delivery_confirmed_at: 10,
      terminal_history_payload: history,
      next_check_at: 0,
    });
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (
          sql.includes("WHERE status = 'delivering'") &&
          sql.includes("terminal_delivery_confirmed_at")
        ) {
          state.status = "pending";
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SELECT id FROM integration_a2a_continuations")) {
          return { rows: [{ id: state.id }], rowsAffected: 0 };
        }
        if (sql.includes("attempts = attempts + 1")) {
          state.status = "processing";
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("terminal_history_payload = NULL")) {
          state.status = "completed";
          state.terminal_history_payload = null;
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return { rows: [{ ...state }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );
    const {
      claimA2AContinuation,
      finalizeA2ATerminalHistory,
      recoverDueA2AContinuationIds,
    } = await loadStore();

    await expect(recoverDueA2AContinuationIds(1)).resolves.toEqual(["cont-1"]);
    await expect(claimA2AContinuation("cont-1")).resolves.toMatchObject({
      status: "processing",
      terminalDeliveryConfirmedAt: 10,
    });
    await expect(finalizeA2ATerminalHistory("cont-1")).resolves.toBeUndefined();
    expect(state.status).toBe("completed");
    expect(state.terminal_history_payload).toBeNull();
  });

  it("loads recoverable continuation owners and scope without task N+1 reads", async () => {
    const { listRecoverableA2AIntegrationTasks } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      if (querySql(query).includes("INNER JOIN integration_pending_tasks")) {
        return {
          rows: [
            {
              integration_task_id: "task-1",
              platform: "slack",
              external_thread_id: "C123:123.456",
              dispatch_scope: "C123",
              status: "processing",
              has_pending_confirmed_delivery: 1,
            },
          ],
        };
      }
      return { rows: [], rowsAffected: 0 };
    });

    await expect(listRecoverableA2AIntegrationTasks(10)).resolves.toEqual([
      {
        id: "task-1",
        platform: "slack",
        externalThreadId: "C123:123.456",
        dispatchScope: "C123",
        status: "processing",
        hasPendingConfirmedDelivery: true,
      },
    ]);
    const joinedReads = executeMock.mock.calls.filter(([query]) =>
      querySql(query).includes("INNER JOIN integration_pending_tasks"),
    );
    expect(joinedReads).toHaveLength(1);
    expect(queryArgs(joinedReads[0]![0]).at(-1)).toBe(10);
  });

  it("terminalizes all active A2A rows for a disabled durable task", async () => {
    const { failA2AContinuationsForIntegrationTask } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 2 });

    await failA2AContinuationsForIntegrationTask(
      "task-disabled",
      "durable scope disabled",
    );

    const update = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("SET status = 'failed'"),
    )?.[0];
    expect(querySql(update!)).toContain(
      "status IN ('pending', 'processing', 'delivering')",
    );
    expect(querySql(update!)).toContain(
      "terminal_delivery_confirmed_at IS NULL",
    );
    expect(queryArgs(update!)).toEqual([
      "durable scope disabled",
      expect.any(Number),
      expect.any(Number),
      "task-disabled",
    ]);
  });

  it("does not swallow non-duplicate column migration errors", async () => {
    const { getA2AContinuationForIntegrationTask } = await loadStore();
    const migrationError = new Error("permission denied for table");
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("ADD COLUMN a2a_auth_token")) {
          throw migrationError;
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    await expect(
      getA2AContinuationForIntegrationTask("task-existing"),
    ).rejects.toThrow("permission denied");
  });

  it("finds an existing continuation for an integration task", async () => {
    const { getA2AContinuationForIntegrationTask } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes("WHERE integration_task_id = ?") &&
          sql.includes("ORDER BY created_at ASC")
        ) {
          return {
            rows: [
              continuationRow({
                id: "cont-existing",
                integration_task_id: args[0],
                created_at: 10,
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const continuation =
      await getA2AContinuationForIntegrationTask("task-existing");

    expect(continuation?.id).toBe("cont-existing");
    expect(continuation?.integrationTaskId).toBe("task-existing");
  });

  it("lists continuations for an integration task, agent URL, and dedupe key", async () => {
    const { getA2AContinuationsForIntegrationTaskAgent } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes(
            "WHERE integration_task_id = ? AND agent_url = ? AND dedupe_key = ?",
          ) &&
          sql.includes("ORDER BY created_at ASC")
        ) {
          return {
            rows: [
              continuationRow({
                id: "cont-first",
                integration_task_id: args[0],
                agent_url: args[1],
                dedupe_key: args[2],
                created_at: 10,
              }),
              continuationRow({
                id: "cont-second",
                integration_task_id: args[0],
                agent_url: args[1],
                dedupe_key: args[2],
                status: "completed",
                created_at: 20,
                completed_at: 30,
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const continuations = await getA2AContinuationsForIntegrationTaskAgent(
      "task-existing",
      "https://slides.agent-native.test",
      "message-hash-1",
    );

    expect(continuations.map((continuation) => continuation.id)).toEqual([
      "cont-first",
      "cont-second",
    ]);
    expect(
      executeMock.mock.calls.some(([query]) => {
        const sql = querySql(query);
        return (
          sql.includes(
            "integration_task_id = ? AND agent_url = ? AND dedupe_key = ?",
          ) && sql.includes("ORDER BY created_at ASC")
        );
      }),
    ).toBe(true);
    expect(queryArgs(executeMock.mock.calls.at(-1)![0])).toEqual([
      "task-existing",
      "https://slides.agent-native.test",
      "message-hash-1",
    ]);
  });

  it("assigns a native progress stream to only one continuation per integration task", async () => {
    const { insertA2AContinuation } = await loadStore();
    const progressRefs = new Map<string, string | null>();
    let progressOwnerClaimed = false;
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.trim().startsWith("INSERT INTO integration_a2a_continuations")
        ) {
          progressRefs.set(args[0] as string, null);
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SET progress_ref = ?, progress_ref_claimed = 1")) {
          if (progressOwnerClaimed) {
            throw new Error(
              "UNIQUE constraint failed: integration_a2a_continuations.integration_task_id",
            );
          }
          progressOwnerClaimed = true;
          progressRefs.set(args[1] as string, args[0] as string);
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [
              continuationRow({
                id: args[0],
                integration_task_id: "task-existing",
                agent_name: "Analytics",
                agent_url: "https://analytics.agent-native.test",
                a2a_task_id: "a2a-task-new",
                progress_ref: progressRefs.get(args[0] as string),
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const first = await insertA2AContinuation({
      integrationTaskId: "task-existing",
      platform: "slack",
      externalThreadId: "C123:123.456",
      incoming: {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "make a deck",
        platformContext: {},
        responseContext: { interactionToken: "active-token-example" },
        timestamp: 1,
      },
      progressRef: { kind: "slack-stream", streamTs: "1719000000.000001" },
      ownerEmail: "alice+qa@agent-native.test",
      agentName: "Analytics",
      agentUrl: "https://analytics.agent-native.test",
      a2aTaskId: "a2a-task-new",
    });

    const second = await insertA2AContinuation({
      integrationTaskId: "task-existing",
      platform: "slack",
      externalThreadId: "C123:123.456",
      incoming: {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "make a report",
        platformContext: {},
        responseContext: { interactionToken: "active-token-example" },
        timestamp: 1,
      },
      progressRef: { kind: "slack-stream", streamTs: "1719000000.000001" },
      ownerEmail: "alice+qa@agent-native.test",
      agentName: "Research",
      agentUrl: "https://research.agent-native.test",
      a2aTaskId: "a2a-task-second",
    });

    expect(first.integrationTaskId).toBe("task-existing");
    expect(first.agentName).toBe("Analytics");
    expect(first.a2aTaskId).toBe("a2a-task-new");
    expect(first.progressRef).toEqual({
      kind: "slack-stream",
      streamTs: "1719000000.000001",
    });
    expect(second.progressRef).toBeNull();
    const insertCalls = executeMock.mock.calls.filter(([query]) =>
      querySql(query)
        .trim()
        .startsWith("INSERT INTO integration_a2a_continuations"),
    );
    expect(insertCalls).toHaveLength(2);
    expect(JSON.parse(String(queryArgs(insertCalls[0]![0])[4]))).toMatchObject({
      responseContext: { interactionToken: "active-token-example" },
    });
    expect(queryArgs(insertCalls[0]![0])[6]).toBeNull();
    expect(queryArgs(insertCalls[0]![0])[7]).toBe(0);
    const progressClaimCalls = executeMock.mock.calls.filter(([query]) =>
      querySql(query).includes(
        "SET progress_ref = ?, progress_ref_claimed = 1",
      ),
    );
    expect(progressClaimCalls).toHaveLength(2);
    expect(queryArgs(progressClaimCalls[0]![0])).toEqual([
      JSON.stringify({ kind: "slack-stream", streamTs: "1719000000.000001" }),
      expect.any(String),
    ]);
  });

  it.each([
    ["missing", null],
    [
      "stale",
      JSON.stringify({
        kind: "slack-stream",
        streamTs: "1719000000.000001",
      }),
    ],
  ])(
    "upgrades a duplicate active continuation with a %s resumable progress reference",
    async (_state, initialProgressRef) => {
      const { insertA2AContinuation } = await loadStore();
      const newerProgressRef = {
        kind: "slack-stream",
        streamTs: "1719000000.000002",
      };
      let progressRef = initialProgressRef;
      executeMock.mockImplementation(
        async (query: string | { sql: string; args?: unknown[] }) => {
          const sql = querySql(query);
          const args = queryArgs(query);
          if (
            sql.trim().startsWith("INSERT INTO integration_a2a_continuations")
          ) {
            throw Object.assign(new Error("duplicate key value"), {
              code: "23505",
            });
          }
          if (
            sql.includes("WHERE integration_task_id = ?") &&
            sql.includes("a2a_task_id = ?")
          ) {
            return {
              rows: [
                continuationRow({
                  id: "cont-duplicate",
                  status: "pending",
                  progress_ref: progressRef,
                  progress_ref_claimed: 1,
                }),
              ],
              rowsAffected: 0,
            };
          }
          if (
            sql.includes("UPDATE integration_a2a_continuations") &&
            sql.includes("SET progress_ref = ?")
          ) {
            progressRef = String(args[0]);
            return { rows: [], rowsAffected: 1 };
          }
          if (
            sql.includes(
              "SELECT * FROM integration_a2a_continuations WHERE id = ?",
            )
          ) {
            return {
              rows: [
                continuationRow({
                  id: "cont-duplicate",
                  status: "pending",
                  progress_ref: progressRef,
                  progress_ref_claimed: 1,
                }),
              ],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
      );

      const continuation = await insertA2AContinuation({
        integrationTaskId: "task-existing",
        platform: "slack",
        externalThreadId: "C123:123.456",
        incoming: {
          platform: "slack",
          externalThreadId: "C123:123.456",
          text: "make a deck",
          platformContext: {},
          timestamp: 1,
        },
        progressRef: newerProgressRef,
        ownerEmail: "alice+qa@agent-native.test",
        agentName: "Analytics",
        agentUrl: "https://analytics.agent-native.test",
        a2aTaskId: "a2a-task-existing",
      });

      expect(continuation.progressRef).toEqual(newerProgressRef);
      const updateCall = executeMock.mock.calls.find(([query]) =>
        querySql(query).includes("SET progress_ref = ?"),
      );
      expect(updateCall).toBeDefined();
      expect(queryArgs(updateCall![0])).toEqual([
        JSON.stringify(newerProgressRef),
        expect.any(Number),
        "cont-duplicate",
        JSON.stringify(newerProgressRef),
      ]);
    },
  );

  it("does not let a duplicate retry reclaim a sibling's native progress stream", async () => {
    const { insertA2AContinuation } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (
          sql.trim().startsWith("INSERT INTO integration_a2a_continuations")
        ) {
          throw Object.assign(new Error("duplicate key value"), {
            code: "23505",
          });
        }
        if (
          sql.includes("WHERE integration_task_id = ?") &&
          sql.includes("a2a_task_id = ?")
        ) {
          return {
            rows: [
              continuationRow({
                id: "cont-lost-owner-race",
                status: "pending",
                progress_ref: null,
                progress_ref_claimed: 0,
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (sql.includes("SET progress_ref = ?, progress_ref_claimed = 1")) {
          throw new Error(
            "UNIQUE constraint failed: integration_a2a_continuations.integration_task_id",
          );
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [
              continuationRow({
                id: "cont-lost-owner-race",
                status: "pending",
                progress_ref: null,
                progress_ref_claimed: 0,
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const continuation = await insertA2AContinuation({
      integrationTaskId: "task-existing",
      platform: "slack",
      externalThreadId: "C123:123.456",
      incoming: {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "retry the report",
        platformContext: {},
        timestamp: 1,
      },
      progressRef: { kind: "slack-stream", streamTs: "1719000000.000002" },
      ownerEmail: "alice+qa@agent-native.test",
      agentName: "Research",
      agentUrl: "https://research.agent-native.test",
      a2aTaskId: "a2a-task-existing",
    });

    expect(continuation.progressRef).toBeNull();
    expect(continuation.progressRefClaimed).toBe(false);
    expect(
      executeMock.mock.calls.some(([query]) =>
        querySql(query).includes(
          "SET progress_ref = ?, progress_ref_claimed = 1",
        ),
      ),
    ).toBe(true);
  });

  it("does not restore progress on duplicate terminal continuations", async () => {
    const { insertA2AContinuation } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (
          sql.trim().startsWith("INSERT INTO integration_a2a_continuations")
        ) {
          throw Object.assign(new Error("duplicate key value"), {
            code: "23505",
          });
        }
        if (
          sql.includes("WHERE integration_task_id = ?") &&
          sql.includes("a2a_task_id = ?")
        ) {
          return {
            rows: [
              continuationRow({ id: "cont-completed", status: "completed" }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const continuation = await insertA2AContinuation({
      integrationTaskId: "task-existing",
      platform: "slack",
      externalThreadId: "C123:123.456",
      incoming: {
        platform: "slack",
        externalThreadId: "C123:123.456",
        text: "make a deck",
        platformContext: {},
        timestamp: 1,
      },
      progressRef: { kind: "slack-stream", streamTs: "1719000000.000002" },
      ownerEmail: "alice+qa@agent-native.test",
      agentName: "Analytics",
      agentUrl: "https://analytics.agent-native.test",
      a2aTaskId: "a2a-task-existing",
    });

    expect(continuation.progressRef).toBeNull();
    expect(
      executeMock.mock.calls.some(([query]) =>
        querySql(query).includes("SET progress_ref = ?"),
      ),
    ).toBe(false);
  });

  it("treats invalid stored progress references as unavailable", async () => {
    const { getA2AContinuation } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [continuationRow({ id: args[0], progress_ref: "not-json" })],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const continuation = await getA2AContinuation("cont-invalid-progress");

    expect(continuation?.progressRef).toBeNull();
  });

  it("scrubs short-lived delivery context from terminal continuation rows", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { completeA2AContinuation, failA2AContinuation } = await loadStore();

    await completeA2AContinuation("cont-completed");
    await failA2AContinuation("cont-failed", "remote task failed");

    const terminalUpdates = executeMock.mock.calls
      .map(([query]) => query)
      .filter(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("UPDATE integration_a2a_continuations"),
      );
    expect(terminalUpdates).toHaveLength(2);
    for (const update of terminalUpdates) {
      expect(update.sql).toContain("incoming_payload = ?");
      expect(update.sql).toContain("a2a_auth_token = NULL");
      expect(update.sql).toContain("progress_ref = NULL");
    }
    expect(terminalUpdates[0].args).toEqual([
      "completed",
      expect.any(Number),
      expect.any(Number),
      "{}",
      expect.any(Number),
      "cont-completed",
    ]);
    expect(terminalUpdates[1].args).toEqual([
      "failed",
      expect.any(Number),
      "remote task failed",
      "{}",
      "cont-failed",
    ]);
  });

  it("atomically marks a processing continuation as delivering before platform send", async () => {
    const { claimA2AContinuationDelivery } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (sql.includes("UPDATE integration_a2a_continuations")) {
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [continuationRow({ id: args[0], status: "delivering" })],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const claimed = await claimA2AContinuationDelivery("cont-1");

    expect(claimed?.status).toBe("delivering");
    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = querySql(query);
      return (
        sql.includes("UPDATE integration_a2a_continuations") &&
        sql.includes("WHERE id = ? AND status = 'processing'")
      );
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE id = ? AND status = 'processing'"),
        args: ["delivering", expect.any(Number), "cont-1"],
      }),
    );
  });

  it("does not claim delivery once another processor has moved the continuation on", async () => {
    const { claimA2AContinuationDelivery } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("UPDATE integration_a2a_continuations")) {
          return { rows: [], rowsAffected: 0 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          throw new Error("delivery claim should not fetch after no-op update");
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    await expect(claimA2AContinuationDelivery("cont-1")).resolves.toBeNull();
  });

  it("does not claim delivering continuations before stale recovery makes them pending", async () => {
    const { claimA2AContinuation } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("UPDATE integration_a2a_continuations")) {
          return { rows: [], rowsAffected: 0 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          throw new Error("delivering claim should not fetch");
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const claimed = await claimA2AContinuation("cont-1");

    expect(claimed).toBeNull();
    const updateCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes(
        "SET status = ?, attempts = attempts + 1, updated_at = ?",
      ),
    );
    expect(updateCall).toBeDefined();
    expect(querySql(updateCall![0])).toContain("status = 'processing'");
    expect(querySql(updateCall![0])).not.toContain("delivering");
  });

  it("can reclaim processing continuations whose next check is stale", async () => {
    const { claimA2AContinuation } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes(
            "SET status = ?, attempts = attempts + 1, updated_at = ?",
          )
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [
              continuationRow({
                id: args[0],
                status: "processing",
                attempts: 3,
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const claimed = await claimA2AContinuation("cont-1");

    expect(claimed?.id).toBe("cont-1");
    const updateCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes(
        "SET status = ?, attempts = attempts + 1, updated_at = ?",
      ),
    );
    expect(querySql(updateCall![0])).toContain("next_check_at <= ?");
    expect(queryArgs(updateCall![0])).toHaveLength(5);
  });

  it("recovers stale delivering continuations as retryable pending during due sweeps", async () => {
    const { claimDueA2AContinuations } = await loadStore();
    mockEmptyExceptLiveProbe();

    await expect(claimDueA2AContinuations()).resolves.toEqual([]);

    const recoveryCall = executeMock.mock.calls.find(([query]) => {
      const sql = querySql(query);
      return (
        sql.includes("UPDATE integration_a2a_continuations") &&
        sql.includes("WHERE status = 'delivering'")
      );
    });
    expect(recoveryCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE status = 'delivering'"),
        args: [
          "pending",
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ],
      }),
    );
    expect(querySql(recoveryCall![0])).toContain("next_check_at = ?");
    expect(querySql(recoveryCall![0])).not.toContain("completed_at");
  });

  it("limits disabled-scope recovery to receipt-confirmed continuation rows", async () => {
    const { recoverDueA2AContinuationIds } = await loadStore();
    mockEmptyExceptLiveProbe();

    await expect(
      recoverDueA2AContinuationIds(5, ["task-mixed"], true),
    ).resolves.toEqual([]);

    const custodyQueries = executeMock.mock.calls
      .map(([query]) => querySql(query))
      .filter(
        (sql) =>
          sql.includes("integration_a2a_continuations") &&
          (sql.includes("SET status = ?") || sql.includes("SELECT id FROM")),
      );
    // Live probe + two lease resets + the due selection.
    expect(custodyQueries).toHaveLength(4);
    for (const sql of custodyQueries) {
      expect(sql).toContain("terminal_delivery_confirmed_at IS NOT NULL");
    }
  });

  it("lists due/stale scheduler recovery ids without claiming terminal rows", async () => {
    const { recoverDueA2AContinuationIds } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("SELECT id FROM integration_a2a_continuations")) {
          return {
            rows: [{ id: "cont-due" }, { id: "cont-stale-processing" }],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );

    await expect(recoverDueA2AContinuationIds(2)).resolves.toEqual([
      "cont-due",
      "cont-stale-processing",
    ]);

    expect(
      executeMock.mock.calls.some(([query]) =>
        querySql(query).includes("attempts = attempts + 1"),
      ),
    ).toBe(false);
    const selection = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("ORDER BY next_check_at ASC"),
    );
    expect(querySql(selection![0])).toContain("status = 'pending'");
    expect(querySql(selection![0])).not.toContain("completed");
    expect(queryArgs(selection![0])).toHaveLength(2);
  });

  it("costs one query and writes nothing when no continuation is live", async () => {
    // The 60s retry job calls this on every app. Both lease resets used to run
    // blind, so an app whose queue has been empty since boot still paid three
    // round trips a minute forever.
    const { recoverDueA2AContinuationIds } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(recoverDueA2AContinuationIds(5)).resolves.toEqual([]);

    const workQueries = executeMock.mock.calls
      .map(([query]) => querySql(query))
      .filter(
        (sql) =>
          sql.includes("integration_a2a_continuations") &&
          (sql.startsWith("UPDATE") || sql.includes("SELECT id FROM")),
      );
    expect(workQueries).toHaveLength(1);
    expect(workQueries[0]).toContain(
      "status IN ('pending', 'processing', 'delivering')",
    );
  });

  it("limits durable scheduler recovery updates to eligible task scopes", async () => {
    const { recoverDueA2AContinuationIds } = await loadStore();
    mockEmptyExceptLiveProbe();

    await recoverDueA2AContinuationIds(5, ["task-canary"]);

    const recoveryQueries = executeMock.mock.calls.slice(-3);
    for (const [query] of recoveryQueries) {
      expect(querySql(query)).toContain("integration_task_id IN (?)");
      expect(queryArgs(query)).toContain("task-canary");
    }
  });

  it("recovers processing continuations with stale next checks during due sweeps", async () => {
    const { claimDueA2AContinuations } = await loadStore();
    mockEmptyExceptLiveProbe();

    await expect(claimDueA2AContinuations()).resolves.toEqual([]);

    const recoveryCall = executeMock.mock.calls.find(([query]) => {
      const sql = querySql(query);
      return (
        sql.includes("UPDATE integration_a2a_continuations") &&
        sql.includes("WHERE status = 'processing'")
      );
    });
    expect(recoveryCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("next_check_at <= ?"),
        args: [
          "pending",
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ],
      }),
    );
    expect(querySql(recoveryCall![0])).toContain("updated_at <= ?");
    expect(querySql(recoveryCall![0])).toContain("next_check_at <= ?");
  });

  it("returns each due continuation once from a retry sweep", async () => {
    const { claimDueA2AContinuations } = await loadStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (sql.includes("SELECT id FROM integration_a2a_continuations")) {
          return { rows: [{ id: "cont-1" }], rowsAffected: 0 };
        }
        if (
          sql.includes(
            "SET status = ?, attempts = attempts + 1, updated_at = ?",
          )
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes(
            "SELECT * FROM integration_a2a_continuations WHERE id = ?",
          )
        ) {
          return {
            rows: [
              continuationRow({
                id: args[0],
                status: "processing",
                attempts: 2,
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const claimed = await claimDueA2AContinuations();

    expect(claimed.map((continuation) => continuation.id)).toEqual(["cont-1"]);
  });
});
