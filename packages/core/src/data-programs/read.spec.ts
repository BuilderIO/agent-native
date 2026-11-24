import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  listDataPrograms: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("./execute.js", () => ({
  hashDataProgramParams: mocks.hashDataProgramParams,
  hashOrgSharedDataProgramParams: mocks.hashOrgSharedDataProgramParams,
}));

vi.mock("./store.js", () => ({
  getDataProgram: mocks.getDataProgram,
  getLatestFinishedRun: mocks.getLatestFinishedRun,
  getLatestFinishedRunOutcome: mocks.getLatestFinishedRunOutcome,
  getLatestSuccessfulRun: mocks.getLatestSuccessfulRun,
  listDataPrograms: mocks.listDataPrograms,
}));

vi.mock("../sharing/access.js", () => ({
  resolveAccess: mocks.resolveAccess,
}));

import { getDataProgramDetails, listDataProgramSummaries } from "./read.js";

const READER = { userEmail: "alice@example.com", orgId: "org_1" };
const UPDATED_AT = "2026-11-20T12:00:00.000Z";
const SAVED_MS = Date.parse(UPDATED_AT);

function program(overrides: Record<string, unknown> = {}) {
  return {
    id: "dp_1",
    name: "cohort",
    title: "Cohort",
    description: "Accounts by segment",
    code: "emit([])",
    paramsSchema: JSON.stringify({ type: "object" }),
    defaultParams: JSON.stringify({ segment: "enterprise" }),
    refreshMode: "ttl",
    refreshTtlMs: 900_000,
    background: false,
    scheduledRefresh: true,
    archivedAt: null,
    updatedAt: UPDATED_AT,
    outputColumns: JSON.stringify([{ name: "account", type: "string" }]),
    orgId: "org_1",
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    status: "succeeded",
    rowCount: 2,
    truncated: false,
    errorCode: null,
    errorMessage: null,
    finishedAt: 500,
    rowsJson: JSON.stringify([{ account: "Acme" }, { account: "Initech" }]),
    ...overrides,
  };
}

describe("listDataProgramSummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists each program's settings and columns for the reader", async () => {
    mocks.listDataPrograms.mockResolvedValue([
      program(),
      program({ id: "dp_2", outputColumns: null, scheduledRefresh: false }),
    ]);

    const result = await listDataProgramSummaries("analytics", READER, {
      includeArchived: true,
    });

    expect(mocks.listDataPrograms).toHaveBeenCalledWith(
      "analytics",
      { userEmail: "alice@example.com", orgId: "org_1" },
      { includeArchived: true },
    );
    expect(result.programs).toEqual([
      {
        id: "dp_1",
        name: "cohort",
        title: "Cohort",
        description: "Accounts by segment",
        refreshMode: "ttl",
        refreshTtlMs: 900_000,
        background: false,
        scheduledRefresh: true,
        archivedAt: null,
        updatedAt: UPDATED_AT,
        columns: [{ name: "account", type: "string" }],
      },
      expect.objectContaining({
        id: "dp_2",
        scheduledRefresh: false,
        columns: [],
      }),
    ]);
  });

  it("leaves out what the reader and options don't set", async () => {
    mocks.listDataPrograms.mockResolvedValue([]);

    await listDataProgramSummaries("analytics", { orgId: null });

    expect(mocks.listDataPrograms).toHaveBeenCalledWith("analytics", {}, {});
  });
});

