import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbExec, DbExecStatement } from "../db/client.js";

const executeMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock, transaction: transactionMock }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(),
  ensureTableExists: vi.fn(),
  ensureIndexExists: vi.fn(),
}));

const emitMock = vi.hoisted(() => vi.fn());
const sendAutomationFailureNotificationMock = vi.hoisted(() => vi.fn());
vi.mock("../event-bus/index.js", () => ({
  emit: emitMock,
  registerEvent: vi.fn(),
}));
vi.mock("../server/automation-failure-notifications.js", () => ({
  createAutomationFailureUnsubscribeToken: vi.fn(() => "unsubscribe-token"),
  sendAutomationFailureNotification: sendAutomationFailureNotificationMock,
}));
vi.mock("../secrets/crypto.js", () => ({
  decryptSecretValue: (value: string) => value.replace(/^sealed:/, ""),
  encryptSecretValue: (value: string) => `sealed:${value}`,
}));

import {
  finishAutomationRun,
  listLatestAutomationRuns,
  listAutomationRuns,
  processPendingAutomationFailureAlerts,
  startAutomationRun,
} from "./run-history.js";

const MINUTE = 60_000;

function row(overrides: Record<string, unknown>) {
  return {
    id: "run-1",
    owner: "alice@example.com",
    automation: "digest",
    path: "jobs/digest.md",
    scope: null,
    org_id: null,
    app_id: null,
    notification_email: null,
    run_id: null,
    thread_id: null,
    status: "running",
    started_at: Date.now(),
    finished_at: null,
    error: null,
    ...overrides,
  };
}

