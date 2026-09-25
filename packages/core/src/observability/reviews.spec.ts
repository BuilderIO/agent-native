import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTraceSummaries = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockGetFeedback = vi.hoisted(() => vi.fn());
const mockGetInstructionUpdates = vi.hoisted(() => vi.fn());
const mockIsOrgAdmin = vi.hoisted(() => vi.fn());
const mockGetOrgScopedThreadData = vi.hoisted(() => vi.fn());
const mockGetOrgScopedThreadTitles = vi.hoisted(() => vi.fn());
const mockGetOrgScopedReviewThreads = vi.hoisted(() => vi.fn());
const mockGetHumanReviewSummaries = vi.hoisted(() => vi.fn());
const mockGetHumanReviewSummariesForThreads = vi.hoisted(() => vi.fn());
const mockGetSuccessfulToolSpansForReview = vi.hoisted(() => vi.fn());
const mockGetRecentReviewRunsForThreads = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  MAX_REVIEW_TOOL_SPANS: 20,
  getOrgScopedThreadData: (...args: unknown[]) =>
    mockGetOrgScopedThreadData(...args),
  getOrgScopedThreadTitles: (...args: unknown[]) =>
    mockGetOrgScopedThreadTitles(...args),
  getOrgScopedReviewThreads: (...args: unknown[]) =>
    mockGetOrgScopedReviewThreads(...args),
  getHumanReviewSummaries: (...args: unknown[]) =>
    mockGetHumanReviewSummaries(...args),
  getHumanReviewSummariesForThreads: (...args: unknown[]) =>
    mockGetHumanReviewSummariesForThreads(...args),
  getSuccessfulToolSpansForReview: (...args: unknown[]) =>
    mockGetSuccessfulToolSpansForReview(...args),
  getRecentReviewRunsForThreads: (...args: unknown[]) =>
    mockGetRecentReviewRunsForThreads(...args),
  getTraceSummaries: (...args: unknown[]) => mockGetTraceSummaries(...args),
  getTraceSummary: (...args: unknown[]) => mockGetTraceSummary(...args),
  getFeedback: (...args: unknown[]) => mockGetFeedback(...args),
  getInstructionUpdates: (...args: unknown[]) =>
    mockGetInstructionUpdates(...args),
}));

vi.mock("../user-profile/store.js", () => ({
  getUserProfiles: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../server/org-admin.js", () => ({
  currentRequestUserIsOrgAdmin: (...args: unknown[]) => mockIsOrgAdmin(...args),
}));

import getObservabilityReviewApp from "./actions/get-observability-review-app.js";
import getObservabilityReviewDetail from "./actions/get-observability-review-detail.js";
import {
  getOutputReviewDetailForRun,
  getOutputReviewSummarySource,
  listOutputReviews,
} from "./reviews.js";

const scopedThread = (
  threadData: string,
  title: string | null = "A real thread",
) => ({
  ownerEmail: "alice@example.com",
  threadData,
  title,
  scopeType: null,
  scopeId: null,
  scopeLabel: null,
});

