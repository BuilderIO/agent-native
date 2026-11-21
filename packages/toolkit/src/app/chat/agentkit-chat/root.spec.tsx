// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentKitRootProps } from "../../agentkit/react/root.js";
import { CoreAgentKitRoot } from "./root.js";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  nativeUpload: vi.fn(),
  getUploadDriver: vi.fn(),
  rootProps: null as AgentKitRootProps | null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }),
}));

vi.mock("@agent-native/core/client/agentkit-chat/transport", () => ({
  getAgentNativeAgentKitUploadDriver: mocks.getUploadDriver,
  clearAgentNativeAgentKitUploads: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

vi.mock("../../agentkit/react/root.js", () => ({
  AgentKitRoot: (props: AgentKitRootProps) => {
    mocks.rootProps = props;
    return null;
  },
}));

const transport = {
  async startRun() {
    return { runId: "run-1" };
  },
  async *subscribeToRun() {},
  async cancelRun() {},
};

describe("CoreAgentKitRoot", () => {
  beforeEach(() => {
    mocks.callAction.mockReset();
    mocks.nativeUpload.mockReset();
    mocks.getUploadDriver.mockReset();
    mocks.rootProps = null;
  });

  it("loads run usage through the framework action when the host passes no loader", async () => {
    const usage = {
      durationMs: 1_000,
      billing: {
        providerCostUsd: null,
        providerCostSource: null,
        builderCredits: 1,
        builderCreditsSource: "reported",
        incomplete: false,
      },
    };
    mocks.callAction.mockResolvedValue(usage);
    renderToStaticMarkup(
      <CoreAgentKitRoot transport={transport} threadId="thread-1" />,
    );
    const signal = new AbortController().signal;

    await expect(
      mocks.rootProps?.loadRunUsage?.({ runId: "run-1", signal }),
    ).resolves.toEqual(usage);
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-usage-run",
      { runId: "run-1", scope: "me" },
      { method: "GET", signal },
    );
    expect(mocks.rootProps?.labels).toMatchObject({
      regenerateResponse: "agentChat.common.retry",
      runCreditsUsed: "agentChat.message.creditsUsed",
      suggestedActions: "agentChat.composer.suggestedActions",
    });
  });

  it("localizes the same AgentKit copy as the sidebar chat", () => {
    renderToStaticMarkup(
      <CoreAgentKitRoot transport={transport} threadId="thread-1" />,
    );

    expect(mocks.rootProps?.labels).toMatchObject({
      agentDelegated: "agentChat.agent.delegated",
      agentWorking: "agentChat.agent.working",
      tasksProgress: "agentChat.activity.tasksProgress",
      negativeFeedback: expect.stringMatching(/^agentChat\./),
      queueSendNow: expect.stringMatching(/^agentChat\./),
      question: "agentChat.guided.question",
      threadLoadFailed: "agentChat.message.threadLoadFailed",
      composerPlaceholder: "agentChat.composer.newChatPlaceholder",
    });
  });

  it("reports the model the run's calls recorded, and none for the store's unknown", async () => {
    renderToStaticMarkup(
      <CoreAgentKitRoot transport={transport} threadId="thread-1" />,
    );
    const load = () =>
      mocks.rootProps?.loadRunUsage?.({
        runId: "run-1",
        signal: new AbortController().signal,
      });
    mocks.callAction.mockResolvedValueOnce({
      durationMs: null,
      billing: null,
      model: "claude-sonnet-5-5",
    });
    await expect(load()).resolves.toMatchObject({ model: "claude-sonnet-5-5" });
    mocks.callAction.mockResolvedValueOnce({
      durationMs: null,
      billing: null,
      model: "unknown",
    });
    await expect(load()).resolves.toMatchObject({ model: null });
    mocks.callAction.mockResolvedValueOnce(null);
    await expect(load()).resolves.toBeNull();
  });

  it("names models by their catalog short name", () => {
    renderToStaticMarkup(
      <CoreAgentKitRoot transport={transport} threadId="thread-1" />,
    );
    const format = mocks.rootProps?.formatModelName;
    expect(format?.("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(format?.("gpt-6-luna")).toBe("GPT-6 Luna");
    // A model the catalog does not know keeps its id.
    expect(format?.("my-custom-model")).toBe("my-custom-model");
  });

  it("localizes a non-retryable Builder reconnect upload error", async () => {
    mocks.getUploadDriver.mockReturnValue(mocks.nativeUpload);
    mocks.nativeUpload.mockRejectedValue(
      Object.assign(new Error("untrusted"), {
        code: "upload_builder_oauth_reauthorization_required",
        status: 503,
        retryable: false,
      }),
    );
    renderToStaticMarkup(
      <CoreAgentKitRoot transport={transport} threadId="thread-1" />,
    );
    await expect(
      mocks.rootProps?.clientOptions?.upload?.(
        { uploadId: "id", method: "POST", url: "/upload" },
        {
          name: "file",
          mediaType: "text/plain",
          size: 1,
          body: new Blob(["x"]),
        },
      ),
    ).rejects.toMatchObject({
      message: "agentChat.composer.uploadBuilderReconnect",
      code: "upload_builder_oauth_reauthorization_required",
      status: 503,
      retryable: false,
    });
  });

  it("keeps a host's own usage loader", () => {
    const loadRunUsage = vi.fn();
    renderToStaticMarkup(
      <CoreAgentKitRoot
        transport={transport}
        threadId="thread-1"
        loadRunUsage={loadRunUsage}
      />,
    );
    expect(mocks.rootProps?.loadRunUsage).toBe(loadRunUsage);
  });
});
