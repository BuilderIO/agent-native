import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "BIGINT",
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(),
  ensureTableExists: vi.fn(),
  ensureIndexExists: vi.fn(),
}));

const emitMock = vi.hoisted(() => vi.fn());
vi.mock("../event-bus/index.js", () => ({
  emit: emitMock,
  registerEvent: vi.fn(),
}));

import {
  finishAutomationRun,
  listAutomationRuns,
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
    executeMock.mockResolvedValue({ rows: [] });
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

  // The failure taxonomy already existed in code and survived only as English
  // prose in a text column, so "how often are runs cut off?" was a LIKE.
  it("persists the failure code alongside the message", async () => {
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
          typeof input === "object" && /UPDATE .* SET status/.test(input.sql),
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

  // This is the framework's terminal hook for automations, and it fires from
  // every path that records an outcome — the runner, the scheduler's dispatch
  // failures, remote execution — not just the one the runner owns.
  it("announces the terminal outcome with its code and duration", async () => {
    const startedAt = Date.now() - 4_000;
    executeMock.mockResolvedValue({
      rows: [row({ id: "run-1", started_at: startedAt })],
    });

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
  });
});
