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
    owner_email: "alice+qa@agent-native.test",
    org_id: null,
    agent_name: "Slides",
    agent_url: "https://slides.agent-native.test",
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

  it("does not reclaim stale delivering continuations for retry", async () => {
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
          throw new Error("stale delivering claim should not fetch");
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

  it("recovers stale delivering continuations as completed during due sweeps", async () => {
    const { claimDueA2AContinuations } = await loadStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(claimDueA2AContinuations()).resolves.toEqual([]);

    const recoveryCall = executeMock.mock.calls.find(([query]) => {
      const sql = querySql(query);
      return (
        sql.includes("UPDATE integration_a2a_continuations") &&
        sql.includes("completed_at = COALESCE")
      );
    });
    expect(recoveryCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE status = 'delivering'"),
        args: [
          "completed",
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ],
      }),
    );
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
