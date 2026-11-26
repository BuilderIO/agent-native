import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDataProgramDetails: vi.fn(),
  listDataProgramSummaries: vi.fn(),
  credentialContext: vi.fn(),
}));

vi.mock("@agent-native/core/data-programs", () => ({
  getDataProgramDetails: mocks.getDataProgramDetails,
  listDataProgramSummaries: mocks.listDataProgramSummaries,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: mocks.credentialContext,
}));

const { default: getDataProgram } = await import("./get-data-program");
const { default: listDataPrograms } = await import("./list-data-programs");

const CALLER = { userEmail: "alice@example.com", orgId: "org-1" };

describe("Analytics data program read actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.credentialContext.mockReturnValue(CALLER);
  });

  it("get-data-program reads through core for the Analytics app and the caller", async () => {
    const details = {
      id: "dp_1",
      scheduledRefresh: true,
      orgSharedRun: { status: "succeeded", finishedAt: 900 },
      lastRun: null,
    };
    mocks.getDataProgramDetails.mockResolvedValue(details);

    const result = await getDataProgram.run({
      programId: "dp_1",
      includeRows: true,
    });

    expect(mocks.getDataProgramDetails).toHaveBeenCalledWith(
      "dp_1",
      "analytics",
      CALLER,
      { includeRows: true },
    );
    expect(result).toBe(details);
  });

  it("list-data-programs reads through core for the Analytics app and the caller", async () => {
    const summaries = { programs: [{ id: "dp_1", scheduledRefresh: false }] };
    mocks.listDataProgramSummaries.mockResolvedValue(summaries);

    const result = await listDataPrograms.run({ includeArchived: true });

    expect(mocks.listDataProgramSummaries).toHaveBeenCalledWith(
      "analytics",
      CALLER,
      { includeArchived: true },
    );
    expect(result).toBe(summaries);
  });

  it("refuses a read with no signed-in caller", async () => {
    mocks.credentialContext.mockReturnValue(null);

    await expect(getDataProgram.run({ programId: "dp_1" })).rejects.toThrow(
      "No authenticated context for get-data-program.",
    );
    await expect(listDataPrograms.run({})).rejects.toThrow(
      "No authenticated context for list-data-programs.",
    );
    expect(mocks.getDataProgramDetails).not.toHaveBeenCalled();
    expect(mocks.listDataProgramSummaries).not.toHaveBeenCalled();
  });
});
