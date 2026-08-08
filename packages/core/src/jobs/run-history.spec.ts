import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(),
  ensureIndexExists: vi.fn(),
}));

import { listAutomationRuns, startAutomationRun } from "./run-history.js";

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
