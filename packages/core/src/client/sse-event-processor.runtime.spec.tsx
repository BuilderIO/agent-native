// @vitest-environment happy-dom

import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
  useAssistantState,
  useLocalRuntime,
  type AssistantRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSSEStream } from "./sse-event-processor.js";

function denseSseStream(eventCount: number): ReadableStream<Uint8Array> {
  const events = [
    ...Array.from({ length: eventCount }, (_, index) => ({
      type: "text",
      text: `${index}|`,
    })),
    { type: "done" },
  ];
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload.join("")));
      controller.close();
    },
  });
}

function RuntimeProbe({
  runtimeRef,
}: {
  runtimeRef: { current: AssistantRuntime | null };
}) {
  const messages = useAssistantState((state) => state.thread.messages);
  runtimeRef.current = useAssistantRuntime();
  return <output data-message-count={messages.length} />;
}

describe("SSE replay assistant-ui runtime boundary", () => {
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

  it("streams a dense replay through assistant-ui without a nested-update crash", async () => {
    let resolveRun: (() => void) | undefined;
    const runFinished = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const adapter: ChatModelAdapter = {
      async *run() {
        try {
          yield* readSSEStream(denseSseStream(60), [], { value: 0 }, undefined);
        } finally {
          resolveRun?.();
        }
      },
    };
    const runtimeRef: { current: AssistantRuntime | null } = {
      current: null,
    };

    act(() => {
      function RuntimeHarness() {
        const runtime = useLocalRuntime(adapter);
        return (
          <AssistantRuntimeProvider runtime={runtime}>
            <RuntimeProbe runtimeRef={runtimeRef} />
          </AssistantRuntimeProvider>
        );
      }

      root.render(<RuntimeHarness />);
    });

    await act(async () => {
      runtimeRef.current?.thread.append("hello");
      await runFinished;
    });

    expect(
      container.querySelector("output")?.getAttribute("data-message-count"),
    ).toBe("2");
    expect(runtimeRef.current?.thread.getState().messages.at(-1)).toMatchObject(
      {
        role: "assistant",
        status: { type: "complete" },
      },
    );
  });
});
