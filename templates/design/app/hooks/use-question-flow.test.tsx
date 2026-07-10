// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreClientMocks = vi.hoisted(() => ({
  useGuidedQuestionFlow: vi.fn(),
  formatGuidedAnswersForAgent: vi.fn((answers: Record<string, unknown>) =>
    JSON.stringify(answers),
  ),
}));

vi.mock("@agent-native/core/client", () => coreClientMocks);

const agentChatMocks = vi.hoisted(() => ({
  sendToDesignAgentChat: vi.fn(
    (_opts: { message: string; tabId?: string; newTab?: boolean }) =>
      "generated-tab-id",
  ),
}));

vi.mock("@/lib/agent-chat", () => agentChatMocks);

import { useQuestionFlow } from "./use-question-flow";

let latestHook: ReturnType<typeof useQuestionFlow> | null = null;

function Probe(props: {
  designId?: string;
  continuationTabId?: string | null;
  onContinue?: (tabId: string) => void;
}) {
  latestHook = useQuestionFlow(props.designId, {
    continuationTabId: props.continuationTabId,
    onContinue: props.onContinue,
  });
  return null;
}

async function renderProbe(props: {
  designId?: string;
  continuationTabId?: string | null;
  onContinue?: (tabId: string) => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe {...props} />);
  });
  return {
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("useQuestionFlow sendContinuation tab tracking", () => {
  const clearMock = vi.fn();

  beforeEach(() => {
    clearMock.mockClear();
    agentChatMocks.sendToDesignAgentChat.mockClear();
    agentChatMocks.sendToDesignAgentChat.mockImplementation(
      () => "generated-tab-id",
    );
    coreClientMocks.useGuidedQuestionFlow.mockReturnValue({
      payload: null,
      questions: null,
      title: undefined,
      description: undefined,
      skipLabel: undefined,
      submitLabel: undefined,
      clear: clearMock,
      // These are intentionally shadowed by useQuestionFlow's own
      // handleSubmit/handleSkip — see the hook's inline comment.
      handleSubmit: vi.fn(),
      handleSkip: vi.fn(),
    });
  });

  it("always requests newTab so the returned tabId matches the thread that actually receives the message, even with no prior continuation tab", async () => {
    const onContinue = vi.fn();
    const { cleanup } = await renderProbe({
      designId: "design-1",
      continuationTabId: null,
      onContinue,
    });

    await act(async () => {
      latestHook!.handleSubmit({ q1: "answer" });
    });

    expect(agentChatMocks.sendToDesignAgentChat).toHaveBeenCalledTimes(1);
    const call = agentChatMocks.sendToDesignAgentChat.mock.calls[0]![0];
    // Regression guard: without `newTab: true` here, the message would be
    // posted to whichever tab is currently active while the caller is told
    // a different, never-actually-used tabId — desyncing generation tracking
    // (false "stopped, please retry" toasts; completion never detected).
    expect(call.newTab).toBe(true);
    expect(call.tabId).toBeUndefined();
    expect(onContinue).toHaveBeenCalledWith("generated-tab-id");
    expect(clearMock).toHaveBeenCalledTimes(1);

    await cleanup();
  });

  it("reuses the tracked continuation tab id while still requesting newTab", async () => {
    const onContinue = vi.fn();
    const { cleanup } = await renderProbe({
      designId: "design-1",
      continuationTabId: "existing-tab",
      onContinue,
    });

    await act(async () => {
      latestHook!.handleSkip();
    });

    expect(agentChatMocks.sendToDesignAgentChat).toHaveBeenCalledTimes(1);
    const call = agentChatMocks.sendToDesignAgentChat.mock.calls[0]![0];
    expect(call.newTab).toBe(true);
    expect(call.tabId).toBe("existing-tab");
    expect(onContinue).toHaveBeenCalledWith("generated-tab-id");

    await cleanup();
  });
});
