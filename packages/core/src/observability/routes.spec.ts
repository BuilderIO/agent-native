import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetOrgContext = vi.hoisted(() => vi.fn());
const mockGetObservabilityOverview = vi.hoisted(() => vi.fn());
const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockInsertFeedback = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() => vi.fn());
const mockReadBodyWithSizeLimit = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetFeedbackStats = vi.hoisted(() => vi.fn());
const mockPromoteTraceEvalFromStore = vi.hoisted(() => vi.fn());
const mockListExperimentsPage = vi.hoisted(() => vi.fn());
const mockResolveThreadAccess = vi.hoisted(() => vi.fn());
const mockIsOrgMember = vi.hoisted(() => vi.fn());

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

vi.mock("../org/membership.js", () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

vi.mock("../chat-threads/store.js", () => ({
  resolveThreadAccess: (...args: unknown[]) => mockResolveThreadAccess(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => undefined,
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: unknown[]) => mockReadBody(...args),
  readBodyWithSizeLimit: (...args: unknown[]) =>
    mockReadBodyWithSizeLimit(...args),
}));

vi.mock("../tracking/registry.js", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("./actions/promote-trace-eval.js", () => ({
  promoteTraceEvalFromStore: (...args: unknown[]) =>
    mockPromoteTraceEvalFromStore(...args),
  PROMOTE_TRACE_EVAL_BODY_LIMIT: 24_000,
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
  listExperimentsPageResult: (...args: unknown[]) =>
    mockListExperimentsPage(...args),
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
    mockResolveThreadAccess.mockImplementation(
      async (_user: string, threadId: string) => ({ id: threadId }),
    );
    mockIsOrgMember.mockResolvedValue(true);
    mockListExperimentsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
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

    await expect(handler(event)).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(event._status).toBe(200);
  });

  it("passes an experiment page cursor and bounded limit to the store", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NATIVE_EXPERIMENT_ADMIN_EMAILS", "alice@example.com");
    const handler = createObservabilityHandler() as any;
    const page = {
      items: [{ id: "exp-1" }],
      nextCursor: { createdAt: 123, id: "exp-1" },
      hasMore: true,
    };
    mockListExperimentsPage.mockResolvedValue(page);

    await expect(
      handler(
        createEvent("/experiments?limit=25&beforeCreatedAt=123&beforeId=exp-7"),
      ),
    ).resolves.toEqual(page);

    expect(mockListExperimentsPage).toHaveBeenCalledWith({
      limit: 25,
      before: { createdAt: 123, id: "exp-7" },
    });
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

  describe("resolving the run a vote is about", () => {
    const summaries = [
      {
        runId: "run-no-org",
        threadId: "thread-no-org",
        userId: "alice@example.com",
        orgId: null,
        model: "gpt-5.6-terra",
      },
      {
        runId: "run-other-org",
        threadId: "thread-other-org",
        userId: "alice@example.com",
        orgId: "org-b",
        model: "gpt-5.6-terra",
      },
      {
        runId: "run-active-org",
        threadId: "thread-active-org",
        userId: "alice@example.com",
        orgId: "org-a",
        model: "gpt-5.6-terra",
      },
      {
        runId: "run-of-bob",
        threadId: "thread-of-bob",
        userId: "bob@example.com",
        orgId: "org-a",
        model: "gpt-5.6-terra",
      },
    ];

    beforeEach(() => {
      // The store's own scoping: every given filter must match.
      mockGetTraceSummary.mockImplementation(
        async (runId: string, opts: { userId?: string; orgId?: string } = {}) =>
          summaries.find(
            (summary) =>
              summary.runId === runId &&
              (opts.userId == null || summary.userId === opts.userId) &&
              (opts.orgId == null || summary.orgId === opts.orgId),
          ) ?? null,
      );
    });

    it.each([
      ["recorded with no org", "run-no-org", "thread-no-org", "org-a"],
      [
        "recorded under another org",
        "run-other-org",
        "thread-other-org",
        "org-b",
      ],
    ])(
      "accepts a vote on the caller's own run %s",
      async (_label, runId, threadId, orgId) => {
        mockReadBody.mockResolvedValue({
          threadId,
          runId,
          feedbackType: "thumbs_down",
        });
        const handler = createObservabilityHandler() as any;
        const event = createEvent("/feedback", "POST");

        await expect(handler(event)).resolves.toEqual({
          id: expect.any(String),
        });

        expect(event._status).toBe(200);
        expect(mockInsertFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            runId,
            threadId,
            orgId,
            userId: "alice@example.com",
          }),
        );
      },
    );

    it("attaches the run's org only while the caller is still a member of it", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-other-org",
        runId: "run-other-org",
        feedbackType: "thumbs_down",
      });
      const handler = createObservabilityHandler() as any;

      await handler(createEvent("/feedback", "POST"));

      expect(mockIsOrgMember).toHaveBeenCalledWith(
        "org-b",
        "alice@example.com",
      );
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-other-org", orgId: "org-b" }),
      );
    });

    it("still saves a vote on a run from an org the caller has left, without that org", async () => {
      mockIsOrgMember.mockResolvedValue(false);
      mockReadBody.mockResolvedValue({
        threadId: "thread-other-org",
        runId: "run-other-org",
        feedbackType: "thumbs_down",
        value: "wrong answer",
      });
      const handler = createObservabilityHandler() as any;
      const event = createEvent("/feedback", "POST");

      await expect(handler(event)).resolves.toEqual({
        id: expect.any(String),
      });

      expect(event._status).toBe(200);
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-other-org",
          threadId: "thread-other-org",
          orgId: null,
          userId: "alice@example.com",
        }),
      );
      expect(mockTrack).toHaveBeenCalledOnce();
    });

    it("keeps the active org for a run with no org or in the active org without a membership lookup", async () => {
      const handler = createObservabilityHandler() as any;
      for (const [runId, threadId] of [
        ["run-no-org", "thread-no-org"],
        ["run-active-org", "thread-active-org"],
      ]) {
        mockReadBody.mockResolvedValue({
          threadId,
          runId,
          feedbackType: "thumbs_up",
        });
        await handler(createEvent("/feedback", "POST"));
      }

      expect(mockIsOrgMember).not.toHaveBeenCalled();
      expect(mockInsertFeedback).toHaveBeenCalledTimes(2);
      for (const [entry] of mockInsertFeedback.mock.calls) {
        expect(entry).toMatchObject({ orgId: "org-a" });
      }
    });

    it("rejects a vote on another user's run before insertion", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-of-bob",
        runId: "run-of-bob",
        feedbackType: "thumbs_down",
        value: "wrong answer",
      });
      const handler = createObservabilityHandler() as any;
      const event = createEvent("/feedback", "POST");

      await expect(handler(event)).resolves.toEqual({
        error: "Trace not found",
      });

      expect(event._status).toBe(404);
      expect(mockInsertFeedback).not.toHaveBeenCalled();
      expect(mockTrack).not.toHaveBeenCalled();
    });
  });

  it("records feedback for a run whose trace was never persisted, unlinked and marked", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-1",
      runId: "run-never-persisted",
      messageSeq: 2,
      feedbackType: "thumbs_down",
      value: { messageId: "msg-1", value: "negative", reason: "said done" },
    });
    mockGetTraceSummary.mockResolvedValue(null);
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/feedback", "POST");

    await expect(handler(event)).resolves.toEqual({
      id: expect.any(String),
      traceMissing: true,
    });

    expect(event._status).toBe(200);
    expect(mockGetTraceSummary).toHaveBeenNthCalledWith(
      1,
      "run-never-persisted",
      { userId: "alice@example.com" },
    );
    expect(mockGetTraceSummary).toHaveBeenNthCalledWith(
      2,
      "run-never-persisted",
    );
    const [entry] = mockInsertFeedback.mock.calls[0];
    expect(entry).toMatchObject({
      runId: null,
      threadId: "thread-1",
      feedbackType: "thumbs_down",
      orgId: "org-a",
      source: "chat",
    });
    expect(JSON.parse(entry.value)).toEqual({
      messageId: "msg-1",
      value: "negative",
      reason: "said done",
      traceMissing: true,
      unverifiedRunId: "run-never-persisted",
    });
    expect(mockTrack.mock.calls[0][1]).toMatchObject({
      sentiment: "negative",
      trace_missing: true,
      unverified_run_id: "run-never-persisted",
      run_id: null,
    });
  });

  it("treats a run id past the bound as unverifiable instead of looking up its prefix", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-1",
      runId: "r".repeat(5_000),
      feedbackType: "thumbs_down",
      value: { reason: "said done" },
    });
    // The default summary answers any lookup, so a prefix lookup would link it.
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/feedback", "POST");

    await expect(handler(event)).resolves.toEqual({
      id: expect.any(String),
      traceMissing: true,
    });

    expect(event._status).toBe(200);
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
    const [entry] = mockInsertFeedback.mock.calls[0];
    expect(entry).toMatchObject({ runId: null, threadId: "thread-1" });
    expect(JSON.parse(entry.value).unverifiedRunId).toBe("r".repeat(200));
    expect(mockTrack.mock.calls[0][1].unverified_run_id).toBe("r".repeat(200));
    expect(mockTrack.mock.calls[0][1].run_id).toBeNull();
  });

  it("still looks up a run id exactly at the bound", async () => {
    mockReadBody.mockResolvedValue({
      runId: "r".repeat(200),
      feedbackType: "thumbs_up",
    });
    const handler = createObservabilityHandler() as any;

    await handler(createEvent("/feedback", "POST"));

    expect(mockGetTraceSummary).toHaveBeenCalledWith("r".repeat(200), {
      userId: "alice@example.com",
    });
  });

  describe("trusting the thread a vote names", () => {
    it("saves a never-persisted run's vote on a thread the caller cannot access, unlinked and marked", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-of-bob",
        runId: "run-never-persisted",
        feedbackType: "thumbs_down",
        value: { reason: "said done" },
      });
      mockGetTraceSummary.mockResolvedValue(null);
      mockResolveThreadAccess.mockResolvedValue(null);
      const handler = createObservabilityHandler() as any;
      const event = createEvent("/feedback", "POST");

      await expect(handler(event)).resolves.toEqual({
        id: expect.any(String),
        traceMissing: true,
      });

      expect(event._status).toBe(200);
      const [entry] = mockInsertFeedback.mock.calls[0];
      expect(entry).toMatchObject({ runId: null, threadId: null });
      expect(JSON.parse(entry.value)).toEqual({
        reason: "said done",
        traceMissing: true,
        unverifiedRunId: "run-never-persisted",
        unverifiedThreadId: "thread-of-bob",
      });
      expect(mockTrack.mock.calls[0][1]).toMatchObject({
        thread_id: null,
        run_id: null,
        trace_missing: true,
        unverified_run_id: "run-never-persisted",
        unverified_thread_id: "thread-of-bob",
      });
      expect(mockTrack.mock.calls[0][1].$ai_session_id).toBeUndefined();
    });

    it("saves feedback naming a thread the caller cannot access when no run is named, unlinked and marked", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-of-bob",
        feedbackType: "text",
        value: "the answer cited the wrong doc",
      });
      mockResolveThreadAccess.mockResolvedValue(null);
      const handler = createObservabilityHandler() as any;
      const event = createEvent("/feedback", "POST");

      await expect(handler(event)).resolves.toEqual({
        id: expect.any(String),
        traceMissing: true,
      });

      expect(event._status).toBe(200);
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: null,
          threadId: null,
          value: "the answer cited the wrong doc",
        }),
      );
      expect(mockTrack.mock.calls[0][1]).toMatchObject({
        thread_id: null,
        trace_missing: true,
        unverified_thread_id: "thread-of-bob",
      });
      expect(mockTrack.mock.calls[0][1]).not.toHaveProperty(
        "unverified_run_id",
      );
    });

    it("answers a thread that does not exist exactly like one the caller cannot access", async () => {
      const handler = createObservabilityHandler() as any;
      const answers: unknown[] = [];
      for (const threadId of ["thread-of-bob", "thread-does-not-exist"]) {
        mockReadBody.mockResolvedValue({
          threadId,
          runId: "run-never-persisted",
          feedbackType: "thumbs_down",
        });
        mockGetTraceSummary.mockResolvedValue(null);
        mockResolveThreadAccess.mockResolvedValue(null);
        const event = createEvent("/feedback", "POST");
        const result = await handler(event);
        answers.push({
          status: event._status,
          keys: Object.keys(result).sort(),
          traceMissing: result.traceMissing,
          stored: {
            ...mockInsertFeedback.mock.calls.at(-1)![0],
            id: undefined,
            createdAt: undefined,
          },
        });
      }

      expect(answers[0]).toMatchObject({
        status: 200,
        keys: ["id", "traceMissing"],
        traceMissing: true,
        stored: { runId: null, threadId: null },
      });
      expect(answers[1]).toEqual(answers[0]);
    });

    it("links a never-persisted run's vote to a thread the caller can view", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-1",
        runId: "run-never-persisted",
        feedbackType: "thumbs_down",
      });
      mockGetTraceSummary.mockResolvedValue(null);
      const handler = createObservabilityHandler() as any;

      await handler(createEvent("/feedback", "POST"));

      expect(mockResolveThreadAccess).toHaveBeenCalledWith(
        "alice@example.com",
        "thread-1",
        "viewer",
        { orgId: "org-a" },
      );
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ runId: null, threadId: "thread-1" }),
      );
    });

    it("links a thread the caller can view without marking the vote", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-1",
        feedbackType: "thumbs_up",
        value: { reason: "great" },
      });
      const handler = createObservabilityHandler() as any;

      await expect(handler(createEvent("/feedback", "POST"))).resolves.toEqual({
        id: expect.any(String),
      });

      const [entry] = mockInsertFeedback.mock.calls[0];
      expect(entry.threadId).toBe("thread-1");
      expect(JSON.parse(entry.value)).toEqual({ reason: "great" });
      expect(mockTrack.mock.calls[0][1]).toMatchObject({
        thread_id: "thread-1",
      });
      expect(mockTrack.mock.calls[0][1]).not.toHaveProperty("trace_missing");
      expect(mockTrack.mock.calls[0][1]).not.toHaveProperty(
        "unverified_thread_id",
      );
    });

    it("carries the unverified id of a thread it cannot link", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "t".repeat(200),
        feedbackType: "thumbs_down",
        value: { reason: "wrong" },
      });
      mockResolveThreadAccess.mockResolvedValue(null);
      const handler = createObservabilityHandler() as any;

      await handler(createEvent("/feedback", "POST"));

      const [entry] = mockInsertFeedback.mock.calls[0];
      expect(entry.threadId).toBeNull();
      expect(JSON.parse(entry.value).unverifiedThreadId).toBe("t".repeat(200));
      expect(mockTrack.mock.calls[0][1].unverified_thread_id).toBe(
        "t".repeat(200),
      );
    });

    it("stores no thread, and checks none, when the vote names none", async () => {
      mockReadBody.mockResolvedValue({
        feedbackType: "text",
        value: "general feedback",
      });
      const handler = createObservabilityHandler() as any;

      await handler(createEvent("/feedback", "POST"));

      expect(mockResolveThreadAccess).not.toHaveBeenCalled();
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: null }),
      );
    });

    it("does not re-check the thread of a run the caller's own trace already vouches for", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "thread-1",
        runId: "run-1",
        feedbackType: "thumbs_up",
      });
      const handler = createObservabilityHandler() as any;

      await handler(createEvent("/feedback", "POST"));

      expect(mockResolveThreadAccess).not.toHaveBeenCalled();
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", threadId: "thread-1" }),
      );
    });

    it("looks up a thread id exactly at the bound", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "t".repeat(200),
        feedbackType: "thumbs_up",
      });
      const handler = createObservabilityHandler() as any;

      await handler(createEvent("/feedback", "POST"));

      expect(mockResolveThreadAccess).toHaveBeenCalledWith(
        "alice@example.com",
        "t".repeat(200),
        "viewer",
        { orgId: "org-a" },
      );
      expect(mockInsertFeedback.mock.calls[0][0].threadId).toBe(
        "t".repeat(200),
      );
    });

    it("treats a thread id past the bound as unverifiable instead of looking up its prefix", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "t".repeat(5_000),
        feedbackType: "thumbs_down",
        value: { reason: "wrong" },
      });
      // The default access check grants any id, so a prefix lookup would link it.
      const handler = createObservabilityHandler() as any;
      const event = createEvent("/feedback", "POST");

      await expect(handler(event)).resolves.toEqual({
        id: expect.any(String),
        traceMissing: true,
      });

      expect(event._status).toBe(200);
      expect(mockResolveThreadAccess).not.toHaveBeenCalled();
      const [entry] = mockInsertFeedback.mock.calls[0];
      expect(entry.threadId).toBeNull();
      expect(JSON.parse(entry.value).unverifiedThreadId).toBe("t".repeat(200));
      expect(mockTrack.mock.calls[0][1].unverified_thread_id).toBe(
        "t".repeat(200),
      );
    });

    it("does not let a thread id past the bound match its prefix on the caller's own run", async () => {
      mockReadBody.mockResolvedValue({
        threadId: "t".repeat(300),
        runId: "run-1",
        feedbackType: "thumbs_up",
      });
      mockGetTraceSummary.mockResolvedValue({
        runId: "run-1",
        threadId: "t".repeat(200),
        userId: "alice@example.com",
        orgId: "org-a",
        model: "gpt-5.6-terra",
      });
      const handler = createObservabilityHandler() as any;
      const event = createEvent("/feedback", "POST");

      await expect(handler(event)).resolves.toEqual({
        error: "Trace not found",
      });

      expect(event._status).toBe(404);
      expect(mockInsertFeedback).not.toHaveBeenCalled();
    });
  });

  it("rejects an oversized feedback value instead of storing it", async () => {
    mockReadBody.mockResolvedValue({
      threadId: "thread-1",
      feedbackType: "text",
      value: "x".repeat(20_001),
    });
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/feedback", "POST");

    await expect(handler(event)).resolves.toEqual({
      error: "Feedback value is too large",
    });

    expect(event._status).toBe(413);
    expect(mockInsertFeedback).not.toHaveBeenCalled();
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
    expect(mockTrack).toHaveBeenCalledOnce();
    const [name, properties] = mockTrack.mock.calls[0];
    expect(name).toBe("$ai_feedback");
    expect(properties).toMatchObject({
      feedback_type: "category",
      run_id: "run-1",
      $ai_trace_id: "run-1",
    });
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

  it("promotes a completed trace through POST /traces/:runId/promote", async () => {
    mockReadBodyWithSizeLimit.mockResolvedValue({
      reviewedPrompt: "show active users daily",
      reviewedHistory: [{ role: "user", text: "compare last month" }],
      mustContain: "30 days",
      datasetName: "weekly analytics dataset",
    });
    mockPromoteTraceEvalFromStore.mockResolvedValue({
      sourceRunId: "run-1",
      dataset: { id: "ds-1", name: "from-trace:run-1" },
      eval: { name: "from-trace:run-1", scorers: [] },
    });
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/traces/run-1/promote", "POST");

    await expect(handler(event)).resolves.toMatchObject({
      sourceRunId: "run-1",
      dataset: { id: "ds-1" },
    });
    expect(mockPromoteTraceEvalFromStore).toHaveBeenCalledWith(
      {
        runId: "run-1",
        reviewedPrompt: "show active users daily",
        reviewedHistory: [{ role: "user", text: "compare last month" }],
        mustContain: "30 days",
        datasetName: "weekly analytics dataset",
      },
      { userId: "alice@example.com" },
    );
  });

  it("maps a typed promote failure onto the HTTP status", async () => {
    const { ActionContractError } = await import("../action.js");
    mockReadBodyWithSizeLimit.mockResolvedValue({});
    mockPromoteTraceEvalFromStore.mockRejectedValue(
      new ActionContractError("Run is not completed", {
        errorCode: "run_not_completed",
        statusCode: 409,
      }),
    );
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/traces/run-1/promote", "POST");

    await expect(handler(event)).resolves.toEqual({
      error: "run_not_completed",
      message: "Run is not completed",
    });
    expect(event._status).toBe(409);
  });

  it("rejects an unreadable promote body instead of promoting", async () => {
    mockReadBodyWithSizeLimit.mockRejectedValue(new Error("Unexpected token"));
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/traces/run-1/promote", "POST");

    await expect(handler(event)).resolves.toEqual({
      error: "Invalid JSON body",
    });
    expect(event._status).toBe(400);
    expect(mockPromoteTraceEvalFromStore).not.toHaveBeenCalled();
  });

  it("rejects a non-object promote body instead of promoting", async () => {
    mockReadBodyWithSizeLimit.mockResolvedValue(["not", "options"]);
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/traces/run-1/promote", "POST");

    await expect(handler(event)).resolves.toEqual({
      error: "Invalid JSON body",
    });
    expect(event._status).toBe(400);
    expect(mockPromoteTraceEvalFromStore).not.toHaveBeenCalled();
  });

  it("rejects oversized promote bodies with HTTP 413 before promotion", async () => {
    mockReadBodyWithSizeLimit.mockRejectedValue(
      Object.assign(new Error("Request body too large"), { statusCode: 413 }),
    );
    const handler = createObservabilityHandler() as any;
    const event = createEvent("/traces/run-1/promote", "POST");

    await expect(handler(event)).resolves.toEqual({
      error: "Request body too large",
    });
    expect(event._status).toBe(413);
    expect(mockReadBodyWithSizeLimit).toHaveBeenCalledWith(
      event,
      expect.any(Number),
    );
    expect(mockPromoteTraceEvalFromStore).not.toHaveBeenCalled();
  });
});
