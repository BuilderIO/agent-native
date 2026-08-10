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

async function loadPushStore() {
  vi.resetModules();
  return import("./remote-push-store.js");
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
                platform: insertArgs[4],
                app_version: insertArgs[5],
                host_name: insertArgs[6],
                metadata_json: insertArgs[7],
                device_token_hash: insertArgs[8],
                last_seen_at: insertArgs[9],
                status: insertArgs[10],
                revoked_at: insertArgs[11],
                created_at: insertArgs[12],
                updated_at: insertArgs[13],
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
    expect(insertArgs).toEqual([
      expect.stringMatching(/^remote-device-\d+-[a-f0-9]{16}$/),
      "alice@example.com",
      "org-1",
      "Studio Mac",
      null,
      null,
      null,
      null,
      device.deviceTokenHash,
      expect.any(Number),
      "active",
      null,
      expect.any(Number),
      expect.any(Number),
    ]);
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

  it("revokes remote devices with owner and org scoping", async () => {
    const { revokeRemoteDeviceForOwner } = await loadDevicesStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes("SELECT * FROM integration_remote_devices") &&
          sql.includes("WHERE id = ?")
        ) {
          return {
            rows: [
              {
                id: args[0],
                owner_email: args[1],
                org_id: args[2],
                label: "Studio Mac",
                platform: "darwin",
                app_version: "1.2.3",
                host_name: "studio",
                metadata_json: JSON.stringify({ arch: "arm64" }),
                device_token_hash: "hashed",
                last_seen_at: 1,
                status: "inactive",
                revoked_at: 2,
                created_at: 1,
                updated_at: 2,
              },
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );

    const device = await revokeRemoteDeviceForOwner({
      id: "device-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });

    expect(device?.status).toBe("inactive");
    expect(device?.metadata).toEqual({ arch: "arm64" });
    const updateCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("SET status = 'inactive'"),
    );
    expect(querySql(updateCall![0])).toContain("owner_email = ?");
    expect(querySql(updateCall![0])).toContain(
      "((org_id IS NULL AND CAST(? AS TEXT) IS NULL) OR org_id = ?)",
    );
    expect(queryArgs(updateCall![0]).slice(2)).toEqual([
      "device-1",
      "alice@example.com",
      "org-1",
      "org-1",
    ]);
  });

  it("upserts push registrations while returning only public details", async () => {
    const { upsertRemotePushRegistration, toPublicRemotePushRegistration } =
      await loadPushStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        const args = queryArgs(query);
        if (
          sql.includes("SELECT * FROM integration_remote_push_registrations") &&
          sql.includes("WHERE token_hash = ?")
        ) {
          if (
            executeMock.mock.calls.some(([q]) =>
              querySql(q).includes(
                "INSERT INTO integration_remote_push_registrations",
              ),
            )
          ) {
            return {
              rows: [
                {
                  id: "push-1",
                  owner_email: "alice@example.com",
                  org_id: "org-1",
                  provider: "apns",
                  platform: "ios",
                  client_device_id: "phone-1",
                  label: "Alice iPhone",
                  token: "raw-token",
                  token_hash: args[0],
                  status: "active",
                  last_seen_at: 1,
                  created_at: 1,
                  updated_at: 1,
                },
              ],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );

    const registration = await upsertRemotePushRegistration({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      provider: "apns",
      platform: "ios",
      clientDeviceId: "phone-1",
      label: "Alice iPhone",
      token: "raw-token",
    });

    expect(registration.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const publicRegistration = toPublicRemotePushRegistration(registration);
    expect(publicRegistration).not.toHaveProperty("token");
    expect(publicRegistration).not.toHaveProperty("tokenHash");
    const insertCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes(
        "INSERT INTO integration_remote_push_registrations",
      ),
    );
    expect(queryArgs(insertCall![0])).toEqual(
      expect.arrayContaining([
        "alice@example.com",
        "org-1",
        "apns",
        "ios",
        "phone-1",
        "Alice iPhone",
        "raw-token",
      ]),
    );
  });

  it("queues push notification outbox rows for active owner registrations", async () => {
    const { queueRemotePushNotifications } = await loadPushStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (
          sql.includes("SELECT * FROM integration_remote_push_registrations") &&
          sql.includes("status = 'active'")
        ) {
          return {
            rows: [
              {
                id: "push-1",
                owner_email: "alice@example.com",
                org_id: "org-1",
                provider: "apns",
                platform: "ios",
                client_device_id: "phone-1",
                label: "Alice iPhone",
                token: "raw-token",
                token_hash: "hashed",
                status: "active",
                last_seen_at: 1,
                created_at: 1,
                updated_at: 1,
              },
              {
                id: "push-2",
                owner_email: "alice@example.com",
                org_id: "org-1",
                provider: "expo",
                platform: "ios",
                client_device_id: "phone-2",
                label: "Alice iPad",
                token: "ExpoPushToken[example_token]",
                token_hash: "hashed-2",
                status: "active",
                last_seen_at: 1,
                created_at: 1,
                updated_at: 1,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (sql.includes("INSERT INTO integration_remote_push_notifications")) {
          return { rows: [], rowsAffected: 2 };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );

    const result = await queueRemotePushNotifications({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      payload: { title: "Remote run completed", commandId: "cmd-1" },
    });

    expect(result.queued).toBe(2);
    const insertCalls = executeMock.mock.calls.filter(([query]) =>
      querySql(query).includes(
        "INSERT INTO integration_remote_push_notifications",
      ),
    );
    expect(insertCalls).toHaveLength(1);
    const insertSql = querySql(insertCalls[0]![0]);
    const insertArgs = queryArgs(insertCalls[0]![0]);
    expect(insertSql).toContain("'pending', 0");
    expect(insertArgs).toHaveLength(16);
    expect(insertArgs).toEqual(
      expect.arrayContaining([
        "alice@example.com",
        "org-1",
        "push-1",
        "push-2",
        JSON.stringify({ title: "Remote run completed", commandId: "cmd-1" }),
      ]),
    );
  });

  it("claims a due Expo outbox row without returning another worker's claim", async () => {
    const { claimNextRemotePushDelivery } = await loadPushStore();
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (sql.includes("INNER JOIN integration_remote_push_registrations")) {
          return {
            rows: [
              {
                id: "notification-1",
                registration_id: "push-1",
                payload_json: JSON.stringify({ title: "Ready" }),
                status: "pending",
                attempts: 0,
                provider_ticket_id: null,
                updated_at: 1,
                provider: "expo",
                token: "ExpoPushToken[example_token]",
              },
            ],
            rowsAffected: 0,
          };
        }
        if (
          sql.includes("UPDATE integration_remote_push_notifications") &&
          sql.includes("attempts = attempts + 1")
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );

    const claimed = await claimNextRemotePushDelivery({ now: 10_000 });

    expect(claimed).toEqual({
      id: "notification-1",
      registrationId: "push-1",
      provider: "expo",
      token: "ExpoPushToken[example_token]",
      payload: { title: "Ready" },
      phase: "send",
      providerTicketId: null,
      attempts: 1,
    });
    const claimCall = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("attempts = attempts + 1"),
    );
    expect(queryArgs(claimCall![0])).toEqual([
      "sending",
      10_000,
      "notification-1",
      "pending",
      1,
    ]);
  });

  it("clears the old receipt ticket before resending a failed provider handoff", async () => {
    const { retryRemotePushDelivery } = await loadPushStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      retryRemotePushDelivery({
        id: "notification-1",
        phase: "receipt",
        retryAt: 20_000,
        errorCode: "MessageRateExceeded",
        resend: true,
      }),
    ).resolves.toBe(true);

    const retryCall = executeMock.mock.calls.find(([query]) => {
      const sql = querySql(query);
      return (
        sql.includes("UPDATE integration_remote_push_notifications") &&
        sql.includes("provider_ticket_id = NULL")
      );
    });
    expect(retryCall).toBeTruthy();
    expect(queryArgs(retryCall![0])).toEqual([
      "pending",
      20_000,
      "MessageRateExceeded",
      expect.any(Number),
      "notification-1",
      "checking",
    ]);
  });

  it("fails remaining outbox rows when a push registration becomes inactive", async () => {
    const { deactivateRemotePushRegistration } = await loadPushStore();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      deactivateRemotePushRegistration("registration-1"),
    ).resolves.toBe(true);

    const cleanupCall = executeMock.mock.calls.find(([query]) => {
      const sql = querySql(query);
      return (
        sql.includes("UPDATE integration_remote_push_notifications") &&
        sql.includes("registration_inactive")
      );
    });
    expect(cleanupCall).toBeTruthy();
    expect(queryArgs(cleanupCall![0])).toEqual([
      expect.any(Number),
      "registration-1",
    ]);
  });
});