describe("listOutputReviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOrgAdmin.mockResolvedValue(true);
    const threadData = JSON.stringify({
      messages: [
        {
          message: {
            role: "user",
            content: "Summarize this",
            metadata: { custom: { submittedRunId: "run-1" } },
          },
        },
        {
          message: {
            role: "assistant",
            content: "Here is the summary.",
            metadata: { runId: "run-1" },
          },
        },
      ],
    });
    mockGetOrgScopedThreadData.mockResolvedValue(
      new Map([["thread-1", threadData]]),
    );
    mockGetOrgScopedReviewThreads.mockResolvedValue(
      new Map([["thread-1", scopedThread(threadData)]]),
    );
    mockGetTraceSummaries.mockResolvedValue([
      {
        runId: "run-1",
        threadId: "thread-1",
        userId: "alice@example.com",
        model: "test-model",
        createdAt: 123,
      },
    ]);
    mockGetTraceSummary.mockResolvedValue(null);
    mockGetOrgScopedThreadTitles.mockResolvedValue(
      new Map([["thread-1", "A real thread"]]),
    );
    mockGetHumanReviewSummaries.mockResolvedValue(new Map());
    mockGetHumanReviewSummariesForThreads.mockResolvedValue(new Map());
    mockGetRecentReviewRunsForThreads.mockResolvedValue([]);
    mockGetSuccessfulToolSpansForReview.mockResolvedValue([]);
    mockGetFeedback.mockResolvedValue([
      {
        id: "feedback-1",
        runId: "run-1",
        threadId: "thread-1",
        feedbackType: "text",
        value: "Keep the concise format",
        createdAt: 124,
      },
    ]);
    mockGetInstructionUpdates.mockResolvedValue([]);
  });

  it("pairs a run's ask and answer and groups human feedback", async () => {
    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        orgId: "org-a",
      }),
    ).resolves.toMatchObject([
      {
        runId: "run-1",
        threadTitle: "A real thread",
        summary: null,
        ask: "A real thread",
        answer: "Here is the summary.",
        hasInlineApp: false,
        feedback: [{ value: "Keep the concise format" }],
      },
    ]);
    expect(mockGetFeedback).toHaveBeenCalledWith({
      sinceMs: 0,
      limit: 40,
      orgId: "org-a",
      threadIds: ["thread-1"],
    });
    expect(mockGetInstructionUpdates).toHaveBeenCalledWith({
      sinceMs: 0,
      limit: 20,
      orgId: "org-a",
      threadIds: ["thread-1"],
    });
  });

  it("uses persisted summary data and excludes its own runs before list pagination", async () => {
    mockGetHumanReviewSummaries.mockResolvedValueOnce(
      new Map([
        [
          "run-1",
          {
            runId: "run-1",
            orgId: "org-a",
            ask: "Build a report",
            outcome: "Created the weekly dashboard",
            artifacts: [
              {
                appId: "analytics",
                artifactId: "dash-1",
                title: "Weekly dashboard",
                path: "/dashboards/dash-1",
              },
            ],
            createdBy: "admin@example.com",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      ]),
    );
    const [row] = await listOutputReviews({
      sinceMs: 0,
      limit: 10,
      orgId: "org-a",
    });
    expect(row).toMatchObject({
      threadTitle: "A real thread",
      summary: {
        ask: "Build a report",
        outcome: "Created the weekly dashboard",
        artifacts: [{ appId: "analytics", artifactId: "dash-1" }],
      },
      ask: "Build a report",
      answer: "Created the weekly dashboard",
    });
    expect(mockGetTraceSummaries).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-a",
        excludeSpanName: "agent_run:observability:human-review-summary",
        requireReviewContext: true,
      }),
    );
  });

  it("loads thread content and titles for multiple owners in one batch", async () => {
    mockGetTraceSummaries.mockResolvedValueOnce(
      ["alice", "bob", "carol"].map((owner, index) => ({
        runId: `run-${index + 1}`,
        threadId: `thread-${index + 1}`,
        userId: `${owner}@example.com`,
        model: "test-model",
        createdAt: 123 - index,
      })),
    );
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map(
        ["alice", "bob", "carol"].map((owner, index) => [
          `thread-${index + 1}`,
          {
            ownerEmail: `${owner}@example.com`,
            threadData: JSON.stringify({ messages: [] }),
            title: `${owner}'s thread`,
          },
        ]),
      ),
    );

    const rows = await listOutputReviews({
      sinceMs: 0,
      limit: 10,
      orgId: "org-a",
    });

    expect(rows).toHaveLength(3);
    expect(mockGetOrgScopedReviewThreads).toHaveBeenCalledTimes(1);
    expect(mockGetOrgScopedReviewThreads).toHaveBeenCalledWith("org-a", [
      { ownerEmail: "alice@example.com", threadId: "thread-1" },
      { ownerEmail: "bob@example.com", threadId: "thread-2" },
      { ownerEmail: "carol@example.com", threadId: "thread-3" },
    ]);
  });

  it("uses only a saved ask or real thread title and excludes empty/threadless rows", async () => {
    mockGetTraceSummaries.mockResolvedValueOnce([
      {
        runId: "no-title",
        threadId: "thread-empty",
        userId: "alice@example.com",
        model: "test-model",
        createdAt: 123,
      },
      {
        runId: "threadless",
        threadId: null,
        userId: "alice@example.com",
        model: "test-model",
        createdAt: 122,
      },
    ]);
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(new Map());
    mockGetHumanReviewSummariesForThreads.mockResolvedValueOnce(new Map());

    await expect(
      listOutputReviews({ sinceMs: 0, limit: 10, orgId: "org-a" }),
    ).resolves.toEqual([]);
  });

  it("keeps an org-scoped saved summary when its thread row is unavailable", async () => {
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(new Map());
    mockGetHumanReviewSummaries.mockResolvedValueOnce(
      new Map([
        [
          "run-1",
          {
            runId: "run-1",
            orgId: "org-a",
            ask: "Saved ask",
            outcome: "Saved outcome",
            artifacts: [],
            createdBy: "admin@example.com",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      ]),
    );

    await expect(
      listOutputReviews({ sinceMs: 0, limit: 10, orgId: "org-a" }),
    ).resolves.toMatchObject([
      { ask: "Saved ask", answer: "Saved outcome", threadTitle: "" },
    ]);
  });

  it("returns bounded, org-scoped thread and redacted tool evidence for summary generation", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
    });
    mockGetSuccessfulToolSpansForReview.mockResolvedValueOnce([
      {
        name: "create_design",
        metadata: {
          input: {
            designId: "design-42",
            api_key: "not-a-real-key",
            jwt: "fake-jwt-field",
            bearer: "fake-bearer-field",
            html: "<html>private app markup</html>",
            note: "private unstructured tool text",
            path: "data:image/png;base64,AAAA",
            route:
              "https://example.test/review?X-Amz-Signature=not-a-real-signature&X-Amz-Security-Token=fake-session-token&X-Amz-Credential=fake-credential&jwt=fake-jwt&cookie=fake-cookie-query&session=fake-session-query",
          },
          output:
            '{"designId":"design-json-43","title":"Published design","path":"https://storage.example.test/design?X-Amz-Signature=fake-presigned-signature","route":"data:text/plain,inline%20secret"}',
        },
      },
    ]);

    const source = await getOutputReviewSummarySource({
      runId: "run-1",
      orgId: "org-a",
    });
    expect(source).toMatchObject({
      found: true,
      threadTitle: "A real thread",
      threadEvidenceAvailable: true,
      toolEvidenceAvailable: true,
      toolEvidence: [
        {
          name: "create_design",
          status: "success",
          input: {
            designId: "design-42",
            api_key: "[REDACTED]",
            jwt: "[REDACTED]",
            bearer: "[REDACTED]",
            html: "[omitted]",
            note: "[omitted]",
            path: "[omitted data payload]",
            route:
              "https://example.test/review?X-Amz-Signature=[REDACTED]&X-Amz-Security-Token=[REDACTED]&X-Amz-Credential=[REDACTED]&jwt=[REDACTED]&cookie=[REDACTED]&session=[REDACTED]",
          },
          output: {
            designId: "design-json-43",
            title: "Published design",
            path: "[omitted]",
            route: "[omitted data payload]",
          },
        },
      ],
    });
    expect(JSON.stringify(source)).not.toContain("failed-design");
    expect(JSON.stringify(source)).not.toContain("not-a-real-signature");
    expect(JSON.stringify(source)).not.toContain("fake-session-token");
    expect(JSON.stringify(source)).not.toContain("fake-credential");
    expect(JSON.stringify(source)).not.toContain("fake-presigned-signature");
    expect(JSON.stringify(source)).not.toContain("inline%20secret");
    expect(JSON.stringify(source)).not.toContain("fake-jwt");
    expect(JSON.stringify(source)).not.toContain("fake-bearer-field");
    expect(JSON.stringify(source)).not.toContain("fake-cookie-query");
    expect(JSON.stringify(source)).not.toContain("fake-session-query");
    expect(mockGetSuccessfulToolSpansForReview).toHaveBeenCalledWith(
      "run-1",
      "org-a",
      20,
    );
    expect(mockGetOrgScopedReviewThreads).toHaveBeenCalledWith("org-a", [
      { ownerEmail: "alice@example.com", threadId: "thread-1" },
    ]);
  });

  it("keeps summary artifacts scoped to the selected run and redacts scope labels", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
    });
    const threadData = JSON.stringify({
      messages: [
        {
          message: {
            role: "user",
            content: "Create a design",
            metadata: { runId: "run-1" },
          },
        },
        {
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                name: "create_design",
                result: { designId: "design-run-1", title: "Run one" },
              },
            ],
            metadata: { runId: "run-1" },
          },
        },
        {
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                name: "create_design",
                result: { designId: "design-run-2", title: "Run two" },
              },
            ],
            metadata: { runId: "run-2" },
          },
        },
      ],
    });
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            ...scopedThread(threadData),
            scopeType: "design",
            scopeId: "design-scope",
            scopeLabel: "AWS_SECRET_ACCESS_KEY=fake-scope-secret",
          },
        ],
      ]),
    );

    const source = await getOutputReviewSummarySource({
      runId: "run-1",
      orgId: "org-a",
    });

    expect(source).toMatchObject({
      found: true,
      attachedArtifacts: [
        {
          artifactId: "design-scope",
          title: "AWS_SECRET_ACCESS_KEY=[REDACTED]",
        },
      ],
      toolEvidence: [
        {
          name: "create_design",
          output: { designId: "design-run-1", title: "Run one" },
        },
      ],
    });
    expect(JSON.stringify(source)).not.toContain("design-run-2");
    expect(JSON.stringify(source)).not.toContain("fake-scope-secret");
    expect(mockGetSuccessfulToolSpansForReview).not.toHaveBeenCalled();
  });

  it("redacts prefixed secrets across the bounded thread history", async () => {
    const standaloneJwt = ["eyJx", "e30", "signature"].join(".");
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
    });
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          scopedThread(
            JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: `AWS_SECRET_ACCESS_KEY=target-secret\nAuthorization: Basic fake-encoded-credential\naccessToken=fake-access-token\nclientSecret=fake-client-secret\nCookie: session=fake-cookie; refresh=fake-refresh\nSet-Cookie: session=fake-set-cookie; refresh=fake-set-cookie-two; Path=/\nAIzaEXAMPLE_NOT_A_REAL_KEY SG.EXAMPLE_ONLY.NOT_A_REAL_TOKEN xoxb-example-not-a-real-token AKIAEXAMPLE sk-proj-example sk-ant-example ${standaloneJwt} https://viewer:fake-url-password@example.test/review#access_token=fake-url-fragment`,
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content:
                      '{"AWS_SECRET_ACCESS_KEY":"json-secret","Authorization":"Basic fake-json-credential","accessToken":"fake-json-access-token","clientSecret":"fake-json-client-secret","Cookie":"fake-json-cookie","Set-Cookie":"fake-json-set-cookie"}',
                    metadata: { runId: "run-1" },
                  },
                },
                ...Array.from({ length: 45 }, (_, index) => ({
                  message: {
                    role: "user",
                    content: `neighbor-${index} AWS_SECRET_ACCESS_KEY=neighbor-secret`,
                    metadata: { runId: "run-2" },
                  },
                })),
              ],
            }),
            '{"AWS_SECRET_ACCESS_KEY":"title-secret"}',
          ),
        ],
      ]),
    );

    const source = await getOutputReviewSummarySource({
      runId: "run-1",
      orgId: "org-a",
    });

    expect(source).toMatchObject({
      found: true,
      threadTitle: '{"AWS_SECRET_ACCESS_KEY":"[REDACTED]"}',
    });
    expect(source.messages[0]).toEqual({
      role: "user",
      text: "AWS_SECRET_ACCESS_KEY=[REDACTED]\nAuthorization: [REDACTED]\naccessToken=[REDACTED]\nclientSecret=[REDACTED]\nCookie: [REDACTED]\nSet-Cookie: [REDACTED]\n[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] https://[REDACTED]@example.test/review#[REDACTED]",
    });
    expect(source.messages).toHaveLength(40);
    expect(
      source.messages.some((message) => message.text.startsWith("neighbor-")),
    ).toBe(true);
    expect(JSON.stringify(source)).not.toContain("neighbor-secret");
    expect(JSON.stringify(source)).not.toContain("target-secret");
    expect(JSON.stringify(source)).not.toContain("json-secret");
    expect(JSON.stringify(source)).not.toContain("title-secret");
    expect(JSON.stringify(source)).not.toContain("fake-encoded-credential");
    expect(JSON.stringify(source)).not.toContain("fake-json-credential");
    expect(JSON.stringify(source)).not.toContain("fake-access-token");
    expect(JSON.stringify(source)).not.toContain("fake-client-secret");
    expect(JSON.stringify(source)).not.toContain("fake-cookie");
    expect(JSON.stringify(source)).not.toContain("fake-set-cookie");
    expect(JSON.stringify(source)).not.toContain("AIzaEXAMPLE_NOT_A_REAL_KEY");
    expect(JSON.stringify(source)).not.toContain(
      "SG.EXAMPLE_ONLY.NOT_A_REAL_TOKEN",
    );
    expect(JSON.stringify(source)).not.toContain(
      "xoxb-example-not-a-real-token",
    );
    expect(JSON.stringify(source)).not.toContain("AKIAEXAMPLE");
    expect(JSON.stringify(source)).not.toContain("sk-proj-example");
    expect(JSON.stringify(source)).not.toContain("sk-ant-example");
    expect(JSON.stringify(source)).not.toContain("fake-refresh");
    expect(JSON.stringify(source)).not.toContain("fake-set-cookie-two");
    expect(JSON.stringify(source)).not.toContain("fake-json-access-token");
    expect(JSON.stringify(source)).not.toContain("fake-json-client-secret");
    expect(JSON.stringify(source)).not.toContain("fake-json-cookie");
    expect(JSON.stringify(source)).not.toContain("fake-json-set-cookie");
    expect(JSON.stringify(source)).not.toContain("fake-url-password");
    expect(JSON.stringify(source)).not.toContain("fake-url-fragment");
    expect(JSON.stringify(source)).not.toContain(standaloneJwt);
  });

  it("rejects oversized serialized thread data before parsing it", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
    });
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map([["thread-1", scopedThread("x".repeat(1_000_001))]]),
    );

    await expect(
      getOutputReviewSummarySource({ runId: "run-1", orgId: "org-a" }),
    ).rejects.toThrow("thread data exceeds the maximum size");
  });

  it("bounds metadata traversal before reading later fields", async () => {
    const input = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`field-${index}`, "value"]),
    );
    Object.defineProperty(input, "overflow", {
      enumerable: true,
      get() {
        throw new Error("read beyond evidence bounds");
      },
    });
    mockGetTraceSummary.mockResolvedValueOnce({ runId: "run-1" });
    mockGetSuccessfulToolSpansForReview.mockResolvedValueOnce([
      {
        name: "create_design",
        metadata: { input },
      },
    ]);

    await expect(
      getOutputReviewSummarySource({ runId: "run-1", orgId: "org-a" }),
    ).resolves.toMatchObject({
      found: true,
      toolEvidenceAvailable: true,
    });
  });

  it("keeps a saved inline MCP App with its run's answer", async () => {
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            ownerEmail: "alice@example.com",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "Show a chart" }],
                    metadata: { custom: { submittedRunId: "run-1" } },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: [
                      { type: "text", text: "Here is the chart." },
                      {
                        type: "tool-call",
                        mcpApp: {
                          serverId: "analytics",
                          toolName: "chart",
                          originalToolName: "chart",
                          resourceUri: "ui://chart",
                          toolInput: {},
                          toolResult: {},
                          tool: {
                            name: "chart-tool",
                            title: `Chart ${"x".repeat(140)}`,
                          },
                          resource: {
                            uri: "ui://chart",
                            mimeType: "text/html;profile=mcp-app",
                            text: "<html><body>Chart</body></html>",
                          },
                        },
                      },
                    ],
                    metadata: { runId: "run-1" },
                  },
                },
              ],
            }),
            title: "A real thread",
          },
        ],
      ]),
    );

    const rows = await listOutputReviews({
      sinceMs: 0,
      limit: 10,
      orgId: "org-a",
    });
    expect(rows).toMatchObject([
      {
        ask: "A real thread",
        answer: "Here is the chart.",
        hasInlineApp: true,
        inlineAppTitle: `Chart ${"x".repeat(114)}`,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("inlineApp");
  });

  it("fetches one saved app through the caller-scoped run and thread", async () => {
    const app = {
      serverId: "analytics",
      toolName: "chart",
      originalToolName: "chart",
      resourceUri: "ui://chart",
      toolInput: { range: "week" },
      toolResult: { total: 12 },
      resource: {
        uri: "ui://chart",
        mimeType: "text/html;profile=mcp-app",
        text: "<html><body>Chart</body></html>",
      },
    };
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
    });
    mockGetOrgScopedThreadData.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          JSON.stringify({
            messages: [
              {
                message: {
                  role: "user",
                  content: "Show a chart",
                  metadata: { runId: "run-1" },
                },
              },
              {
                message: {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: "The chart is ready.",
                    },
                    {
                      type: "tool-call",
                      mcpApp: app,
                    },
                  ],
                  metadata: { runId: "run-1" },
                },
              },
            ],
          }),
        ],
      ]),
    );

    await expect(
      getObservabilityReviewApp.run({ runId: "run-1" }, {
        userEmail: "alice@example.com",
        orgId: "org-a",
      } as any),
    ).resolves.toEqual(app);
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-1", {
      orgId: "org-a",
    });
    expect(mockGetOrgScopedThreadData).toHaveBeenCalledWith(
      "org-a",
      "alice@example.com",
      ["thread-1"],
    );
  });

  it("returns null when the run has no saved app and fails closed on inaccessible threads", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: null,
    });
    await expect(
      getObservabilityReviewApp.run({ runId: "run-1" }, {
        userEmail: "alice@example.com",
        orgId: "org-a",
      } as any),
    ).resolves.toBeNull();
    expect(mockGetOrgScopedThreadData).not.toHaveBeenCalled();

    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-2",
      threadId: "private-thread",
      userId: "alice@example.com",
    });
    mockGetOrgScopedThreadData.mockResolvedValueOnce(new Map());
    await expect(
      getObservabilityReviewApp.run({ runId: "run-2" }, {
        userEmail: "alice@example.com",
        orgId: "org-a",
      } as any),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires a signed-in user to fetch a saved app", async () => {
    await expect(
      getObservabilityReviewApp.run({ runId: "run-1" }, {} as any),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
  });

  it("does not return a thread owned by another user", async () => {
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(new Map());
    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        orgId: "org-a",
      }),
    ).resolves.toEqual([]);
  });

  it("does not cross-pair an unmatched run with another ask and answer", async () => {
    mockGetTraceSummaries.mockResolvedValueOnce([
      {
        runId: "run-missing",
        threadId: "thread-1",
        userId: "alice@example.com",
        model: "test-model",
        createdAt: 123,
      },
    ]);
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          {
            ownerEmail: "alice@example.com",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: "First ask",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "First answer",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "user",
                    content: "Second ask",
                    metadata: { runId: "run-2" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "Second answer",
                    metadata: { runId: "run-2" },
                  },
                },
              ],
            }),
            title: "A real thread",
          },
        ],
      ]),
    );

    await expect(
      listOutputReviews({
        sinceMs: 0,
        limit: 10,
        orgId: "org-a",
      }),
    ).resolves.toMatchObject([{ ask: "A real thread", answer: "" }]);
  });

  it("loads only the selected run's text transcript", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: "thread-1",
      userId: "alice@example.com",
    });
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(
      new Map([
        [
          "thread-1",
          scopedThread(
            JSON.stringify({
              messages: [
                {
                  message: {
                    role: "user",
                    content: "Neighbor question",
                    metadata: { runId: "run-2" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "Neighbor answer",
                    metadata: { runId: "run-2" },
                  },
                },
                {
                  message: {
                    role: "user",
                    content: "First question",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "First answer",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "user",
                    content: "Follow-up",
                    metadata: { runId: "run-1" },
                  },
                },
                {
                  message: {
                    role: "assistant",
                    content: "Final answer",
                    metadata: { runId: "run-1" },
                  },
                },
              ],
            }),
          ),
        ],
      ]),
    );

    await expect(
      getObservabilityReviewDetail.run({ runId: "run-1" }, {
        userEmail: "alice@example.com",
        orgId: "org-a",
      } as any),
    ).resolves.toMatchObject({
      app: null,
      messages: [
        { role: "user", text: "First question" },
        { role: "assistant", text: "First answer" },
        { role: "user", text: "Follow-up" },
        { role: "assistant", text: "Final answer" },
      ],
    });
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-1", {
      orgId: "org-a",
    });
    expect(mockGetOrgScopedReviewThreads).toHaveBeenCalledWith("org-a", [
      { ownerEmail: "alice@example.com", threadId: "thread-1" },
    ]);
  });

  it("returns an empty detail for a run without a thread and hides inaccessible runs", async () => {
    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-1",
      threadId: null,
    });
    await expect(
      getOutputReviewDetailForRun({
        runId: "run-1",
        orgId: "org-a",
      }),
    ).resolves.toMatchObject({ found: true, app: null, messages: [] });
    expect(mockGetOrgScopedThreadData).not.toHaveBeenCalled();

    mockGetTraceSummary.mockResolvedValueOnce({
      runId: "run-2",
      threadId: "private-thread",
      userId: "alice@example.com",
    });
    mockGetOrgScopedReviewThreads.mockResolvedValueOnce(new Map());
    await expect(
      getObservabilityReviewDetail.run({ runId: "run-2" }, {
        userEmail: "alice@example.com",
        orgId: "org-a",
      } as any),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("requires a signed-in user to load a review detail", async () => {
    await expect(
      getObservabilityReviewDetail.run({ runId: "run-1" }, {} as any),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
  });
});
