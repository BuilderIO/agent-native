import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSignScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn(() => "signed-job-token"),
);
const mockSendBackgroundQueueMessage = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@agent-native/core/server", () => ({
  AGENT_BACKGROUND_PROCESSOR_FIELD: "__agentNativeProcessor",
  AGENT_BACKGROUND_PROCESSOR_ROUTE: "route",
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD: "__agentNativeProcessorRoute",
  resolveBackgroundDispatchTarget: (options?: { fallbackPath?: string }) =>
    process.env.NETLIFY === "true"
      ? {
          kind: "http",
          path: "/.netlify/functions/server-agent-background",
          expectsBackgroundRuntime: true,
        }
      : process.env.AGENT_NATIVE_TEST_QUEUE_TRANSPORT === "true"
        ? { kind: "queue", expectsBackgroundRuntime: true }
        : {
            kind: "inline-route",
            path: options?.fallbackPath,
            expectsBackgroundRuntime: false,
          },
  sendBackgroundQueueMessage: mockSendBackgroundQueueMessage,
  signScopedAgentAccessToken: mockSignScopedAgentAccessToken,
}));

import {
  dispatchPostFinalizeJob,
  POST_FINALIZE_JOB_TOKEN_KIND,
  postFinalizeJobResourceId,
} from "./post-finalize-dispatch";

describe("post-finalize dispatch", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://clips.example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("dispatches a signed recording-scoped worker request", async () => {
    await dispatchPostFinalizeJob({
      recordingId: "rec-1",
      kind: "transcript",
    });

    expect(mockSignScopedAgentAccessToken).toHaveBeenCalledWith({
      resourceKind: POST_FINALIZE_JOB_TOKEN_KIND,
      resourceId: postFinalizeJobResourceId("rec-1", "transcript"),
      ttlSeconds: 600,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://clips.example/api/_agent-native-background/post-finalize-worker",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: "rec-1",
          kind: "transcript",
          token: "signed-job-token",
        }),
      }),
    );
  });

  it("preserves a configured app base path", async () => {
    vi.stubEnv("APP_URL", "https://workspace.example");
    vi.stubEnv("APP_BASE_PATH", "clips");

    await dispatchPostFinalizeJob({
      recordingId: "rec-2",
      kind: "seekable",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://workspace.example/clips/api/_agent-native-background/post-finalize-worker",
      expect.any(Object),
    );
  });

  it("passes durable retry metadata to the worker", async () => {
    await dispatchPostFinalizeJob({
      recordingId: "rec-3",
      kind: "transcript",
      delayMs: 5_000,
      retryAttempt: 1,
      regenerate: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://clips.example/api/_agent-native-background/post-finalize-worker",
      expect.objectContaining({
        body: JSON.stringify({
          recordingId: "rec-3",
          kind: "transcript",
          delayMs: 5_000,
          retryAttempt: 1,
          regenerate: true,
          token: "signed-job-token",
        }),
      }),
    );
  });

  it("waits for media verification dispatch acceptance without leaking the local option", async () => {
    await dispatchPostFinalizeJob({
      recordingId: "rec-media",
      kind: "media-ready",
      delayMs: 5_000,
      retryAttempt: 1,
      requireAccepted: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://clips.example/api/_agent-native-background/post-finalize-worker",
      expect.objectContaining({
        body: JSON.stringify({
          recordingId: "rec-media",
          kind: "media-ready",
          delayMs: 5_000,
          retryAttempt: 1,
          token: "signed-job-token",
        }),
      }),
    );
  });

  it("routes hosted Netlify work through the durable background function", async () => {
    vi.stubEnv("NETLIFY", "true");

    await dispatchPostFinalizeJob({
      recordingId: "rec-4",
      kind: "seekable",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://clips.example/.netlify/functions/server-agent-background",
      expect.objectContaining({
        body: JSON.stringify({
          recordingId: "rec-4",
          kind: "seekable",
          token: "signed-job-token",
          __agentNativeProcessor: "route",
          __agentNativeProcessorRoute:
            "/api/_agent-native-background/post-finalize-worker",
        }),
      }),
    );
  });

  it("falls back to the regular worker route if durable dispatch fast-fails", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await dispatchPostFinalizeJob({
      recordingId: "rec-5",
      kind: "transcript",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://clips.example/api/_agent-native-background/post-finalize-worker",
      expect.any(Object),
    );
  });

  it("hands the job to the queue transport, route processor and all", async () => {
    vi.stubEnv("AGENT_NATIVE_TEST_QUEUE_TRANSPORT", "true");

    await dispatchPostFinalizeJob({
      recordingId: "rec-6",
      kind: "transcript",
    });

    expect(mockSendBackgroundQueueMessage).toHaveBeenCalledWith({
      taskId: postFinalizeJobResourceId("rec-6", "transcript"),
      origin: "https://clips.example",
      body: {
        recordingId: "rec-6",
        kind: "transcript",
        token: "signed-job-token",
        __agentNativeProcessor: "route",
        __agentNativeProcessorRoute:
          "/api/_agent-native-background/post-finalize-worker",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the portable route when the queue refuses the send", async () => {
    vi.stubEnv("AGENT_NATIVE_TEST_QUEUE_TRANSPORT", "true");
    mockSendBackgroundQueueMessage.mockRejectedValueOnce(
      new Error("queue over quota"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await dispatchPostFinalizeJob({
        recordingId: "rec-7",
        kind: "transcript",
        requireAccepted: true,
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://clips.example/api/_agent-native-background/post-finalize-worker",
        expect.any(Object),
      );
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
