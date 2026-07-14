import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComputerCommandEnvelope } from "./remote-types.js";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

async function makeEnvelope(
  overrides: Partial<ComputerCommandEnvelope> = {},
): Promise<ComputerCommandEnvelope> {
  const now = 10_000;
  const envelope: ComputerCommandEnvelope = {
    version: 1,
    taskId: "task-1",
    runId: "run-1",
    sequence: 1,
    idempotencyKey: "operation-1",
    operationClass: "browser.control",
    action: { type: "click", target: { role: "button", name: "Save" } },
    approval: { id: "approval-1", scope: "once", actionHash: "0".repeat(64) },
    issuedAt: now,
    leaseExpiresAt: now + 60_000,
    ...overrides,
  };
  const { computeComputerActionHash } =
    await import("./computer-supervision.js");
  envelope.approval = {
    ...envelope.approval,
    actionHash: await computeComputerActionHash(envelope),
  };
  return envelope;
}

describe("computer supervision policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds the action hash to task, run, sequence, class, and action", async () => {
    const { assertValidComputerCommandEnvelope } =
      await import("./computer-supervision.js");
    const envelope = await makeEnvelope();

    await expect(
      assertValidComputerCommandEnvelope(envelope, { now: 20_000 }),
    ).resolves.toMatchObject({ taskId: "task-1", sequence: 1 });

    await expect(
      assertValidComputerCommandEnvelope(
        { ...envelope, sequence: 2 },
        { now: 20_000 },
      ),
    ).rejects.toMatchObject({ code: "action-hash-mismatch" });
  });

  it("fails closed for expired leases and embedded image data", async () => {
    const { assertValidComputerCommandEnvelope } =
      await import("./computer-supervision.js");
    const expired = await makeEnvelope({ leaseExpiresAt: 15_000 });
    await expect(
      assertValidComputerCommandEnvelope(expired, { now: 20_000 }),
    ).rejects.toMatchObject({ code: "expired-lease" });

    const binary = await makeEnvelope();
    binary.action = {
      type: "inspect",
      input: { screenshot: "data:image/png;base64,abc" },
    };
    await expect(
      assertValidComputerCommandEnvelope(binary, { now: 20_000 }),
    ).rejects.toMatchObject({ code: "invalid-envelope" });
  });

  it("rejects approval owner mismatches and consumed one-shot replays", async () => {
    const { authorizeComputerOperation } =
      await import("./computer-supervision-store.js");
    const envelope = await makeEnvelope();
    executeMock.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });

    await expect(
      authorizeComputerOperation({
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        deviceId: "device-1",
        envelope,
        now: 20_000,
      }),
    ).rejects.toMatchObject({ code: "approval-mismatch" });

    executeMock.mockResolvedValueOnce({
      rows: [
        {
          ...approvalRow(envelope, "approved"),
          action_hash: "f".repeat(64),
        },
      ],
      rowsAffected: 0,
    });
    await expect(
      authorizeComputerOperation({
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        deviceId: "device-1",
        envelope,
        now: 20_000,
      }),
    ).rejects.toMatchObject({ code: "approval-mismatch" });

    executeMock.mockResolvedValueOnce({
      rows: [approvalRow(envelope, "consumed")],
      rowsAffected: 0,
    });
    await expect(
      authorizeComputerOperation({
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        deviceId: "device-1",
        envelope,
        now: 20_000,
      }),
    ).rejects.toMatchObject({ code: "replay" });

    const scopedSelect = executeMock.mock.calls.at(-1)?.[0] as { sql: string };
    expect(scopedSelect.sql).toContain("owner_email = ?");
    expect(scopedSelect.sql).toContain("org_id IS NULL");
  });

  it("batches run events and stores live view handles without frame data", async () => {
    vi.resetModules();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 2 });
    const { insertRemoteLiveViewEvents } =
      await import("./remote-run-events-store.js");
    const result = await insertRemoteLiveViewEvents({
      deviceId: "device-1",
      remoteRunId: "run-1",
      events: [
        {
          seq: 1,
          event: {
            type: "computer.live-view",
            frameHandle: "frame_01_example",
            capturedAt: 20_000,
          },
        },
        {
          seq: 2,
          event: {
            type: "computer.live-view",
            frameHandle: "frame_02_example",
            capturedAt: 20_001,
          },
        },
      ],
    });
    expect(result.inserted).toBe(2);
    const insertCalls = executeMock.mock.calls.filter(([query]) =>
      querySql(query).includes("INSERT INTO integration_remote_run_events"),
    );
    expect(insertCalls).toHaveLength(1);
    expect(querySql(insertCalls[0]![0])).toContain(
      "VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    );

    await expect(
      insertRemoteLiveViewEvents({
        deviceId: "device-1",
        remoteRunId: "run-1",
        events: [
          {
            seq: 3,
            event: {
              type: "computer.live-view",
              frameHandle: "data:image/png;base64,abc",
              capturedAt: 20_002,
            },
          },
        ],
      }),
    ).rejects.toThrow("ephemeral handles");
  });

  it("rejects binary and oversized payloads for arbitrary run event types", async () => {
    vi.resetModules();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { insertRemoteRunEvents } =
      await import("./remote-run-events-store.js");

    await expect(
      insertRemoteRunEvents({
        deviceId: "device-1",
        remoteRunId: "run-1",
        events: [
          {
            seq: 1,
            event: {
              type: "custom.progress",
              attachment: "data:image/png;base64,example",
            },
          },
        ],
      }),
    ).rejects.toThrow("screenshots, images, base64, or data URLs");
    expect(
      executeMock.mock.calls.some(([query]) =>
        querySql(query).includes("INSERT INTO integration_remote_run_events"),
      ),
    ).toBe(false);

    await expect(
      insertRemoteRunEvents({
        deviceId: "device-1",
        remoteRunId: "run-1",
        events: [
          {
            seq: 2,
            event: {
              type: "custom.progress",
              message: "word ".repeat(60_000),
            },
          },
        ],
      }),
    ).rejects.toThrow("exceeds 256000 JSON bytes");
  });

  it("rejects binary and oversized remote command results before update", async () => {
    vi.resetModules();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    const { updateRemoteCommandResult } =
      await import("./remote-commands-store.js");

    await expect(
      updateRemoteCommandResult({
        deviceId: "device-1",
        commandId: "command-1",
        status: "completed",
        result: {
          type: "custom.result",
          payload: "data:image/png;base64,example",
        },
      }),
    ).rejects.toThrow("screenshots, images, base64, or data URLs");
    expect(
      executeMock.mock.calls.some(([query]) =>
        querySql(query).includes("SET status = ?"),
      ),
    ).toBe(false);

    await expect(
      updateRemoteCommandResult({
        deviceId: "device-1",
        commandId: "command-1",
        status: "completed",
        result: { message: "word ".repeat(60_000) },
      }),
    ).rejects.toThrow("exceeds 256000 JSON bytes");
  });

  it("fails an expired queued command instead of returning it to a device", async () => {
    vi.resetModules();
    const envelope = await makeEnvelope({ leaseExpiresAt: 15_000 });
    executeMock.mockImplementation(
      async (query: string | { sql: string; args?: unknown[] }) => {
        const sql = querySql(query);
        if (
          sql.includes("SELECT * FROM integration_remote_commands") &&
          sql.includes("kind = 'computer-operation'")
        ) {
          return {
            rows: [computerCommandRow(envelope)],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );
    const { claimNextComputerCommand } =
      await import("./remote-commands-store.js");
    await expect(
      claimNextComputerCommand({
        deviceId: "device-1",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        now: 20_000,
      }),
    ).resolves.toBeNull();

    const failureUpdate = executeMock.mock.calls.find(([query]) =>
      querySql(query).includes("SET status = 'failed'"),
    )?.[0] as { sql: string };
    expect(failureUpdate.sql).toContain("owner_email = ?");
    expect(failureUpdate.sql).toContain("org_id IS NULL");
  });

  it("advertises browser and desktop control capabilities explicitly", async () => {
    const { getRemoteComputerCapabilities } =
      await import("./remote-devices-store.js");
    expect(
      getRemoteComputerCapabilities({
        metadata: {
          computerCapabilities: {
            browser: {
              observe: true,
              control: false,
              provider: "chrome-extension",
            },
            desktop: {
              observe: true,
              control: true,
              accessibility: true,
              screenCapture: true,
              provider: "macos-helper",
            },
          },
        },
      }),
    ).toEqual({
      browser: {
        observe: true,
        control: false,
        provider: "chrome-extension",
        version: null,
      },
      desktop: {
        observe: true,
        control: true,
        accessibility: true,
        screenCapture: true,
        provider: "macos-helper",
        version: null,
      },
    });
  });
});

function approvalRow(
  envelope: ComputerCommandEnvelope,
  status: "approved" | "consumed",
) {
  return {
    id: "approval-1",
    owner_email: "alice@example.com",
    org_id: "org-1",
    device_id: "device-1",
    task_id: envelope.taskId,
    run_id: envelope.runId,
    operation_class: envelope.operationClass,
    approval_scope: envelope.approval.scope,
    action_hash: envelope.approval.actionHash,
    status,
    decision_result_json: null,
    decided_by: "alice@example.com",
    decided_at: 15_000,
    expires_at: envelope.leaseExpiresAt,
    consumed_at: status === "consumed" ? 16_000 : null,
    created_at: 10_000,
    updated_at: 16_000,
  };
}

function computerCommandRow(envelope: ComputerCommandEnvelope) {
  return {
    id: "command-1",
    device_id: "device-1",
    owner_email: "alice@example.com",
    org_id: "org-1",
    kind: "computer-operation",
    params_json: JSON.stringify({ envelope }),
    status: "pending",
    result_json: null,
    platform: "desktop",
    external_thread_id: null,
    computer_task_id: envelope.taskId,
    computer_run_id: envelope.runId,
    computer_sequence: envelope.sequence,
    idempotency_key: envelope.idempotencyKey,
    operation_class: envelope.operationClass,
    approval_scope: envelope.approval.scope,
    action_hash: envelope.approval.actionHash,
    lease_expires_at: envelope.leaseExpiresAt,
    attempts: 0,
    next_check_at: 10_000,
    claimed_at: null,
    completed_at: null,
    error_message: null,
    created_at: 10_000,
    updated_at: 10_000,
  };
}

function querySql(query: string | { sql: string }): string {
  return typeof query === "string" ? query : query.sql;
}
