// @vitest-environment happy-dom

/**
 * Drives the real assistant-ui runtime through a full turn and asserts the
 * streaming caret means exactly one thing: the agent is still producing this
 * answer. The unit specs cover the decision helpers; this one proves the
 * wiring from AgentTextStreamingProvider down to the rendered caret.
 */

import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantRuntime,
  useLocalRuntime,
  type AssistantRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentTextStreamingProvider,
  MarkdownText,
} from "./markdown-renderer.js";

const CARET = "[data-agent-streaming-cursor='true']";

type Part = Record<string, unknown>;

const idleAdapter: ChatModelAdapter = {
  async *run() {
    return;
  },
};

const TEXT: Part = { type: "text", text: "Rewriting slide three." };
const PENDING_TOOL: Part = {
  type: "tool-call",
  toolCallId: "tc_1",
  toolName: "update slide",
  argsText: "{}",
  args: {},
};
const DONE_TOOL: Part = { ...PENDING_TOOL, result: "ok" };
const FINAL_TEXT: Part = { type: "text", text: "Slide three is updated." };

function repoWith(parts: Part[]) {
  return {
    messages: [
      {
        parentId: null,
        message: {
          id: "u1",
          role: "user" as const,
          createdAt: new Date(0),
          content: [{ type: "text", text: "tighten slide three" }],
          status: { type: "complete", reason: "stop" },
          metadata: { custom: {} },
        },
      },
      {
        parentId: "u1",
        message: {
          id: "a1",
          role: "assistant" as const,
          createdAt: new Date(0),
          content: parts,
          status: { type: "complete", reason: "stop" },
          metadata: { custom: { runId: "run-1", turnId: "turn-1" } },
        },
      },
    ],
    headId: "a1",
  };
}

function AssistantMessageProbe() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts
        components={{
          Text: MarkdownText,
          tools: { Fallback: () => <span data-part="tool" /> },
        }}
      />
    </MessagePrimitive.Root>
  );
}

function Thread({
  runtimeRef,
}: {
  runtimeRef: { current: AssistantRuntime | null };
}) {
  runtimeRef.current = useAssistantRuntime();
  return (
    <ThreadPrimitive.Root>
      <ThreadPrimitive.Messages
        components={{
          UserMessage: () => <MessagePrimitive.Root />,
          AssistantMessage: AssistantMessageProbe,
        }}
      />
    </ThreadPrimitive.Root>
  );
}

function Harness({
  runActive,
  runtimeRef,
}: {
  runActive: boolean;
  runtimeRef: { current: AssistantRuntime | null };
}) {
  const runtime = useLocalRuntime(idleAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentTextStreamingProvider
        identity={{ runId: "run-1", turnId: "turn-1" }}
        streaming={runActive}
        runActive={runActive}
      >
        <Thread runtimeRef={runtimeRef} />
      </AgentTextStreamingProvider>
    </AssistantRuntimeProvider>
  );
}

describe("streaming caret across a full turn", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the caret only while the run is live, and never after it ends", async () => {
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    const render = async (runActive: boolean) => {
      await act(async () => {
        root.render(<Harness runActive={runActive} runtimeRef={runtimeRef} />);
      });
    };
    const importRepo = async (parts: Part[]) => {
      await act(async () => {
        (
          runtimeRef.current as unknown as {
            thread: { import: (data: unknown) => void };
          }
        ).thread.import(repoWith(parts));
      });
    };

    await render(true);

    await importRepo([TEXT]);
    expect(container.querySelector(CARET)).not.toBeNull();

    // A pending tool call trails the text: the tool card is the running
    // indicator, so the caret must not also sit above it.
    await importRepo([TEXT, PENDING_TOOL]);
    expect(container.querySelector(CARET)).toBeNull();

    // Text resumes after the tool: exactly one caret, on the trailing part.
    await importRepo([TEXT, DONE_TOOL, FINAL_TEXT]);
    expect(container.querySelectorAll(CARET)).toHaveLength(1);

    // The run ends. The retained turn identity still matches this message, so
    // this is the reported state — and the caret must be gone.
    await render(false);
    expect(container.querySelector(CARET)).toBeNull();
  });
});
