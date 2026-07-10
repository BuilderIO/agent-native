import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSignScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn(() => "signed-job-token"),
);

vi.mock("@agent-native/core/server", () => ({
  AGENT_BACKGROUND_PROCESSOR_FIELD: "__agentNativeProcessor",
  AGENT_BACKGROUND_PROCESSOR_ROUTE: "route",
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD: "__agentNativeProcessorRoute",
  dispatchPathTargetsNetlifyBackgroundFunction: (path: string) =>
    path.startsWith("/.netlify/functions/"),
  resolveDurableBackgroundDispatchPath: (fallbackPath: string) =>
    process.env.NETLIFY === "true"
      ? "/.netlify/functions/server-agent-background"
      : fallbackPath,
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
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://clips.example/api/_agent-native-background/post-finalize-worker",
      expect.objectContaining({
        body: JSON.stringify({
          recordingId: "rec-3",
          kind: "transcript",
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
});
