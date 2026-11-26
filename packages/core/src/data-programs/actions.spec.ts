import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveDataProgram: vi.fn(),
  assertAccess: vi.fn(),
  runDataProgram: vi.fn(),
  hashDataProgramParams: vi.fn(
    (
      params: Record<string, unknown> | undefined,
      viewerKey?: string,
      orgKey?: string | null,
    ) =>
      `hash:${viewerKey ?? ""}:${orgKey ?? ""}:${JSON.stringify(params ?? {})}`,
  ),
  hashOrgSharedDataProgramParams: vi.fn(
    (params: Record<string, unknown> | undefined, orgId: string) =>
      `shared:${orgId}:${JSON.stringify(params ?? {})}`,
  ),
  getDataProgram: vi.fn(),
  getLatestFinishedRun: vi.fn(),
  getLatestFinishedRunOutcome: vi.fn(),
  getLatestSuccessfulRun: vi.fn(),
  resolveAccess: vi.fn(),
  upsertDataProgram: vi.fn(),
}));

vi.mock("../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("./execute.js", () => ({
  runDataProgram: mocks.runDataProgram,
  hashDataProgramParams: mocks.hashDataProgramParams,
  hashOrgSharedDataProgramParams: mocks.hashOrgSharedDataProgramParams,
}));

vi.mock("./store.js", () => ({
  archiveDataProgram: mocks.archiveDataProgram,
  getDataProgram: mocks.getDataProgram,
  getLatestFinishedRun: mocks.getLatestFinishedRun,
  getLatestFinishedRunOutcome: mocks.getLatestFinishedRunOutcome,
  getLatestSuccessfulRun: mocks.getLatestSuccessfulRun,
  listDataPrograms: vi.fn(),
  upsertDataProgram: mocks.upsertDataProgram,
  MIN_REFRESH_TTL_MS: 60_000,
  MIN_SCHEDULED_REFRESH_MS: 15 * 60_000,
}));

