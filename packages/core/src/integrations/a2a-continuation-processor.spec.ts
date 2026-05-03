import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { A2AContinuation } from "./a2a-continuations-store.js";
import type { PlatformAdapter } from "./types.js";

const claimA2AContinuationMock = vi.hoisted(() => vi.fn());
const claimA2AContinuationDeliveryMock = vi.hoisted(() => vi.fn());
const completeA2AContinuationMock = vi.hoisted(() => vi.fn());
const failA2AContinuationMock = vi.hoisted(() => vi.fn());
const getA2AContinuationMock = vi.hoisted(() => vi.fn());
const rescheduleA2AContinuationMock = vi.hoisted(() => vi.fn());
const getTaskMock = vi.hoisted(() => vi.fn());
const signA2ATokenMock = vi.hoisted(() =>
  vi.fn(async () => "signed-a2a-token"),
);
const A2AClientMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function A2AClient() {
    return { getTask: getTaskMock };
  }),
);

vi.mock("./a2a-continuations-store.js", () => ({
  claimA2AContinuation: claimA2AContinuationMock,
  claimA2AContinuationDelivery: claimA2AContinuationDeliveryMock,
  claimDueA2AContinuations: vi.fn(async () => []),
  completeA2AContinuation: completeA2AContinuationMock,
  failA2AContinuation: failA2AContinuationMock,
  getA2AContinuation: getA2AContinuationMock,
  rescheduleA2AContinuation: rescheduleA2AContinuationMock,
}));

vi.mock("../a2a/client.js", () => ({
  A2AClient: A2AClientMock,
  signA2AToken: signA2ATokenMock,
}));

vi.mock("./internal-token.js", () => ({
  signInternalToken: vi.fn(() => "signed-internal-token"),
}));

