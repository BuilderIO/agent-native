import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetObservabilityOverview = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockInsertFeedback = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());

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

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
}));

vi.mock("../tracking/registry.js", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("./store.js", () => ({
  getObservabilityOverview: (...args: unknown[]) =>
    mockGetObservabilityOverview(...args),
  getTraceSummaries: (...args: unknown[]) => mockGetTraceSummaries(...args),
  getTraceSummary: (...args: unknown[]) => mockGetTraceSummary(...args),
  getTraceSpansForRun: vi.fn(),
  getEvalsForRun: vi.fn(),
  insertFeedback: (...args: unknown[]) => mockInsertFeedback(...args),
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ email: "alice@example.com" });
    mockGetObservabilityOverview.mockResolvedValue({ runs: 0 });
    mockGetTraceSummaries.mockResolvedValue([]);
    mockGetTraceSummary.mockResolvedValue(null);
    mockInsertFeedback.mockResolvedValue(undefined);
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

  it("fails closed for platform-wide experiment routes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NATIVE_EXPERIMENT_ADMIN_EMAILS", "");
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/experiments");

    await expect(handler(event)).resolves.toEqual({
      error: "Experiment administrator access required",
    });
    expect(event._status).toBe(403);
  });

  it("allows configured experiment administrators in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "AGENT_NATIVE_EXPERIMENT_ADMIN_EMAILS",
      "operator@example.com, alice@example.com",
    );
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/experiments");

    await expect(handler(event)).resolves.toBeUndefined();
    expect(event._status).toBe(200);
  });

  it.each([
    ["thumbs_up", "positive"],
    ["thumbs_down", "negative"],
  ] as const)(
    "tracks explicit %s sentiment with the user-scoped run model",
    async (feedbackType, sentiment) => {
      vi.stubEnv("AGENT_NATIVE_APP", "Agent Native Analytics");
      vi.stubEnv("AGENT_NATIVE_TEMPLATE", "analytics");
      mockReadBody.mockResolvedValue({
        threadId: "thread-1",
        runId: "run-1",
        messageSeq: 4,
        feedbackType,
        value: "must not be tracked",
      });
      mockGetTraceSummary.mockResolvedValue({ model: "gpt-5.6-terra" });
      const handler = createObservabilityHandler() as any;

      await expect(handler(createEvent("/feedback", "POST"))).resolves.toEqual({
        id: expect.any(String),
      });

      expect(mockGetTraceSummary).toHaveBeenCalledWith("run-1", {
        userId: "alice@example.com",
      });
      expect(mockTrack).toHaveBeenCalledWith(
        "$ai_feedback",
        {
          app: "agent-native-analytics",
          agent_native_app: "agent-native-analytics",
          template: "analytics",
          agent_native_template: "analytics",
          source: "agent_observability",
          sentiment,
          feedback_type: feedbackType,
          run_id: "run-1",
          thread_id: "thread-1",
          model: "gpt-5.6-terra",
          $ai_trace_id: "run-1",
          $ai_session_id: "thread-1",
          $ai_model: "gpt-5.6-terra",
        },
        { userId: "alice@example.com" },
      );
      const trackedProperties = mockTrack.mock.calls[0][1];
      expect(trackedProperties).not.toHaveProperty("value");
      expect(trackedProperties).not.toHaveProperty("messageSeq");
      expect(trackedProperties).not.toHaveProperty("content");
    },
  );

  it("does not double-count a thumbs-down category as sentiment", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-1",
      runId: "run-1",
      messageSeq: 4,
      feedbackType: "category",
      value: "Inaccurate",
    });
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/feedback", "POST"));

    expect(mockInsertFeedback).toHaveBeenCalledOnce();
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
