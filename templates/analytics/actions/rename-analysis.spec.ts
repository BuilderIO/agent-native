import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAnalysis: vi.fn(),
  upsertAnalysis: vi.fn(),
  upsertAnalysisWithRetry: vi.fn(),
}));

/**
 * Default passthrough: fetch via the mocked `getAnalysis`, run the action's
 * mutate callback once against it, then forward to the mocked
 * `upsertAnalysis` and return an AnalysisRecord-shaped result carrying the
 * mutated name. Individual tests override this with `mockImplementationOnce`
 * to simulate a lost race and prove the retry helper re-reads fresh state.
 */
function defaultUpsertAnalysisWithRetry(
  id: string,
  ctx: unknown,
  mutate: (existing: any) => Promise<any> | any,
) {
  return (async () => {
    const existing = await mocks.getAnalysis(id, ctx);
    if (!existing) {
      throw new Error(`analysis "${id}" not found (or you don't have access).`);
    }
    const body = await mutate(existing);
    await mocks.upsertAnalysis(id, body, ctx);
    return { ...existing, ...body };
  })();
}

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return { ...actual };
});

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getAnalysis: mocks.getAnalysis,
  upsertAnalysis: mocks.upsertAnalysis,
  upsertAnalysisWithRetry: mocks.upsertAnalysisWithRetry,
}));

const { default: renameAnalysis } = await import("./rename-analysis");

function analysisRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "closed-lost-q1",
    name: "Closed Lost Q1",
    description: "Deal loss analysis",
    question: "Why did we lose Q1 deals?",
    instructions: "Query HubSpot for closed-lost deals in Q1.",
    dataSources: ["hubspot"],
    resultMarkdown: "# Findings",
    resultData: { rows: 3 },
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("rename-analysis", () => {
  beforeEach(() => {
    mocks.getAnalysis.mockReset();
    mocks.upsertAnalysis.mockReset();
    mocks.upsertAnalysisWithRetry.mockReset();
    mocks.upsertAnalysisWithRetry.mockImplementation(
      defaultUpsertAnalysisWithRetry,
    );
  });

  it("renames an analysis through the fenced retry helper", async () => {
    mocks.getAnalysis.mockResolvedValue(analysisRecord());

    const result: any = await renameAnalysis.run({
      id: "closed-lost-q1",
      name: "New Name",
    });

    expect(result).toEqual({ id: "closed-lost-q1", name: "New Name" });
    expect(mocks.upsertAnalysisWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.upsertAnalysis).toHaveBeenCalledTimes(1);
    const [, savedBody] = mocks.upsertAnalysis.mock.calls[0];
    // The rename patch touches only `name`, never a stale snapshot of the
    // other fields, so a concurrent writer's changes to description/results
    // can never be clobbered by this call.
    expect(savedBody).toEqual({ name: "New Name" });
  });

  it("rejects a blank name without touching the store", async () => {
    await expect(
      renameAnalysis.run({ id: "closed-lost-q1", name: "   " }),
    ).rejects.toThrow(/name is required/);

    expect(mocks.upsertAnalysisWithRetry).not.toHaveBeenCalled();
  });

  it("lands both a concurrent analysis edit and this rename when the first fenced write is lost to the race", async () => {
    // Simulates two interleaved writers racing on the same analysis: this
    // call renames the analysis, but its first fenced write is lost because a
    // concurrent save (e.g. save-analysis re-running with fresh results)
    // already saved new resultMarkdown/resultData in between. A correct retry
    // re-reads that winning save and reapplies the rename on top of it, so
    // both the fresh results and the new name land instead of the rename
    // clobbering the re-run with a stale snapshot.
    const beforeConcurrentWrite = analysisRecord();
    const afterConcurrentWrite = analysisRecord({
      resultMarkdown: "# Fresh findings from re-run",
      resultData: { rows: 9 },
      updatedAt: "2026-07-09T00:00:00.001Z",
    });

    let mutateCallCount = 0;
    mocks.upsertAnalysisWithRetry.mockImplementationOnce(
      async (id: string, ctx: unknown, mutate: (existing: any) => any) => {
        mutateCallCount += 1;
        await mutate(beforeConcurrentWrite); // attempt 1: lost to the race
        mutateCallCount += 1;
        const body = await mutate(afterConcurrentWrite); // retry
        await mocks.upsertAnalysis(id, body, ctx);
        return { ...afterConcurrentWrite, ...body };
      },
    );

    const result: any = await renameAnalysis.run({
      id: "closed-lost-q1",
      name: "Renamed While Racing",
    });

    expect(mutateCallCount).toBe(2);
    expect(result).toEqual({
      id: "closed-lost-q1",
      name: "Renamed While Racing",
    });
    const saved = mocks.upsertAnalysis.mock.calls[0][1] as { name: string };
    // Only `name` is ever in the saved patch — the concurrent writer's fresh
    // resultMarkdown/resultData are left untouched by this call.
    expect(saved).toEqual({ name: "Renamed While Racing" });
  });
});