describe("getDataProgramDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({ role: "viewer" });
    mocks.getDataProgram.mockResolvedValue(program());
    mocks.getLatestFinishedRun.mockResolvedValue(run());
    mocks.getLatestFinishedRunOutcome.mockResolvedValue(null);
  });

  it("returns the program and its last run for the reader's own params", async () => {
    const result = await getDataProgramDetails("dp_1", "analytics", READER);

    expect(mocks.getDataProgram).toHaveBeenCalledWith("dp_1", "analytics", {
      userEmail: "alice@example.com",
      orgId: "org_1",
    });
    expect(mocks.resolveAccess).toHaveBeenCalledWith("data_program", "dp_1", {
      userEmail: "alice@example.com",
      orgId: "org_1",
    });
    expect(mocks.getLatestFinishedRun).toHaveBeenCalledWith(
      "dp_1",
      'hash:alice@example.com:org_1:{"segment":"enterprise"}',
    );
    expect(mocks.getLatestSuccessfulRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "dp_1",
      name: "cohort",
      title: "Cohort",
      description: "Accounts by segment",
      code: "emit([])",
      paramsSchema: { type: "object" },
      defaultParams: { segment: "enterprise" },
      refreshMode: "ttl",
      refreshTtlMs: 900_000,
      background: false,
      scheduledRefresh: true,
      archivedAt: null,
      columns: [{ name: "account", type: "string" }],
      orgSharedRun: null,
      lastRun: {
        status: "succeeded",
        rowCount: 2,
        truncated: false,
        errorCode: null,
        errorMessage: null,
        finishedAt: 500,
      },
    });
  });

  it("refuses a program the reader can't find or can't access", async () => {
    mocks.getDataProgram.mockResolvedValueOnce(null);
    await expect(
      getDataProgramDetails("dp_1", "analytics", READER),
    ).rejects.toThrow("Data program not found.");

    mocks.resolveAccess.mockResolvedValueOnce(null);
    await expect(
      getDataProgramDetails("dp_1", "analytics", READER),
    ).rejects.toThrow("Access denied to this data program.");
    expect(mocks.getLatestFinishedRun).not.toHaveBeenCalled();
  });

  it("reads a program with no params, schema, columns or runs", async () => {
    mocks.getDataProgram.mockResolvedValue(
      program({
        defaultParams: null,
        paramsSchema: null,
        outputColumns: null,
        orgId: null,
      }),
    );
    mocks.getLatestFinishedRun.mockResolvedValue(null);

    const result = await getDataProgramDetails("dp_1", "analytics", {
      userEmail: "alice@example.com",
    });

    expect(mocks.hashDataProgramParams).toHaveBeenCalledWith(
      {},
      "alice@example.com",
      null,
    );
    expect(mocks.getDataProgram).toHaveBeenCalledWith("dp_1", "analytics", {
      userEmail: "alice@example.com",
    });
    expect(mocks.getLatestFinishedRunOutcome).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      defaultParams: {},
      paramsSchema: null,
      columns: [],
      lastRun: null,
      orgSharedRun: null,
    });
    expect(result).not.toHaveProperty("lastGoodRun");
  });

  it("adds the newest successful run when the last one failed", async () => {
    mocks.getLatestFinishedRun.mockResolvedValue(
      run({
        status: "failed",
        rowCount: null,
        errorCode: "timeout",
        errorMessage: "Timed out.",
        rowsJson: null,
      }),
    );
    mocks.getLatestSuccessfulRun.mockResolvedValue(
      run({ truncated: true, finishedAt: 300 }),
    );

    const result = await getDataProgramDetails("dp_1", "analytics", READER, {
      includeRows: true,
    });

    expect(mocks.getLatestSuccessfulRun).toHaveBeenCalledWith(
      "dp_1",
      'hash:alice@example.com:org_1:{"segment":"enterprise"}',
    );
    expect(result.lastRun).toEqual({
      status: "failed",
      rowCount: null,
      truncated: false,
      errorCode: "timeout",
      errorMessage: "Timed out.",
      finishedAt: 500,
    });
    expect(result.lastGoodRun).toEqual({
      rowCount: 2,
      truncated: true,
      finishedAt: 300,
      rows: [{ account: "Acme" }, { account: "Initech" }],
    });
  });

  it("returns cached rows only when asked", async () => {
    mocks.getLatestFinishedRun.mockResolvedValue(run({ status: "failed" }));
    mocks.getLatestSuccessfulRun.mockResolvedValue(run());

    const without = await getDataProgramDetails("dp_1", "analytics", READER);
    expect(without.lastRun).not.toHaveProperty("rows");
    expect(without.lastGoodRun).not.toHaveProperty("rows");

    const withRows = await getDataProgramDetails("dp_1", "analytics", READER, {
      includeRows: true,
    });
    expect(withRows.lastRun).toHaveProperty("rows", [
      { account: "Acme" },
      { account: "Initech" },
    ]);
    expect(withRows.lastGoodRun).toHaveProperty("rows", [
      { account: "Acme" },
      { account: "Initech" },
    ]);
  });

  it("returns the org's shared run status, without rows, for runs since the last save", async () => {
    mocks.getLatestFinishedRunOutcome.mockResolvedValue({
      status: "failed",
      errorCode: "not_shareable",
      errorMessage: "Uses a personal key.",
      finishedAt: SAVED_MS + 5_000,
      startedAt: SAVED_MS,
      rowCount: 7,
    });

    const result = await getDataProgramDetails("dp_1", "analytics", READER);

    expect(mocks.getLatestFinishedRunOutcome).toHaveBeenCalledWith(
      "dp_1",
      'shared:org_1:{"segment":"enterprise"}',
    );
    expect(result.orgSharedRun).toEqual({
      status: "failed",
      errorCode: "not_shareable",
      errorMessage: "Uses a personal key.",
      finishedAt: SAVED_MS + 5_000,
    });
  });

  it("ignores a shared run that started before the last save", async () => {
    mocks.getLatestFinishedRunOutcome.mockResolvedValue({
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      finishedAt: SAVED_MS + 1_000,
      startedAt: SAVED_MS - 1,
    });

    const result = await getDataProgramDetails("dp_1", "analytics", READER);

    expect(result.orgSharedRun).toBeNull();
  });
});
