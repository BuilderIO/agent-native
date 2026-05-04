import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetObservabilityOverview = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());

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

vi.mock("../server/auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("./store.js", () => ({
  getObservabilityOverview: (...args: unknown[]) =>
    mockGetObservabilityOverview(...args),
  getTraceSummaries: (...args: unknown[]) => mockGetTraceSummaries(...args),
  getTraceSummary: vi.fn(),
  getTraceSpansForRun: vi.fn(),
  getEvalsForRun: vi.fn(),
  insertFeedback: vi.fn(),
  getFeedback: vi.fn(),
  getFeedbackStats: vi.fn(),
  getSatisfactionScores: vi.fn(),
  getEvalStats: vi.fn(),
  listExperiments: vi.fn(),
  insertExperiment: vi.fn(),
  getExperiment: vi.fn(),
  updateExperiment: vi.fn(),
  getExperimentResults: vi.fn(),
}));

import { createObservabilityHandler } from "./routes.js";

function createEvent(path: string, method = "GET") {
  return {
    method,
    url: new URL(`http://app.test${path}`),
    context: {},
    _status: 200,
  };
}

describe("observability routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ email: "alice@example.com" });
    mockGetObservabilityOverview.mockResolvedValue({ runs: 0 });
    mockGetTraceSummaries.mockResolvedValue([]);
  });

  it("handles HEAD like GET for read endpoints", async () => {
    const handler = createObservabilityHandler() as any;

    await expect(handler(createEvent("/", "HEAD"))).resolves.toEqual({
      runs: 0,
    });

    expect(mockGetObservabilityOverview).toHaveBeenCalledWith(
      expect.any(Number),
      { userId: "alice@example.com" },
    );
  });

  it("clamps invalid trace limits before reaching the store", async () => {
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/traces?limit=-1&since=123"));

    expect(mockGetTraceSummaries).toHaveBeenCalledWith({
      sinceMs: 123,
      limit: 100,
      userId: "alice@example.com",
    });
  });
});
