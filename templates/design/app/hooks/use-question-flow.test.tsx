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

vi.mock("@agent-native/core/client/agent-chat", () => coreClientMocks);

const agentChatMocks = vi.hoisted(() => ({
  sendToDesignAgentChat: vi.fn(
    (_opts: { message: string; tabId?: string; newTab?: boolean }) =>
      "generated-tab-id",
  ),
}));

vi.mock("@/lib/agent-chat", () => agentChatMocks);

import { useQuestionFlow } from "./use-question-flow";

let latestHook: ReturnType<typeof useQuestionFlow> | null = null;

interface ProbeProps {
  designId?: string;
  continuationTabId?: string | null;
  onContinue?: (tabId: string) => void;
  model?: string;
  engine?: string;
  /**
   * Stand-in for the caller's ref: starts null and is replaced with a fresh
   * object after mount, so a render-time read genuinely sees nothing.
   */
  selectionRef?: { current: { model?: string; engine?: string } | null };
}

function Probe(props: ProbeProps) {
  latestHook = useQuestionFlow(props.designId, {
    continuationTabId: props.continuationTabId,
    onContinue: props.onContinue,
    getModelSelection: () => {
      if (props.selectionRef) return props.selectionRef.current;
      return props.model || props.engine
        ? { model: props.model, engine: props.engine }
        : null;
    },
  });
  return null;
}

async function renderProbe(props: ProbeProps) {
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

  // The continuation is the turn that actually generates. It must re-send the
  // selection the design was started with: a fresh thread has no override, and
  // a reused thread loses its in-memory one across a reload.
  it("carries the starting model selection into the continuation", async () => {
    const { cleanup } = await renderProbe({
      designId: "design-1",
      continuationTabId: null,
      model: "gpt-5-6-luna",
      engine: "builder",
    });

    await act(async () => {
      latestHook!.handleSubmit({ q1: "answer" });
    });

    const call = agentChatMocks.sendToDesignAgentChat.mock.calls[0]![0] as {
      model?: string;
      engine?: string;
    };
    expect(call.model).toBe("gpt-5-6-luna");
    expect(call.engine).toBe("builder");

    await cleanup();
  });

  // The caller's source is a ref filled by the generation kickoff effect, which
  // runs after the render that wires this hook up. Snapshotting a value during
  // render captured the pre-kickoff null and sent no model at all.
  it("reads the selection at send time, not at render time", async () => {
    const selectionRef: {
      current: { model?: string; engine?: string } | null;
    } = { current: null };
    const { cleanup } = await renderProbe({
      designId: "design-1",
      continuationTabId: null,
      selectionRef,
    });

    // Filled after mount with no re-render, exactly as the generation kickoff
    // effect fills the caller's ref.
    selectionRef.current = { model: "gpt-5-6-terra", engine: "builder" };

    await act(async () => {
      latestHook!.handleSubmit({ q1: "answer" });
    });

    const call = agentChatMocks.sendToDesignAgentChat.mock.calls[0]![0] as {
      model?: string;
      engine?: string;
    };
    expect(call.model).toBe("gpt-5-6-terra");
    expect(call.engine).toBe("builder");

    await cleanup();
  });

  it("omits model keys entirely when the design was started without a selection", async () => {
    const { cleanup } = await renderProbe({
      designId: "design-1",
      continuationTabId: null,
    });

    await act(async () => {
      latestHook!.handleSkip();
    });

    const call = agentChatMocks.sendToDesignAgentChat.mock.calls[0]![0] as {
      model?: string;
      engine?: string;
    };
    expect("model" in call).toBe(false);
    expect("engine" in call).toBe(false);

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
