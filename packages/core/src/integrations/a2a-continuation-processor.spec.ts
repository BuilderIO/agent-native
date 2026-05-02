import { beforeEach, describe, expect, it, vi } from "vitest";
import type { A2AContinuation } from "./a2a-continuations-store.js";
import type { PlatformAdapter } from "./types.js";

const claimA2AContinuationMock = vi.hoisted(() => vi.fn());
const completeA2AContinuationMock = vi.hoisted(() => vi.fn());
const failA2AContinuationMock = vi.hoisted(() => vi.fn());
const rescheduleA2AContinuationMock = vi.hoisted(() => vi.fn());
const getTaskMock = vi.hoisted(() => vi.fn());

vi.mock("./a2a-continuations-store.js", () => ({
  claimA2AContinuation: claimA2AContinuationMock,
  claimDueA2AContinuations: vi.fn(async () => []),
  completeA2AContinuation: completeA2AContinuationMock,
  failA2AContinuation: failA2AContinuationMock,
  rescheduleA2AContinuation: rescheduleA2AContinuationMock,
}));

vi.mock("../a2a/client.js", () => ({
  A2AClient: vi.fn().mockImplementation(function A2AClient() {
    return { getTask: getTaskMock };
  }),
  signA2AToken: vi.fn(async () => "signed-a2a-token"),
}));

vi.mock("./internal-token.js", () => ({
  signInternalToken: vi.fn(() => "signed-internal-token"),
}));

function continuation(
  overrides: Partial<A2AContinuation> = {},
): A2AContinuation {
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
    status: "processing",
    attempts: 1,
    nextCheckAt: 1,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
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
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://dispatch.agent-native.test";
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

  it("reschedules and redispatches when the platform send fails", async () => {
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
      30_000,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://dispatch.agent-native.test/_agent-native/integrations/process-a2a-continuation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ continuationId: "cont-1" }),
      }),
    );
    expect(completeA2AContinuationMock).not.toHaveBeenCalled();
  });
});
