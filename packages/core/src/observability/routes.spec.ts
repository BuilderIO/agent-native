import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetOrgContext = vi.hoisted(() => vi.fn());
const mockGetObservabilityOverview = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockInsertFeedback = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetFeedbackStats = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
  getMethod: (event: any) => event.method ?? "GET",
  getQuery: (event: any) =>
    Object.fromEntries(event.url?.searchParams?.entries?.() ?? []),
  setResponseStatus: (event: any, status: number) => {
    event._status = status;
  },
  setResponseHeader: (event: any, name: string, value: string) => {
    event.responseHeaders ??= {};
    event.responseHeaders[name.toLowerCase()] = value;
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

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: unknown[]) => mockGetOrgContext(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => undefined,
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
  getFeedback: (...args: unknown[]) => mockGetFeedback(...args),
  getFeedbackStats: (...args: unknown[]) => mockGetFeedbackStats(...args),
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
    headers: {},
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
    mockGetOrgContext.mockResolvedValue({ orgId: "org-a", role: "admin" });
    mockGetObservabilityOverview.mockResolvedValue({ runs: 0 });
    mockGetTraceSummaries.mockResolvedValue([]);
    mockGetTraceSummary.mockResolvedValue({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
      orgId: "org-a",
      model: "gpt-5.6-terra",
    });
    mockInsertFeedback.mockResolvedValue(true);
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

  it("keeps generic feedback reads user-scoped for non-admins", async () => {
    mockGetOrgContext.mockResolvedValue({ orgId: "org-a", role: "member" });
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/feedback?since=123"));
    await handler(createEvent("/feedback/stats?since=123"));

    expect(mockGetFeedback).toHaveBeenCalledWith({
      sinceMs: 123,
      limit: 100,
      feedbackType: undefined,
      source: "chat",
      userId: "alice@example.com",
      orgId: "org-a",
    });
    expect(mockGetFeedbackStats).toHaveBeenCalledWith(123, {
      userId: "alice@example.com",
      orgId: "org-a",
    });
  });

  it("keeps member feedback scoped to the user when no active org exists", async () => {
    mockGetOrgContext.mockResolvedValue({ orgId: null, role: null });
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/feedback?since=123"));

    expect(mockGetFeedback).toHaveBeenCalledWith({
      sinceMs: 123,
      limit: 100,
      feedbackType: undefined,
      source: "chat",
      userId: "alice@example.com",
    });
  });

  it("propagates active-org lookup failures instead of converting them to 403", async () => {
    const failure = new Error("org context unavailable");
    mockGetOrgContext.mockRejectedValueOnce(failure);
    const handler = createObservabilityHandler() as any;

    await expect(handler(createEvent("/feedback"))).rejects.toBe(failure);
    expect(mockGetFeedback).not.toHaveBeenCalled();
  });

  it("scopes feedback audit reads to the active org", async () => {
    const handler = createObservabilityHandler() as any;
    const feedbackEvent = createEvent("/feedback?since=123");
    const statsEvent = createEvent("/feedback/stats?since=123");
    await handler(feedbackEvent);
    await handler(statsEvent);

    expect(mockGetFeedback).toHaveBeenCalledWith({
      sinceMs: 123,
      limit: 100,
      source: "chat",
      orgId: "org-a",
    });
    expect(mockGetFeedbackStats).toHaveBeenCalledWith(123, { orgId: "org-a" });
    expect(feedbackEvent.responseHeaders).toEqual({
      "cache-control": "private, no-store",
    });
    expect(statsEvent.responseHeaders).toEqual({
      "cache-control": "private, no-store",
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
      vi.stubEnv("AGENT_NATIVE_APP", "Agent-Native Analytics");
      vi.stubEnv("AGENT_NATIVE_TEMPLATE", "analytics");
      mockReadBody.mockResolvedValue({
        threadId: "thread-1",
        runId: "run-1",
        messageSeq: 4,
        feedbackType,
        value: "must not be tracked",
      });
      const handler = createObservabilityHandler() as any;

      await expect(handler(createEvent("/feedback", "POST"))).resolves.toEqual({
        id: expect.any(String),
      });

      expect(mockGetTraceSummary).toHaveBeenCalledWith("run-1", {
        userId: "alice@example.com",
        orgId: "org-a",
      });
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feedbackType,
          value: "must not be tracked",
          userId: "alice@example.com",
        }),
      );
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
          deployment_environment: "local",
        },
        { userId: "alice@example.com" },
      );
      const trackedProperties = mockTrack.mock.calls[0][1];
      expect(trackedProperties).not.toHaveProperty("value");
      expect(trackedProperties).not.toHaveProperty("messageSeq");
      expect(trackedProperties).not.toHaveProperty("content");
    },
  );

  it("rejects feedback for a run outside the active org before insertion", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-from-org-b",
      runId: "run-from-org-b",
      feedbackType: "thumbs_down",
      value: "wrong answer",
    });
    mockGetTraceSummary.mockResolvedValueOnce(null);
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/feedback", "POST");

    await expect(handler(event)).resolves.toEqual({ error: "Trace not found" });

    expect(event._status).toBe(404);
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-from-org-b", {
      userId: "alice@example.com",
      orgId: "org-a",
    });
    expect(mockInsertFeedback).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("rejects a thread that does not match the owned run", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-from-another-run",
      runId: "run-1",
      feedbackType: "thumbs_up",
    });
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/feedback", "POST");

    await expect(handler(event)).resolves.toEqual({ error: "Trace not found" });

    expect(event._status).toBe(404);
    expect(mockInsertFeedback).not.toHaveBeenCalled();
  });

  it("reports a category follow-up without counting it as a second sentiment", async () => {
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
    // The submission is visible...
    expect(mockTrack).toHaveBeenCalledOnce();
    const [name, properties] = mockTrack.mock.calls[0];
    expect(name).toBe("$ai_feedback");
    expect(properties).toMatchObject({
      feedback_type: "category",
      run_id: "run-1",
      $ai_trace_id: "run-1",
    });
    // ...but carries no sentiment: the thumbs-down it follows already counted.
    expect(properties).not.toHaveProperty("sentiment");
  });

  it("persists chat feedback to the authenticated org without ambient context", async () => {
    mockGetOrgContext.mockResolvedValue({ orgId: "org-a", role: "member" });
    mockReadBody.mockResolvedValue({
      feedbackType: "thumbs_up",
      runId: "run-1",
      threadId: "thread-1",
      orgId: "org-from-untrusted-body",
    });
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/feedback", "POST"));

    expect(mockInsertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-a", source: "chat" }),
    );
    expect(mockGetOrgContext).toHaveBeenCalledOnce();
  });

  it("reports free-text feedback, which previously emitted nothing", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-1",
      runId: "run-1",
      feedbackType: "text",
      value: "the answer cited the wrong doc",
    });
    const handler = createObservabilityHandler() as any;

    const event = createEvent("/feedback", "POST");
    event.headers["idempotency-key"] = "feedback-key-1";
    await handler(event);

    expect(mockInsertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackType: "text",
        value: "the answer cited the wrong doc",
        idempotencyKey: "feedback-key-1",
        userId: "alice@example.com",
      }),
    );
    expect(mockTrack).toHaveBeenCalledOnce();
    const [, properties] = mockTrack.mock.calls[0];
    expect(properties).toMatchObject({ feedback_type: "text" });
    expect(properties).not.toHaveProperty("sentiment");
    // The first-party event stays content-free; the text itself is persisted
    // and, when a survey is configured, sent as the survey response.
    expect(JSON.stringify(properties)).not.toContain("wrong doc");
  });

  it("skips analytics for a duplicate idempotent delivery", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-1",
      runId: "run-1",
      feedbackType: "text",
      value: "the answer cited the wrong doc",
    });
    mockInsertFeedback.mockResolvedValue(false);
    const event = createEvent("/feedback", "POST");
    event.headers["idempotency-key"] = "feedback-key-1";

    await expect((createObservabilityHandler() as any)(event)).resolves.toEqual(
      { id: expect.any(String) },
    );

    expect(mockInsertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "feedback-key-1" }),
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("passes a feedback type filter through to the SQL-backed list", async () => {
    mockGetFeedback.mockResolvedValue([]);
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/feedback?feedbackType=text&limit=25"));

    expect(mockGetFeedback).toHaveBeenCalledWith({
      sinceMs: expect.any(Number),
      limit: 25,
      feedbackType: "text",
      source: "chat",
      orgId: "org-a",
    });
  });
});