describe("automation run history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
    transactionMock.mockImplementation(
      (run: (tx: DbExec) => Promise<unknown>) => run({ execute: executeMock }),
    );
    sendAutomationFailureNotificationMock.mockImplementation(
      async (_input, options) => {
        await options?.onProviderReady?.("resend");
        return { status: "sent", provider: "resend" };
      },
    );
  });

  it("reports a run abandoned past the liveness ceiling as interrupted", async () => {
    executeMock.mockResolvedValue({
      rows: [row({ started_at: Date.now() - 60 * MINUTE })],
    });

    const [run] = await listAutomationRuns({
      owners: ["alice@example.com"],
      automation: "digest",
    });

    expect(run.status).toBe("interrupted");
  });

  it("leaves a genuinely in-flight run reported as running", async () => {
    executeMock.mockResolvedValue({
      rows: [row({ started_at: Date.now() - 2 * MINUTE })],
    });

    const [run] = await listAutomationRuns({
      owners: ["alice@example.com"],
      automation: "digest",
    });

    expect(run.status).toBe("running");
  });

  it("filters run history to the requesting app while keeping legacy rows", async () => {
    await listAutomationRuns({
      owners: ["alice@example.com"],
      automation: "digest",
      appId: "mail",
    });

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain("(app_id = ? OR app_id IS NULL)");
    expect(query.args).toEqual(["alice@example.com", "digest", "mail"]);
  });

  it("lists the newest run per resource for the requesting app", async () => {
    executeMock.mockResolvedValue({ rows: [row({ status: "error" })] });

    const [run] = await listLatestAutomationRuns({
      owners: ["alice@example.com", "__organization__:org-1"],
      appId: "calendar",
    });

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain("SELECT DISTINCT ON (owner, path)");
    expect(query.sql).toContain("ORDER BY owner, path, started_at DESC");
    expect(query.sql).toContain("(app_id = ? OR app_id IS NULL)");
    expect(query.args).toEqual([
      "alice@example.com",
      "__organization__:org-1",
      "calendar",
    ]);
    expect(run.status).toBe("error");
  });

  it("does not rewrite a finished run's status", async () => {
    executeMock.mockResolvedValue({
      rows: [
        row({
          status: "success",
          started_at: Date.now() - 60 * MINUTE,
          finished_at: Date.now() - 59 * MINUTE,
        }),
      ],
    });

    const [run] = await listAutomationRuns({
      owners: ["alice@example.com"],
      automation: "digest",
    });

    expect(run.status).toBe("success");
  });

  it("persists the failure code alongside the message", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    await finishAutomationRun(
      "run-1",
      "error",
      "Background automation was cut off before finishing (no_progress).",
      "background_automation_cut_off",
    );

    const update = executeMock.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          typeof input === "object" && input.sql.includes("SET status ="),
      );
    expect(update.sql).toContain("error_code = ?");
    expect(update.args).toContain("background_automation_cut_off");
  });

  it("reports an interrupted run with a code, not only a sentence", async () => {
    executeMock.mockResolvedValue({
      rows: [row({ started_at: Date.now() - 60 * MINUTE })],
    });

    const [run] = await listAutomationRuns({
      owners: ["alice@example.com"],
      automation: "digest",
    });

    expect(run.status).toBe("interrupted");
    expect(run.errorCode).toBe("background_automation_interrupted");
  });

  it("announces the terminal outcome with its code and duration", async () => {
    const startedAt = Date.now() - 4_000;
    executeMock
      .mockResolvedValueOnce({
        rows: [row({ id: "run-1", started_at: startedAt })],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    await finishAutomationRun(
      "run-1",
      "error",
      "Background automation was cut off before finishing (no_progress).",
      "background_automation_cut_off",
    );

    expect(emitMock).toHaveBeenCalledWith(
      "automation.run.finished",
      expect.objectContaining({
        automationRunId: "run-1",
        status: "error",
        errorCode: "background_automation_cut_off",
        durationMs: expect.any(Number),
      }),
      expect.anything(),
    );
    const [, payload] = emitMock.mock.calls.at(-1) ?? [];
    expect(
      (payload as { durationMs: number }).durationMs,
    ).toBeGreaterThanOrEqual(4_000);
  });

  it("emails the automation owner once when a failure streak starts", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          row({
            app_id: "calendar",
            notification_email: "alice@example.com",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          row({
            app_id: "calendar",
            notification_email: "alice@example.com",
            status: "error",
            error: "MCP tool unavailable",
            error_code: "mcp_missing",
            failure_alert_state: "evaluating",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    await finishAutomationRun(
      "run-1",
      "error",
      "MCP tool unavailable",
      "mcp_missing",
    );

    expect(sendAutomationFailureNotificationMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        email: "alice@example.com",
        appId: "calendar",
        automation: "digest",
        status: "error",
        errorCode: "mcp_missing",
        idempotencyKey: "automation-failure:run-1",
        unsubscribeToken: "unsubscribe-token",
      }),
      expect.objectContaining({ onProviderReady: expect.any(Function) }),
    );
    const lockQuery = executeMock.mock.calls[4]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(lockQuery.sql).toContain("pg_advisory_xact_lock");
    expect(lockQuery.args[0]).toContain(
      "agent-native:automation-failure-alert",
    );

    const priorRunsQuery = executeMock.mock.calls[5]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(priorRunsQuery.sql).toContain("(app_id = ? OR app_id IS NULL)");
    expect(priorRunsQuery.args).toEqual([
      "alice@example.com",
      "digest",
      "jobs/digest.md",
      "calendar",
      "run-1",
    ]);
  });

  it("checks legacy failure streaks without an untyped app id parameter", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [row({ notification_email: "alice@example.com" })],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          row({
            notification_email: "alice@example.com",
            status: "error",
            error: "MCP tool unavailable",
            failure_alert_state: "evaluating",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    await finishAutomationRun("run-1", "error", "MCP tool unavailable");

    const priorRunsQuery = executeMock.mock.calls[5]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(priorRunsQuery.sql).toContain("AND app_id IS NULL");
    expect(priorRunsQuery.sql).not.toContain("? IS NULL");
    expect(priorRunsQuery.args).toEqual([
      "alice@example.com",
      "digest",
      "jobs/digest.md",
      "run-1",
    ]);
    expect(sendAutomationFailureNotificationMock).toHaveBeenCalledOnce();
  });

  it("does not email again for a continuing failure streak", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          row({
            app_id: "calendar",
            notification_email: "alice@example.com",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          row({
            app_id: "calendar",
            notification_email: "alice@example.com",
            status: "error",
            failure_alert_state: "evaluating",
          }),
        ],
      });
    executeMock.mockResolvedValueOnce({ rowsAffected: 1 });
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          status: "interrupted",
          notification_email: "alice@example.com",
          failure_alerted: 1,
        },
      ],
    });
    executeMock.mockResolvedValueOnce({ rowsAffected: 1 });

    await finishAutomationRun("run-1", "error", "Still unavailable");

    expect(sendAutomationFailureNotificationMock).not.toHaveBeenCalled();
  });

  it("retries a durable failure alert with its original idempotency key and link", async () => {
    executeMock
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          row({
            status: "error",
            error: "MCP tool unavailable",
            failure_alerted: 1,
            failure_alert_state: "pending",
            failure_alert_attempts: 1,
            failure_alert_next_attempt_at: Date.now() - 1,
            failure_alert_provider: "resend",
            failure_alert_first_attempt_at: Date.now() - 10_000,
            failure_alert_unsubscribe_token: "sealed:unsubscribe-token",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await processPendingAutomationFailureAlerts();

    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
    expect(sendAutomationFailureNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "automation-failure:run-1",
        unsubscribeToken: "unsubscribe-token",
      }),
      expect.objectContaining({ onProviderReady: expect.any(Function) }),
    );
    const claim = executeMock.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          typeof input === "object" &&
          input.sql.includes("SET failure_alert_state = 'sending'"),
      );
    const outcome = executeMock.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          typeof input === "object" &&
          input.sql.includes("SET failure_alert_state = ?"),
      );
    expect(outcome.sql).toContain("AND failure_alert_claimed_at = ?");
    expect(outcome.args[3]).toBe(claim.args[0]);
  });

  it("enforces the attempt budget while recovering an expired lease", async () => {
    await processPendingAutomationFailureAlerts();

    const recovery = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(recovery.sql).toContain("failure_alert_attempts >= ?");
    expect(recovery.sql).toContain("failure_alert_attempts < ?");
    expect(recovery.args[0]).toBe(12);
    expect(recovery.args[2]).toBe(12);
  });

  it("keeps a failed first delivery queued for a later sweep", async () => {
    sendAutomationFailureNotificationMock.mockResolvedValueOnce({
      status: "not-ready",
    });
    executeMock
      .mockResolvedValueOnce({
        rows: [row({ notification_email: "alice@example.com" })],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          row({
            status: "error",
            failure_alert_state: "evaluating",
            notification_email: "alice@example.com",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    await finishAutomationRun("run-1", "error", "MCP tool unavailable");

    const retry = executeMock.mock.calls.at(-1)?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(retry.sql).toContain("SET failure_alert_state = ?");
    expect(retry.args[0]).toBe("pending");
    expect(Number(retry.args[1])).toBeGreaterThan(Date.now());
    expect(
      executeMock.mock.calls.some(([input]) =>
        String(input?.sql ?? input).includes("SET failure_alerted = 0"),
      ),
    ).toBe(false);
  });

  it("stops retrying an alert after its bounded attempt budget", async () => {
    sendAutomationFailureNotificationMock.mockResolvedValueOnce({
      status: "not-ready",
    });
    executeMock
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          row({
            status: "error",
            failure_alerted: 1,
            failure_alert_state: "pending",
            failure_alert_attempts: 11,
            failure_alert_next_attempt_at: Date.now() - 1,
            failure_alert_unsubscribe_token: "sealed:unsubscribe-token",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    await processPendingAutomationFailureAlerts();

    const finish = executeMock.mock.calls.at(-1)?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(finish.sql).toContain("SET failure_alert_state = ?");
    expect(finish.args[0]).toBe("failed");
    expect(finish.args[1]).toBeNull();
  });

  it("continues sweeping after one alert delivery throws", async () => {
    sendAutomationFailureNotificationMock.mockRejectedValueOnce(
      new Error("provider request failed"),
    );
    executeMock
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          row({
            id: "run-1",
            status: "error",
            failure_alerted: 1,
            failure_alert_state: "pending",
            failure_alert_attempts: 1,
            failure_alert_next_attempt_at: Date.now() - 1,
            failure_alert_unsubscribe_token: "sealed:unsubscribe-token",
          }),
          row({
            id: "run-2",
            status: "error",
            failure_alerted: 1,
            failure_alert_state: "pending",
            failure_alert_attempts: 1,
            failure_alert_next_attempt_at: Date.now() - 1,
            failure_alert_unsubscribe_token: "sealed:unsubscribe-token",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await processPendingAutomationFailureAlerts();

    expect(result).toMatchObject({ attempted: 2, deferred: 1, delivered: 1 });
    expect(sendAutomationFailureNotificationMock).toHaveBeenCalledTimes(2);
    const outcomes = executeMock.mock.calls
      .map(([input]) => input)
      .filter(
        (input) =>
          typeof input === "object" &&
          input.sql.includes("SET failure_alert_state = ?"),
      );
    expect(outcomes.map((outcome) => outcome.args[2])).toEqual([
      "run-1",
      "run-2",
    ]);
  });

  it("keeps an ambiguous SendGrid delivery from being resent", async () => {
    sendAutomationFailureNotificationMock.mockImplementationOnce(
      async (_input, options) => {
        await options?.onProviderReady?.("sendgrid");
        return { status: "uncertain", provider: "sendgrid" };
      },
    );
    executeMock
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({
        rows: [
          row({
            status: "error",
            failure_alerted: 1,
            failure_alert_state: "pending",
            failure_alert_attempts: 1,
            failure_alert_next_attempt_at: Date.now() - 1,
            failure_alert_provider: "sendgrid",
            failure_alert_unsubscribe_token: "sealed:unsubscribe-token",
          }),
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await processPendingAutomationFailureAlerts();

    expect(result.uncertain).toBe(1);
    const finish = executeMock.mock.calls.at(-1)?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(finish.sql).toContain("SET failure_alert_state = ?");
    expect(finish.args[0]).toBe("uncertain");
  });

  it("serializes failure alerts for overlapping runs", async () => {
    const runs = new Map(
      ["run-1", "run-2"].map((id, index) => [
        id,
        row({
          id,
          app_id: "calendar",
          notification_email: "alice@example.com",
          started_at: index + 1,
        }),
      ]),
    );
    const lockTails = new Map<string, Promise<void>>();
    const lockKeys: string[] = [];
    executeMock.mockImplementation(
      async (
        statement: DbExecStatement,
      ): Promise<{ rows: unknown[]; rowsAffected: number }> => {
        const sql = typeof statement === "string" ? statement : statement.sql;
        const args =
          typeof statement === "string" ? [] : (statement.args ?? []);
        if (sql.startsWith("SELECT owner")) {
          const runId = String(args[0]);
          return { rows: [runs.get(runId)], rowsAffected: 1 };
        }
        if (sql.includes("SET status =")) {
          const run = runs.get(String(args[6]));
          Object.assign(run!, {
            status: args[0],
            error: args[2],
            error_code: args[3],
            failure_alert_state: args[4],
            failure_alert_next_attempt_at: args[5],
          });
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("WHERE failure_alert_state = 'sending' AND")) {
          return { rows: [], rowsAffected: 0 };
        }
        if (sql.startsWith("SELECT * FROM automation_runs")) {
          const runId = String(args.at(-1));
          return { rows: [runs.get(runId)], rowsAffected: 1 };
        }
        if (sql.startsWith("SELECT status, notification_email")) {
          const runId = String(args.at(-1));
          const otherRunId = runId === "run-1" ? "run-2" : "run-1";
          const previous = runs.get(otherRunId)!;
          return {
            rows: [
              {
                status: previous.status,
                notification_email: previous.notification_email,
                failure_alerted: previous.failure_alerted,
              },
            ],
            rowsAffected: 1,
          };
        }
        if (
          sql.includes(
            "SET failure_alerted = 1, failure_alert_state = 'sending'",
          )
        ) {
          const run = runs.get(String(args[1]))!;
          run.failure_alerted = 1;
          run.failure_alert_state = "sending";
          run.failure_alert_attempts =
            Number(run.failure_alert_attempts ?? 0) + 1;
          run.failure_alert_claimed_at = args[0];
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SET failure_alert_state = 'suppressed'")) {
          const run = runs.get(String(args[0]))!;
          run.failure_alerted = 1;
          run.failure_alert_state = "suppressed";
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SET failure_alert_unsubscribe_token")) {
          const run = runs.get(String(args[1]))!;
          run.failure_alert_unsubscribe_token = args[0];
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SET failure_alert_provider =")) {
          const run = runs.get(String(args[2]))!;
          run.failure_alert_provider = args[0];
          run.failure_alert_first_attempt_at = args[1];
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SET failure_alert_state = ?")) {
          const run = runs.get(String(args[2]))!;
          run.failure_alert_state = args[0];
          run.failure_alert_next_attempt_at = args[1];
          run.failure_alert_claimed_at = null;
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      },
    );
    transactionMock.mockImplementation(
      async (run: (tx: DbExec) => Promise<unknown>) => {
        const releases: Array<() => void> = [];
        const tx: DbExec = {
          execute: async (statement) => {
            const sql =
              typeof statement === "string" ? statement : statement.sql;
            if (sql.includes("pg_advisory_xact_lock")) {
              const args =
                typeof statement === "string" ? [] : (statement.args ?? []);
              const key = String(args[0]);
              lockKeys.push(key);
              const previous = lockTails.get(key) ?? Promise.resolve();
              let release = () => {};
              const held = new Promise<void>((resolve) => {
                release = resolve;
              });
              lockTails.set(
                key,
                previous.then(() => held),
              );
              await previous;
              releases.push(release);
            }
            return executeMock(statement);
          },
        };
        try {
          return await run(tx);
        } finally {
          for (const release of releases.reverse()) release();
        }
      },
    );

    await Promise.all([
      finishAutomationRun("run-1", "error", "MCP tool unavailable"),
      finishAutomationRun("run-2", "error", "MCP tool unavailable"),
    ]);

    expect(sendAutomationFailureNotificationMock).toHaveBeenCalledOnce();
    expect(lockKeys).toHaveLength(2);
    expect(lockKeys[0]).toBe(lockKeys[1]);
  });

  it("prunes older rows for the same automation when recording a run", async () => {
    await startAutomationRun({
      owner: "alice@example.com",
      automation: "digest",
      path: "jobs/digest.md",
    });

    const statements = executeMock.mock.calls.map((call) =>
      String(call[0]?.sql ?? call[0]).replace(/\s+/g, " "),
    );
    const prune = statements.find((sql) => sql.startsWith("DELETE FROM"));
    expect(prune).toBeDefined();
    expect(prune).toContain("LIMIT 50");
    expect(prune).toContain("NOT IN ('evaluating', 'pending', 'sending')");
  });
});
