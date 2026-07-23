import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const isPostgresMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  isPostgres: isPostgresMock,
  intType: () => "INTEGER",
}));

async function loadStore() {
  vi.resetModules();
  return import("./pending-tasks-store.js");
}

describe("integration pending task store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPostgresMock.mockReturnValue(false);
  });

  it("claims pending tasks and increments attempts", async () => {
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT id, platform")) {
        return {
          rows: [
            {
              id: "task-1",
              platform: "slack",
              external_thread_id: "thread-1",
              payload: "{}",
              owner_email: "alice+qa@agent-native.test",
              org_id: null,
              status: "processing",
              attempts: 1,
              error_message: null,
              created_at: 1,
              updated_at: 2,
              completed_at: null,
            },
          ],
        };
      }
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [] };
    });

    const task = await claimPendingTask("task-1");

    expect(task?.id).toBe("task-1");
    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("UPDATE integration_pending_tasks");
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE id = ? AND status = 'pending'"),
      }),
    );
    expect((updateCall?.[0] as { sql: string }).sql).toContain(
      "earlier.status = 'pending'",
    );
    expect((updateCall?.[0] as { sql: string }).sql).toContain(
      "earlier.created_at < integration_pending_tasks.created_at",
    );
  });

  it("does not claim terminal failed tasks", async () => {
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (sql.includes("SELECT id, platform")) {
        return {
          rows: [
            {
              id: "task-failed",
              platform: "slack",
              external_thread_id: "thread-1",
              payload: "{}",
              owner_email: "alice+qa@agent-native.test",
              org_id: null,
              status: "failed",
              attempts: 3,
              error_message: "exceeded retries",
              created_at: 1,
              updated_at: 2,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(claimPendingTask("task-failed")).resolves.toBeNull();
  });

  it("dispatches same-millisecond thread tasks by stable id order", async () => {
    executeMock.mockResolvedValue({ rows: [{ id: "task-a" }] });
    const { getNextPendingTaskIdForThread } = await loadStore();

    await expect(
      getNextPendingTaskIdForThread("slack", "thread-1"),
    ).resolves.toBe("task-a");

    const select = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("SELECT id FROM integration_pending_tasks"),
      );
    expect(select?.sql).toContain("ORDER BY created_at ASC, id ASC");
    expect(select?.args).toEqual(["slack", "thread-1"]);
  });

  it("returns null when a SQLite claim loses the conditional update race", async () => {
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (sql.includes("SELECT id, platform")) {
        return {
          rows: [
            {
              id: "task-raced",
              platform: "slack",
              external_thread_id: "thread-1",
              payload: "{}",
              owner_email: "alice+qa@agent-native.test",
              org_id: null,
              status: "processing",
              attempts: 1,
              error_message: null,
              created_at: 1,
              updated_at: 2,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(claimPendingTask("task-raced")).resolves.toBeNull();

    const selectCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("SELECT id, platform");
    });
    expect(selectCall).toBeUndefined();
  });

  it("does not claim failed tasks on the Postgres RETURNING path", async () => {
    isPostgresMock.mockReturnValue(true);
    const { claimPendingTask } = await loadStore();
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("UPDATE integration_pending_tasks")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(claimPendingTask("task-failed")).resolves.toBeNull();

    const updateCall = executeMock.mock.calls.find(([query]) => {
      const sql = typeof query === "string" ? query : query.sql;
      return sql.includes("UPDATE integration_pending_tasks");
    });
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE id = ? AND status = 'pending'"),
      }),
    );
  });

  it("only treats duplicate-key errors as duplicate webhook deliveries", async () => {
    const { isDuplicateEventError } = await loadStore();

    expect(
      isDuplicateEventError(
        new Error(
          "UNIQUE constraint failed: integration_pending_tasks.platform, integration_pending_tasks.external_event_key",
        ),
      ),
    ).toBe(true);
    expect(isDuplicateEventError({ code: "23505" })).toBe(true);
    expect(isDuplicateEventError(new Error("NOT NULL constraint failed"))).toBe(
      false,
    );
    expect(isDuplicateEventError(new Error("CHECK constraint failed"))).toBe(
      false,
    );
  });

  it("resolves valid Slack provenance from the caller's stored task", async () => {
    executeMock.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SELECT platform, payload, owner_email, org_id")) {
        return {
          rows: [
            {
              platform: "slack",
              payload: JSON.stringify({
                incoming: {
                  platform: "slack",
                  sourceUrl:
                    "https://example-workspace.slack.com/archives/C123/p123456",
                },
              }),
              owner_email: "member@example.com",
              org_id: "org-a",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { resolveIntegrationSourceContext } = await loadStore();

    await expect(
      resolveIntegrationSourceContext("task-1", "member@example.com", "org-a"),
    ).resolves.toEqual({
      platform: "slack",
      sourceUrl: "https://example-workspace.slack.com/archives/C123/p123456",
    });
    const select = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("SELECT platform, payload, owner_email, org_id"),
      );
    expect(select?.args).toEqual([
      "task-1",
      "member@example.com",
      "org-a",
      "org-a",
    ]);
    expect(select?.sql).toContain("owner_email = ?");
    expect(select?.sql).toContain("org_id IS NULL AND CAST(? AS TEXT) IS NULL");
    expect(select?.sql).toContain("platform = 'slack'");
    expect(select?.sql).not.toContain("SELECT *");
  });

  it("returns null for an unknown pending task", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const { resolveIntegrationSourceContext } = await loadStore();

    await expect(
      resolveIntegrationSourceContext(
        "missing-task",
        "member@example.com",
        "org-a",
      ),
    ).resolves.toBeNull();
  });

  it.each([
    {
      name: "owner mismatch",
      task: {
        platform: "slack",
        payload: JSON.stringify({
          incoming: {
            platform: "slack",
            sourceUrl: "https://example.slack.com/archives/C1/p1",
          },
        }),
        ownerEmail: "other@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "organization mismatch",
      task: {
        platform: "slack",
        payload: JSON.stringify({
          incoming: {
            platform: "slack",
            sourceUrl: "https://example.slack.com/archives/C1/p1",
          },
        }),
        ownerEmail: "member@example.com",
        orgId: "org-b",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "non-Slack task",
      task: {
        platform: "telegram",
        payload: JSON.stringify({
          incoming: {
            platform: "telegram",
            sourceUrl: "https://example.slack.com/archives/C1/p1",
          },
        }),
        ownerEmail: "member@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "malformed payload",
      task: {
        platform: "slack",
        payload: "not-json",
        ownerEmail: "member@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "padded URL",
      task: {
        platform: "slack",
        payload: JSON.stringify({
          incoming: {
            platform: "slack",
            sourceUrl: " https://example.slack.com/archives/C1/p1 ",
          },
        }),
        ownerEmail: "member@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "credential-bearing URL",
      task: {
        platform: "slack",
        payload: JSON.stringify({
          incoming: {
            platform: "slack",
            sourceUrl: "https://user@example.slack.com/archives/C1/p1",
          },
        }),
        ownerEmail: "member@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "malformed URL",
      task: {
        platform: "slack",
        payload: JSON.stringify({
          incoming: { platform: "slack", sourceUrl: "not-a-url" },
        }),
        ownerEmail: "member@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
    {
      name: "non-Slack URL",
      task: {
        platform: "slack",
        payload: JSON.stringify({
          incoming: {
            platform: "slack",
            sourceUrl: "https://example.com/archives/C1/p1",
          },
        }),
        ownerEmail: "member@example.com",
        orgId: "org-a",
      },
      ownerEmail: "member@example.com",
      orgId: "org-a",
    },
  ])("fails closed for $name", async ({ task, ownerEmail, orgId }) => {
    const { sourceContextFromPendingTask } = await loadStore();

    expect(sourceContextFromPendingTask(task, ownerEmail, orgId)).toBeNull();
  });

  it("erases transient provider credentials from terminal task payloads", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { markTaskCompleted, markTaskFailed } = await loadStore();

    await markTaskCompleted("discord-task-completed");
    await markTaskFailed("discord-task-failed", "interaction expired");

    const terminalUpdates = executeMock.mock.calls
      .map(([query]) => query)
      .filter(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("UPDATE integration_pending_tasks"),
      );
    expect(terminalUpdates).toHaveLength(2);
    expect(terminalUpdates[0].sql).toContain("payload = ?");
    expect(terminalUpdates[0].args).toEqual([
      "completed",
      expect.any(Number),
      expect.any(Number),
      "{}",
      "discord-task-completed",
    ]);
    expect(terminalUpdates[1].args).toEqual([
      "failed",
      expect.any(Number),
      "interaction expired",
      "{}",
      "discord-task-failed",
    ]);
    expect(terminalUpdates[1].sql).toContain("external_event_key = NULL");
  });

  it("keeps the inbound payload when rescheduling a transient failure", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { markTaskRetryable } = await loadStore();

    await markTaskRetryable("discord-task-retry", "temporary provider error");

    const retryUpdate = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("UPDATE integration_pending_tasks"),
      );
    expect(retryUpdate?.sql).toContain("status = ?");
    expect(retryUpdate?.sql).toContain("status = 'processing'");
    expect(retryUpdate?.sql).not.toContain("payload");
    expect(retryUpdate?.args).toEqual([
      "pending",
      expect.any(Number),
      "temporary provider error",
      "discord-task-retry",
    ]);
  });

  it("atomically replaces a claimed task with a delivery-only payload", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { stageTaskDeliveryPayload } = await loadStore();
    const payload = JSON.stringify({
      kind: "response-delivery",
      message: { text: "Done", platformContext: {} },
    });

    await stageTaskDeliveryPayload("slack-task", payload);

    const update = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("SET payload = ?, updated_at = ?"),
      );
    expect(update?.sql).toContain("WHERE id = ? AND status = 'processing'");
    expect(update?.args).toEqual([payload, expect.any(Number), "slack-task"]);
  });

  it("fails closed when a delivery payload loses the processing-task race", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
    const { stageTaskDeliveryPayload } = await loadStore();

    await expect(
      stageTaskDeliveryPayload("raced-task", '{"kind":"response-delivery"}'),
    ).rejects.toThrow("no longer claimable");
  });

  it("atomically requeues the enriched delivery payload", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { markTaskDeliveryRetryable } = await loadStore();
    const payload = JSON.stringify({
      kind: "response-delivery",
      deliveryReceipt: { status: "delivered" },
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    });

    await markTaskDeliveryRetryable(
      "slack-task",
      payload,
      "history checkpoint failed",
    );

    const update = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" &&
          query.sql.includes("SET status = ?, payload = ?"),
      );
    expect(update?.sql).toContain("WHERE id = ? AND status = 'processing'");
    expect(update?.args).toEqual([
      "pending",
      payload,
      expect.any(Number),
      "history checkpoint failed",
      "slack-task",
    ]);
  });

  it("fails a broken delivery transition without overwriting another state", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { failTaskDeliveryTransition } = await loadStore();

    await failTaskDeliveryTransition("slack-task", "atomic transition failed");

    const update = executeMock.mock.calls
      .map(([query]) => query)
      .find(
        (query): query is { sql: string; args: unknown[] } =>
          typeof query !== "string" && query.sql.includes("payload = ?"),
      );
    expect(update?.sql).toContain("WHERE id = ? AND status = 'processing'");
    expect(update?.sql).not.toContain("external_event_key = NULL");
    expect(update?.args).toEqual([
      "failed",
      expect.any(Number),
      "atomic transition failed",
      "{}",
      "slack-task",
    ]);
  });

  it("fails loud when the terminal delivery transition loses its race", async () => {
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
    const { failTaskDeliveryTransition } = await loadStore();

    await expect(
      failTaskDeliveryTransition("raced-task", "atomic transition failed"),
    ).rejects.toThrow("lost its race");
  });
});