function continuation(
  overrides: Partial<A2AContinuation> = {},
): A2AContinuation {
  const now = Date.now();
  return {
    id: "cont-1",
    integrationTaskId: "task-1",
    platform: "slack",
    externalThreadId: "C123:123.456",
    incoming: {
      platform: "slack",
      externalThreadId: "C123:123.456",
      text: "make a deck",
      timestamp: 1,
      platformContext: { channelId: "C123", threadTs: "123.456" },
    },
    placeholderRef: null,
    ownerEmail: "alice+qa@agent-native.test",
    orgId: null,
    agentName: "Slides",
    agentUrl: "https://slides.agent-native.test",
    a2aTaskId: "a2a-task-1",
    a2aAuthToken: null,
    status: "processing",
    attempts: 1,
    nextCheckAt: 1,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

function adapter(sendResponse = vi.fn(async () => undefined)): PlatformAdapter {
  return {
    platform: "slack",
    label: "Slack",
    getRequiredEnvKeys: () => [],
    handleVerification: async () => ({ handled: false }),
    verifyWebhook: async () => true,
    parseIncomingMessage: async () => null,
    sendResponse,
    sendMessageToTarget: async () => undefined,
    formatAgentResponse: (text) => ({ text, platformContext: {} }),
    getStatus: async () => ({
      platform: "slack",
      label: "Slack",
      enabled: true,
      configured: true,
    }),
  };
}

describe("A2A continuation processor", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      APP_URL: "https://dispatch.agent-native.test",
    };
    getA2AContinuationMock.mockImplementation(async (id: string) =>
      continuation({ id, status: "pending" }),
    );
    completeA2AContinuationMock.mockResolvedValue(undefined);
    failA2AContinuationMock.mockResolvedValue(undefined);
    rescheduleA2AContinuationMock.mockResolvedValue(undefined);
    claimA2AContinuationDeliveryMock.mockImplementation(async (id: string) =>
      continuation({ id, status: "delivering" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "/deck/deck-qa" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("dispatches without aborting a long-running processor request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { dispatchA2AContinuation } =
      await import("./a2a-continuation-processor.js");

    const dispatch = dispatchA2AContinuation(
      "cont-long",
      "https://dispatch.agent-native.test",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://dispatch.agent-native.test/_agent-native/integrations/process-a2a-continuation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ continuationId: "cont-long" }),
      }),
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).signal).toBe(
      undefined,
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await dispatch;
  });

  it("logs when the continuation processor route rejects dispatch", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("bad continuation token", {
            status: 401,
            statusText: "Unauthorized",
          }),
      ),
    );
    const { dispatchA2AContinuation } =
      await import("./a2a-continuation-processor.js");

    await dispatchA2AContinuation(
      "cont-rejected",
      "https://dispatch.agent-native.test",
    );

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "A2A continuation cont-rejected processor dispatch returned HTTP 401 Unauthorized: bad continuation token",
      ),
    );
  });

  it("posts completed remote task text and marks the continuation completed", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks unverified completed production artifact URLs before posting continuations", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: "The Design agent returned https://design.agent-native.com/design/design_fake",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("could not verify the design URL"),
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain("design_fake");
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("allows completed continuation artifact URLs with downstream proof blocks", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: [
                "Design ready: https://design.agent-native.com/design/design_real",
                "",
                "Artifacts:",
                "- Design: https://design.agent-native.com/design/design_real (ID: design_real, 1 file)",
              ].join("\n"),
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "https://design.agent-native.com/design/design_real",
        ),
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "could not verify",
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("leaves completion failures in delivery for stale retry recovery", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    completeA2AContinuationMock
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db unavailable"));
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(completeA2AContinuationMock).toHaveBeenCalledTimes(3);
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("marking it completed failed"),
      expect.any(Error),
    );
  });

  it("does not post completed text when another processor already claimed delivery", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    claimA2AContinuationDeliveryMock.mockResolvedValueOnce(null);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(claimA2AContinuationDeliveryMock).toHaveBeenCalledWith("cont-1");
    expect(sendResponse).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("does not bypass the store claim for an in-flight delivery", async () => {
    const sendResponse = vi.fn(async () => undefined);
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({
        status: "delivering",
        updatedAt: Date.now(),
      }),
    );
    claimA2AContinuationMock.mockResolvedValueOnce(null);
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(claimA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(getTaskMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("reuses opaque bearer tokens stored on the continuation", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ a2aAuthToken: "original-opaque-a2a-token" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "original-opaque-a2a-token",
      { requestTimeoutMs: 25_000 },
    );
    expect(signA2ATokenMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("re-signs instead of replaying a stored A2A JWT", async () => {
    process.env.A2A_SECRET = "shared-a2a-secret";
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ a2aAuthToken: "old.jwt.token" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "alice+qa@agent-native.test",
      undefined,
      undefined,
      { expiresIn: "30m", preferGlobalSecret: true },
    );
    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "signed-a2a-token",
      { requestTimeoutMs: 25_000 },
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("preserves an originally unsigned A2A call when polling a continuation", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ a2aAuthToken: "" }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(A2AClientMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      undefined,
      { requestTimeoutMs: 25_000 },
    );
    expect(signA2ATokenMock).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });

  it("notifies the platform when the remote task fails", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The deck export failed" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The Slides agent could not finish this request: The deck export failed",
        ),
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
    expect(failA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      "The deck export failed",
    );
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("describes downstream LLM credential failures without naming a raw env var", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValueOnce({
      id: "a2a-task-1",
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "ANTHROPIC_API_KEY is not set" }],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain("needs an LLM connection");
    expect(sentText).toContain("Connect an LLM provider or Builder");
    expect(sentText).not.toContain("ANTHROPIC_API_KEY");
    expect(failA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      "ANTHROPIC_API_KEY is not set",
    );
  });

  it("backs off a still-working remote task without chaining self-dispatches", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 12 }),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await processing;

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      60_000,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("delivers a verified recoverable artifact from a still-working remote task", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        message: {
          role: "agent",
          metadata: { agentNativeRecoverableArtifacts: true },
          parts: [
            {
              type: "text",
              text: "Artifacts:\n- Deck: /deck/deck-qa (ID: deck-qa)",
            },
          ],
        },
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await processing;

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "https://slides.agent-native.test/deck/deck-qa",
        ),
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
    expect(completeA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(rescheduleA2AContinuationMock).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("treats aborted task polling as transient until the remote work deadline", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 99 }),
    );
    getTaskMock.mockRejectedValueOnce(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      60_000,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats A2A token rejection during polling as transient until the remote work deadline", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    getTaskMock.mockRejectedValueOnce(
      new Error(
        'A2A request failed (401): {"error":{"message":"Invalid or expired A2A token"}}',
      ),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      60_000,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats Netlify loop-protection 508s as transient until the remote work deadline", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 99 }),
    );
    getTaskMock.mockRejectedValueOnce(
      new Error("A2A request failed (508): loop detected"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(failA2AContinuationMock).not.toHaveBeenCalled();
    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      60_000,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a friendly timeout when task polling aborts after the remote work deadline", async () => {
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 99, createdAt: Date.now() - 10 * 60_000 - 1 }),
    );
    getTaskMock.mockRejectedValueOnce(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain(
      "The Slides agent could not finish this request: Timed out polling the Slides A2A task a2a-task-1 after 10 minutes",
    );
    expect(sentText).not.toContain("This operation was aborted");
    expect(failA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      expect.stringContaining(
        "Timed out polling the Slides A2A task a2a-task-1 after 10 minutes",
      ),
    );
  });

  it("waits until a redispatched continuation is due before claiming it", async () => {
    vi.useFakeTimers();
    const dueAt = Date.now() + 5_000;
    const sendResponse = vi.fn(async () => undefined);
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "pending", nextCheckAt: dueAt }),
    );
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "pending", nextCheckAt: dueAt }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(claimA2AContinuationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await processing;

    expect(claimA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://slides.agent-native.test/deck/deck-qa",
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
  });

  it("does not claim continuations that are scheduled far in the future", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => undefined);
    getA2AContinuationMock.mockResolvedValueOnce(
      continuation({ status: "pending", nextCheckAt: Date.now() + 30_000 }),
    );
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(claimA2AContinuationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await processing;

    expect(claimA2AContinuationMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("notifies the platform when a remote task exceeds the continuation age limit", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(async () => undefined);
    claimA2AContinuationMock.mockResolvedValueOnce(
      continuation({ attempts: 20, createdAt: Date.now() - 10 * 60_000 - 1 }),
    );
    getTaskMock.mockResolvedValue({
      id: "a2a-task-1",
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
    });
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await processing;

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The Slides agent could not finish this request: Remote A2A task a2a-task-1 did not complete within 10 minutes",
        ),
      }),
      expect.any(Object),
      { placeholderRef: undefined },
    );
    expect(failA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      "Remote A2A task a2a-task-1 did not complete within 10 minutes",
    );
  });

  it("reschedules through the retry job when the platform send fails", async () => {
    const sendResponse = vi.fn(async () => {
      throw new Error("slack unavailable");
    });
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    await processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      60_000,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });

  it("reschedules through the retry job when the platform send hangs", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn(() => new Promise<void>(() => {}));
    claimA2AContinuationMock.mockResolvedValueOnce(continuation());
    const { processA2AContinuationById } =
      await import("./a2a-continuation-processor.js");

    const processing = processA2AContinuationById("cont-1", {
      adapters: new Map([["slack", adapter(sendResponse)]]),
    });

    await vi.advanceTimersByTimeAsync(12_000);
    await processing;

    expect(rescheduleA2AContinuationMock).toHaveBeenCalledWith(
      "cont-1",
      60_000,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });
});
