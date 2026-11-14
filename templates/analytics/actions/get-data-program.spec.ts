import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDataProgram: vi.fn(),
  getLatestFinishedRun: vi.fn(),
  getLatestSuccessfulRun: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/data-programs", () => ({
  getDataProgram: mocks.getDataProgram,
  getLatestFinishedRun: mocks.getLatestFinishedRun,
  getLatestSuccessfulRun: mocks.getLatestSuccessfulRun,
  hashDataProgramParams: (
    params: Record<string, unknown>,
    email: string,
    orgId: string | null,
  ) => `hash:${email}:${orgId}:${JSON.stringify(params)}`,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: () => ({
    userEmail: "alice@example.com",
    orgId: "org-1",
  }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

const { default: getDataProgram } = await import("./get-data-program");

const PROGRAM = {
  id: "dp_1",
  name: "collector",
  title: "Collector",
  description: "",
  code: "emit([])",
  paramsSchema: null,
  defaultParams: null,
  refreshMode: "ttl",
  refreshTtlMs: 3_600_000,
  background: true,
  archivedAt: null,
  outputColumns: null,
};

describe("get-data-program", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDataProgram.mockResolvedValue(PROGRAM);
    mocks.resolveAccess.mockResolvedValue({ role: "owner" });
  });

  it("reads the newest finished run, not a queued one", async () => {
    mocks.getLatestFinishedRun.mockResolvedValue({
      status: "succeeded",
      rowCount: 2,
      truncated: false,
      errorCode: null,
      errorMessage: null,
      finishedAt: 500,
      rowsJson: JSON.stringify([{ n: 1 }, { n: 2 }]),
    });

    const result = await getDataProgram.run({
      programId: "dp_1",
      includeRows: true,
    });

    expect(mocks.getLatestFinishedRun).toHaveBeenCalledWith(
      "dp_1",
      "hash:alice@example.com:org-1:{}",
    );
    expect(result.lastRun).toEqual(
      expect.objectContaining({
        status: "succeeded",
        rows: [{ n: 1 }, { n: 2 }],
      }),
    );
    expect(mocks.getLatestSuccessfulRun).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("lastGoodRun");
  });

  it("adds the newest successful run as lastGoodRun when the newest finished run failed", async () => {
    mocks.getLatestFinishedRun.mockResolvedValue({
      status: "failed",
      rowCount: 0,
      truncated: false,
      errorCode: "program_error",
      errorMessage: "Sample orders file is missing",
      finishedAt: 900,
      rowsJson: null,
    });
    mocks.getLatestSuccessfulRun.mockResolvedValue({
      status: "succeeded",
      rowCount: 1,
      truncated: false,
      finishedAt: 800,
      rowsJson: JSON.stringify([{ repo: "demo" }]),
    });

    const result = await getDataProgram.run({
      programId: "dp_1",
      includeRows: true,
    });

    expect(result.lastRun).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "program_error",
        errorMessage: "Sample orders file is missing",
      }),
    );
    expect(result.lastGoodRun).toEqual({
      rowCount: 1,
      truncated: false,
      finishedAt: 800,
      rows: [{ repo: "demo" }],
    });
  });
});
