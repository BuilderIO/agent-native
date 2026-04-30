import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockGetRun = vi.fn();
const mockListRuns = vi.fn();
const mockDeleteRun = vi.fn();
const mockEmit = vi.fn();
const mockGetSession = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event.method ?? "GET",
  getQuery: (event: any) =>
    Object.fromEntries(event.url?.searchParams?.entries?.() ?? []),
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  createError: ({
    statusCode,
    statusMessage,
  }: {
    statusCode: number;
    statusMessage?: string;
  }) =>
    Object.assign(new Error(statusMessage ?? String(statusCode)), {
      statusCode,
    }),
}));

vi.mock("./store.js", () => ({
  insertRun: (...args: unknown[]) => mockInsertRun(...args),
  updateRun: (...args: unknown[]) => mockUpdateRun(...args),
  getRun: (...args: unknown[]) => mockGetRun(...args),
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  deleteRun: (...args: unknown[]) => mockDeleteRun(...args),
}));

vi.mock("../event-bus/bus.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

import { startRun, updateRunProgress, completeRun } from "./registry.js";
import { createProgressToolEntries } from "./actions.js";
import { createProgressHandler } from "./routes.js";

function createEvent(path: string, method = "GET") {
  return {
    method,
    url: new URL(`http://app.test${path}`),
    context: {},
    _status: 200,
  };
}

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
    mockGetSession.mockResolvedValue({ email: "boni@local" });
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

describe("progress routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ email: "boni@local" });
    mockGetRun.mockResolvedValue(stubRun());
    mockListRuns.mockResolvedValue([]);
  });

  it("handles HEAD like GET for read endpoints", async () => {
    const handler = createProgressHandler() as any;

    await expect(handler(createEvent("/r-1", "HEAD"))).resolves.toEqual(
      stubRun(),
    );

    expect(mockGetRun).toHaveBeenCalledWith("r-1", "boni@local");
  });

  it("clamps invalid list limits before reaching the store", async () => {
    const handler = createProgressHandler() as any;

    await handler(createEvent("/?limit=-1&active=true"));

    expect(mockListRuns).toHaveBeenCalledWith("boni@local", {
      activeOnly: true,
      limit: 50,
    });
  });

  it("short-circuits OPTIONS before auth", async () => {
    const handler = createProgressHandler() as any;
    mockGetSession.mockRejectedValue(new Error("should not authenticate"));

    const event = createEvent("/", "OPTIONS");
    await expect(handler(event)).resolves.toBe("");

    expect(event._status).toBe(204);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    const handler = createProgressHandler() as any;
    mockGetSession.mockResolvedValue(null);

    await expect(handler(createEvent("/"))).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe("progress action entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRuns.mockResolvedValue([]);
  });

  it("clamps invalid list limits before reaching the store", async () => {
    const tool = createProgressToolEntries(() => "boni@local")[
      "manage-progress"
    ];

    await tool.run({ action: "list", limit: -1 });

    expect(mockListRuns).toHaveBeenCalledWith("boni@local", {
      activeOnly: false,
      limit: 20,
    });
  });

  it("rejects invalid terminal statuses at runtime", async () => {
    const tool = createProgressToolEntries(() => "boni@local")[
      "manage-progress"
    ];

    await expect(
      tool.run({ action: "complete", runId: "r-1", status: "running" }),
    ).resolves.toMatch(/status must be/);

    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});
