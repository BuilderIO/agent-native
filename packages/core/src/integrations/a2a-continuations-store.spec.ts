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
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

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
        ],
      }),
    );
    expect(querySql(recoveryCall![0])).toContain("next_check_at = ?");
    expect(querySql(recoveryCall![0])).not.toContain("completed_at");
  });

  it("recovers processing continuations with stale next checks during due sweeps", async () => {
    const { claimDueA2AContinuations } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

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
