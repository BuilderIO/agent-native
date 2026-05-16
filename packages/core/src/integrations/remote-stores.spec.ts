import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

async function loadDevicesStore() {
  vi.resetModules();
  return import("./remote-devices-store.js");
}

async function loadCommandsStore() {
  vi.resetModules();
  return import("./remote-commands-store.js");
}

async function loadRunEventsStore() {
  vi.resetModules();
  return import("./remote-run-events-store.js");
}

function querySql(query: string | { sql: string }): string {
  return typeof query === "string" ? query : query.sql;
}

function queryArgs(query: string | { args?: unknown[] }): unknown[] {
  return typeof query === "string" ? [] : (query.args ?? []);
}

describe("remote relay stores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores only the remote device token hash on registration", async () => {
    const { createRemoteDevice } = await loadDevicesStore();
    let insertArgs: unknown[] = [];
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (sql.includes("INSERT INTO integration_remote_devices")) {
          insertArgs = args;
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes("SELECT * FROM integration_remote_devices") &&
          sql.includes("WHERE id = ?")
        ) {
          return {
            rows: [
              {
                id: args[0],
                owner_email: insertArgs[1],
                org_id: insertArgs[2],
                label: insertArgs[3],
                device_token_hash: insertArgs[4],
                last_seen_at: insertArgs[5],
                status: insertArgs[6],
                created_at: insertArgs[7],
                updated_at: insertArgs[8],
              },
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const { device, token } = await createRemoteDevice({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      label: "Studio Mac",
    });

    expect(token).toMatch(/^anr_[a-f0-9]{64}$/);
    expect(device.deviceTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(device.deviceTokenHash).not.toBe(token);
    expect(insertArgs).toEqual(
      expect.arrayContaining([
        "alice@example.com",
        "org-1",
        "Studio Mac",
        device.deviceTokenHash,
      ]),
    );
  });

  it("claims only pending commands for the polling device", async () => {
    const { claimNextRemoteCommand } = await loadCommandsStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes("SELECT id FROM integration_remote_commands") &&
          sql.includes("status = 'pending'")
        ) {
          return { rows: [{ id: "cmd-1" }], rowsAffected: 0 };
        }
        if (sql.includes("UPDATE integration_remote_commands")) {
          return { rows: [], rowsAffected: 1 };
        }
        if (
          sql.includes("SELECT * FROM integration_remote_commands") &&
          sql.includes("WHERE id = ?")
        ) {
          return {
            rows: [
              {
                id: args[0],
                device_id: "device-1",
                owner_email: "alice@example.com",
                org_id: null,
                kind: "create-run",
                params_json: JSON.stringify({ prompt: "ship it" }),
                status: "claimed",
                result_json: null,
                platform: "desktop",
                external_thread_id: null,
                attempts: 1,
                next_check_at: 1,
                claimed_at: 2,
                completed_at: null,
                error_message: null,
                created_at: 1,
                updated_at: 2,
              },
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const command = await claimNextRemoteCommand("device-1");

    expect(command?.id).toBe("cmd-1");
    const updateCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("SET status = ?"),
    );
    expect(updateCall?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining(
          "WHERE id = ? AND device_id = ? AND status = 'pending'",
        ),
      }),
    );
    expect(queryArgs(updateCall![0])).toEqual([
      "claimed",
      expect.any(Number),
      expect.any(Number),
      "cmd-1",
      "device-1",
    ]);
  });

  it("inserts remote run events idempotently by device, run, and sequence", async () => {
    const { insertRemoteRunEvents } = await loadRunEventsStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("ON CONFLICT(device_id, remote_run_id, seq)")) {
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );

    const result = await insertRemoteRunEvents({
      deviceId: "device-1",
      remoteRunId: "run-1",
      events: [{ seq: 1, event: { type: "text", text: "hello" } }],
    });

    expect(result.inserted).toBe(1);
    const insertCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("INSERT INTO integration_remote_run_events"),
    );
    expect(querySql(insertCall![0])).toContain(
      "ON CONFLICT(device_id, remote_run_id, seq) DO NOTHING",
    );
    expect(queryArgs(insertCall![0]).slice(0, 3)).toEqual([
      "device-1",
      "run-1",
      1,
    ]);
  });
});
