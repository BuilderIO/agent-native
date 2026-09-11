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
  getDataProgram: vi.fn(),
  getLatestRun: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("./execute.js", () => ({
  runDataProgram: mocks.runDataProgram,
  hashDataProgramParams: mocks.hashDataProgramParams,
}));

vi.mock("./store.js", () => ({
  archiveDataProgram: mocks.archiveDataProgram,
  getDataProgram: mocks.getDataProgram,
  getLatestRun: mocks.getLatestRun,
  listDataPrograms: vi.fn(),
  upsertDataProgram: vi.fn(),
  MIN_REFRESH_TTL_MS: 60_000,
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
    mocks.getLatestRun.mockResolvedValue({
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
    expect(mocks.getLatestRun).toHaveBeenCalledWith(
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
    expect(mocks.archiveDataProgram).toHaveBeenCalledWith("dp_1", "analytics");
    expect(result).toEqual({ archived: true });
  });
});
