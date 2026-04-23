import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockEmit = vi.fn();

vi.mock("./store.js", () => ({
  insertRun: (...args: unknown[]) => mockInsertRun(...args),
  updateRun: (...args: unknown[]) => mockUpdateRun(...args),
  getRun: vi.fn(),
  listRuns: vi.fn(),
  deleteRun: vi.fn(),
}));

vi.mock("../event-bus/bus.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

import { startRun, updateRunProgress, completeRun } from "./registry.js";

function stubRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    owner: "boni@local",
    title: "Test run",
    step: undefined,
    percent: null,
    status: "running",
    metadata: undefined,
    startedAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("progress registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startRun inserts and emits run.progress.started", async () => {
    mockInsertRun.mockResolvedValue(stubRun({ title: "Triage inbox" }));

    const run = await startRun({ owner: "boni@local", title: "Triage inbox" });

    expect(mockInsertRun).toHaveBeenCalledWith({
      owner: "boni@local",
      title: "Triage inbox",
    });
    expect(run.id).toBe("r-1");
    expect(mockEmit).toHaveBeenCalledWith(
      "run.progress.started",
      expect.objectContaining({
        runId: "r-1",
        title: "Triage inbox",
      }),
      { owner: "boni@local" },
    );
  });

  it("updateRunProgress emits run.progress.updated with new state", async () => {
    mockUpdateRun.mockResolvedValue(
      stubRun({ percent: 42, step: "Drafting 23/100" }),
    );

    const run = await updateRunProgress("r-1", "boni@local", {
      percent: 42,
      step: "Drafting 23/100",
    });

    expect(mockUpdateRun).toHaveBeenCalledWith("r-1", "boni@local", {
      percent: 42,
      step: "Drafting 23/100",
    });
    expect(run?.percent).toBe(42);
    expect(mockEmit).toHaveBeenCalledWith(
      "run.progress.updated",
      expect.objectContaining({
        runId: "r-1",
        percent: 42,
        step: "Drafting 23/100",
      }),
      { owner: "boni@local" },
    );
  });

  it("updateRunProgress returns null when the run does not exist", async () => {
    mockUpdateRun.mockResolvedValue(null);
    const run = await updateRunProgress("missing", "boni@local", {
      percent: 50,
    });
    expect(run).toBeNull();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("completeRun sets percent=100 on success and passes status through", async () => {
    mockUpdateRun.mockResolvedValue(
      stubRun({ percent: 100, status: "succeeded", completedAt: "x" }),
    );

    const run = await completeRun("r-1", "boni@local", "succeeded");

    expect(mockUpdateRun).toHaveBeenCalledWith(
      "r-1",
      "boni@local",
      expect.objectContaining({ status: "succeeded", percent: 100 }),
    );
    expect(run?.status).toBe("succeeded");
    expect(mockEmit).toHaveBeenCalledWith(
      "run.progress.updated",
      expect.objectContaining({ runId: "r-1", status: "succeeded" }),
      { owner: "boni@local" },
    );
  });

  it("completeRun with failed does not force percent to 100", async () => {
    mockUpdateRun.mockResolvedValue(stubRun({ status: "failed" }));

    await completeRun("r-1", "boni@local", "failed");

    expect(mockUpdateRun).toHaveBeenCalledWith(
      "r-1",
      "boni@local",
      expect.not.objectContaining({ percent: 100 }),
    );
  });
});
