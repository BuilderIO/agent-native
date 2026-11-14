// @vitest-environment happy-dom

import {
  createAgentThreadState,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type { AgentMessage } from "@agent-native/agentkit/protocol";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat, AgentMessageView } from "./components.js";
import {
  AgentKitProvider,
  useAgentThreadSelector,
  type AgentKitRenderProps,
} from "./context.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function snapshotOf(thread: AgentThreadState, revision = 0): AgentKitSnapshot {
  return {
    connection: "connected",
    capabilities: {},
    capabilitiesStatus: "ready",
    threads: { [thread.id]: thread },
    revision,
  };
}

function observableController(initial: AgentKitSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getThread(threadId: string) {
      return snapshot.threads[threadId] ?? createAgentThreadState(threadId);
    },
    loadThread: vi.fn(async (threadId: string) =>
      controller.getThread(threadId),
    ),
    cancelRun: vi.fn(async () => undefined),
    resolveApproval: vi.fn(async () => undefined),
    uploadFiles: vi.fn(async () => []),
    invokeAction: vi.fn(async () => ({ invocationId: "invocation-1" })),
    submitFeedback: vi.fn(async () => undefined),
  } as unknown as AgentKitController;
  return {
    controller,
    update(next: AgentKitSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

async function flushIdleMounts() {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function conversation(
  turns: number,
  reply: (index: number) => AgentMessage["parts"] = (index) => [
    { type: "text", text: `Answer ${index}`, format: "markdown" },
  ],
): AgentMessage[] {
  return Array.from({ length: turns }, (_, index) => [
    {
      id: `user-${index}`,
      role: "user" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: `Question ${index}` }],
    },
    {
      id: `assistant-${index}`,
      role: "assistant" as const,
      status: "complete" as const,
      parts: reply(index),
    },
  ]).flat();
}

function threadWith(messages: AgentMessage[]): AgentThreadState {
  return { ...createAgentThreadState("thread-long"), messages };
}

function renderedMessageIds() {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-message-id]"),
    (element) => element.dataset.messageId,
  );
}

describe("long transcripts", () => {
  it("paints the newest rows first and mounts older rows in idle time", async () => {
    const messages = conversation(30);
    const store = observableController(snapshotOf(threadWith(messages)));
    await render(
      <AgentKitProvider controller={store.controller} threadId="thread-long">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const firstPaint = renderedMessageIds();
    expect(firstPaint).toHaveLength(20);
    expect(firstPaint.at(-1)).toBe("assistant-29");
    expect(firstPaint).not.toContain("user-0");

    await flushIdleMounts();
    expect(renderedMessageIds()).toEqual(messages.map((message) => message.id));
  });

  it("renders a short thread whole on the first paint", async () => {
    const messages = conversation(4);
    const store = observableController(snapshotOf(threadWith(messages)));
    await render(
      <AgentKitProvider controller={store.controller} threadId="thread-long">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    expect(renderedMessageIds()).toEqual(messages.map((message) => message.id));
  });

  it("re-renders only the row whose message changed", async () => {
    const messages = conversation(3);
    const renders = new Map<string, number>();
    function CountingMessage(props: AgentKitRenderProps<AgentMessage>) {
      renders.set(props.value.id, (renders.get(props.value.id) ?? 0) + 1);
      return <AgentMessageView {...props} />;
    }
    const thread = threadWith(messages);
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider
        controller={store.controller}
        threadId="thread-long"
        slots={{ message: CountingMessage }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const before = new Map(renders);
    const last = messages.at(-1)!;
    await act(async () => {
      store.update(
        snapshotOf(
          {
            ...thread,
            messages: [
              ...messages.slice(0, -1),
              {
                ...last,
                parts: [
                  {
                    type: "text",
                    text: "Answer 2, revised",
                    format: "markdown",
                  },
                ],
              },
            ],
          },
          1,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renders.get(last.id)).toBe((before.get(last.id) ?? 0) + 1);
    for (const message of messages.slice(0, -1)) {
      expect(renders.get(message.id)).toBe(before.get(message.id));
    }
  });

  it("notifies every subscriber of a controller in one task per change", async () => {
    vi.useFakeTimers();
    const thread = threadWith(conversation(2));
    const store = observableController(snapshotOf(thread));
    const seen: number[] = [];
    function Count({ index }: { index: number }) {
      const count = useAgentThreadSelector((value) => value.messages.length);
      seen[index] = count;
      return null;
    }
    await render(
      <AgentKitProvider controller={store.controller} threadId="thread-long">
        {[0, 1, 2, 3].map((index) => (
          <Count key={index} index={index} />
        ))}
      </AgentKitProvider>,
    );
    const timersBefore = vi.getTimerCount();
    act(() => {
      store.update(snapshotOf(threadWith(conversation(3)), 1));
      store.update(snapshotOf(threadWith(conversation(4)), 2));
    });
    expect(vi.getTimerCount() - timersBefore).toBe(1);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(seen).toEqual([8, 8, 8, 8]);
  });

  it("mounts closed work content in idle time in a long thread, or at once when opened", async () => {
    // Idle mounts run on a short timer; real timers let a busy machine fire it
    // before the "still unmounted" check.
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    });
    const messages = conversation(30, (index) => [
      {
        type: "reasoning",
        text: `**Plan ${index}**\n\nWeighing option ${index}`,
        visibility: "visible",
      },
      { type: "text", text: `Answer ${index}`, format: "markdown" },
    ]);
    const store = observableController(snapshotOf(threadWith(messages)));
    await render(
      <AgentKitProvider controller={store.controller} threadId="thread-long">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const contents = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".agentkit-disclosure-content"),
      );
    expect(contents().length).toBeGreaterThan(0);
    expect(contents().every((content) => content.textContent === "")).toBe(
      true,
    );

    const summary = container.querySelector<HTMLButtonElement>(
      'button.agentkit-disclosure-summary[aria-expanded="false"]',
    );
    await act(async () => summary!.click());
    const opened = document.getElementById(
      summary!.getAttribute("aria-controls")!,
    );
    expect(opened?.textContent).toMatch(/Plan \d+/);

    for (let index = 0; index < 20; index += 1) {
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
    }
    expect(contents().every((content) => content.textContent !== "")).toBe(
      true,
    );
  });
});