vi.mock("../sharing/access.js", () => ({
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

import { createDataProgramActions } from "./actions.js";

function makeActions() {
  return createDataProgramActions({
    appId: "analytics",
    getActions: () => ({}),
  }) as Record<string, { run: (args: any, ctx?: any) => Promise<any> }>;
}

describe("data-programs/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({ role: "owner" });
  });

  it("returns lastGoodRun.truncated from run-data-program failures", async () => {
    mocks.runDataProgram.mockResolvedValue({
      ok: false,
      error: { code: "timeout", message: "Timed out." },
      lastGoodRun: {
        rows: [{ account: "Acme" }],
        schema: [{ name: "account", type: "string" }],
        truncated: true,
        asOfMs: 123,
      },
    });

    const result = await makeActions()["run-data-program"].run(
      { programId: "dp_1", params: {} },
      { userEmail: "alice@example.com", orgId: "org_1", caller: "tool" },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "timeout", message: "Timed out." },
      lastGoodRun: {
        rowCount: 1,
        columns: [{ name: "account", type: "string" }],
        sampleRows: [{ account: "Acme" }],
        truncated: true,
        asOfMs: 123,
      },
    });
  });

  it("returns get-data-program lastRun.truncated using the org-scoped hash", async () => {
    mocks.getDataProgram.mockResolvedValue({
      id: "dp_1",
      name: "cohort",
      title: "Cohort",
      description: "",
      code: "emit([])",
      paramsSchema: null,
      defaultParams: JSON.stringify({ segment: "enterprise" }),
      refreshMode: "ttl",
      refreshTtlMs: 300_000,
      background: false,
      archivedAt: null,
      outputColumns: null,
    });
    mocks.getLatestFinishedRun.mockResolvedValue({
      status: "succeeded",
      rowCount: 10000,
      truncated: true,
      errorCode: null,
      errorMessage: null,
      finishedAt: 456,
      rowsJson: null,
    });

    const result = await makeActions()["get-data-program"].run(
      { programId: "dp_1" },
      { userEmail: "alice@example.com", orgId: "org_1", caller: "frontend" },
    );

    expect(mocks.hashDataProgramParams).toHaveBeenCalledWith(
      { segment: "enterprise" },
      "alice@example.com",
      "org_1",
    );
    expect(mocks.getLatestFinishedRun).toHaveBeenCalledWith(
      "dp_1",
      'hash:alice@example.com:org_1:{"segment":"enterprise"}',
    );
    expect(result.lastRun).toEqual(
      expect.objectContaining({
        status: "succeeded",
        rowCount: 10000,
        truncated: true,
      }),
    );
    expect(mocks.getLatestSuccessfulRun).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("lastGoodRun");
  });

  it("returns get-data-program lastGoodRun rows when the newest finished run failed", async () => {
    mocks.getDataProgram.mockResolvedValue({
      id: "dp_1",
      name: "collector",
      title: "Collector",
      description: "",
      code: "emit([])",
      paramsSchema: null,
      defaultParams: null,
      refreshMode: "ttl",
      refreshTtlMs: 300_000,
      background: true,
      archivedAt: null,
      outputColumns: null,
    });
    mocks.getLatestFinishedRun.mockResolvedValue({
      status: "failed",
      rowCount: 0,
      truncated: false,
      errorCode: "sandbox_error",
      errorMessage: "GitHub returned 502",
      finishedAt: 900,
      rowsJson: null,
    });
    mocks.getLatestSuccessfulRun.mockResolvedValue({
      status: "succeeded",
      rowCount: 1,
      truncated: false,
      finishedAt: 800,
      rowsJson: JSON.stringify([{ repo: "agent-native" }]),
    });

    const result = await makeActions()["get-data-program"].run(
      { programId: "dp_1", includeRows: true },
      { userEmail: "alice@example.com", orgId: "org_1", caller: "tool" },
    );

    expect(result.lastRun).toEqual(
      expect.objectContaining({
        status: "failed",
        errorMessage: "GitHub returned 502",
      }),
    );
    expect(result.lastRun).not.toHaveProperty("rows");
    expect(result.lastGoodRun).toEqual({
      rowCount: 1,
      truncated: false,
      finishedAt: 800,
      rows: [{ repo: "agent-native" }],
    });
  });

  it("passes save-data-program's scheduledRefresh to the store", async () => {
    mocks.runDataProgram.mockResolvedValue({
      ok: true,
      rows: [],
      schema: [{ name: "repo", type: "string" }],
    });
    mocks.upsertDataProgram.mockImplementation(async (input) => ({
      id: "dp_1",
      ...input,
    }));

    await makeActions()["save-data-program"].run(
      {
        name: "collector",
        title: "Collector",
        code: "emit([])",
        refreshTtlMs: 3_600_000,
        scheduledRefresh: true,
      },
      { userEmail: "alice@example.com", orgId: "org_1", caller: "tool" },
    );

    expect(mocks.upsertDataProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledRefresh: true,
        orgId: "org_1",
        refreshTtlMs: 3_600_000,
      }),
    );
  });

  it("returns get-data-program's org-shared run status without its rows or row count, for runs since the last save", async () => {
    mocks.getDataProgram.mockResolvedValue({
      id: "dp_1",
      name: "collector",
      title: "Collector",
      description: "",
      code: "emit([])",
      paramsSchema: null,
      defaultParams: JSON.stringify({ repo: "agent-native" }),
      refreshMode: "ttl",
      refreshTtlMs: 3_600_000,
      background: false,
      scheduledRefresh: true,
      archivedAt: null,
      outputColumns: null,
      orgId: "org_1",
      updatedAt: new Date(600).toISOString(),
    });
    mocks.getLatestFinishedRun.mockResolvedValue(null);
    mocks.getLatestFinishedRunOutcome.mockResolvedValue({
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      startedAt: 650,
      finishedAt: 700,
    });

    const result = await makeActions()["get-data-program"].run(
      { programId: "dp_1", includeRows: true },
      { userEmail: "viewer@example.com", orgId: "org_1", caller: "tool" },
    );

    expect(mocks.getLatestFinishedRunOutcome).toHaveBeenCalledWith(
      "dp_1",
      'shared:org_1:{"repo":"agent-native"}',
    );
    expect(result.scheduledRefresh).toBe(true);
    expect(result.orgSharedRun).toEqual({
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      finishedAt: 700,
    });

    mocks.getLatestFinishedRunOutcome.mockResolvedValue({
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      startedAt: 550,
      finishedAt: 580,
    });
    const afterSave = await makeActions()["get-data-program"].run(
      { programId: "dp_1" },
      { userEmail: "viewer@example.com", orgId: "org_1", caller: "tool" },
    );
    expect(afterSave.orgSharedRun).toBeNull();
  });

  it("scopes delete-data-program archives to the current app", async () => {
    mocks.archiveDataProgram.mockResolvedValue(true);

    const result = await makeActions()["delete-data-program"].run(
      { programId: "dp_1" },
      { userEmail: "alice@example.com", orgId: "org_1", caller: "frontend" },
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "data_program",
      "dp_1",
      "editor",
      { userEmail: "alice@example.com", orgId: "org_1" },
    );
    expect(mocks.archiveDataProgram).toHaveBeenCalledWith("dp_1", "analytics", {
      userEmail: "alice@example.com",
      orgId: "org_1",
    });
    expect(result).toEqual({ archived: true });
  });
});
