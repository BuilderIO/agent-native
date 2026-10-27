// @vitest-environment happy-dom

import {
  createAgentThreadState,
  reduceAgentEvent,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitRoot } from "./root.js";

const threadId = "thread-work-handoff";
const runId = "run-work-handoff";

function event(
  sequence: number,
  body: Record<string, unknown> & { type: AgentEvent["type"] },
): AgentEvent {
  return {
    id: `event-${sequence}`,
    threadId,
    runId,
    sequence,
    occurredAt: `2026-10-24T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...body,
  } as AgentEvent;
}

const liveEvents: AgentEvent[] = [
  event(1, { type: "run.started" }),
  event(2, {
    type: "activity.started",
    activity: {
      id: "search",
      kind: "search",
      label: "Searching documentation",
      status: "running",
    },
  }),
  event(3, {
    type: "activity.completed",
    activity: {
      id: "search",
      kind: "search",
      label: "Searched documentation",
      status: "completed",
    },
  }),
  event(4, {
    type: "message.delta",
    messageId: "reply",
    role: "assistant",
    text: "Here is",
  }),
];

const finishEvents: AgentEvent[] = [
  event(5, {
    type: "message.completed",
    message: {
      id: "reply",
      role: "assistant",
      status: "complete",
      parts: [{ type: "text", text: "Here is the answer." }],
    },
  }),
  event(6, { type: "run.completed" }),
];

function reduce(events: AgentEvent[], from?: AgentThreadState) {
  return events.reduce(
    reduceAgentEvent,
    from ?? createAgentThreadState(threadId),
  );
}

function snapshotOf(thread: AgentThreadState, revision: number) {
  return {
    connection: "connected" as const,
    capabilities: {},
    capabilitiesStatus: "ready" as const,
    threads: { [threadId]: thread },
    revision,
  } as AgentKitSnapshot;
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
    getThread: (id: string) =>
      snapshot.threads[id] ?? createAgentThreadState(id),
    loadThread: vi.fn(async (id: string) => controller.getThread(id)),
    uploadFiles: vi.fn(async () => []),
    invokeAction: vi.fn(async () => ({ invocationId: "invocation-1" })),
  } as unknown as AgentKitController;
  return {
    controller,
    update(next: AgentKitSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(controller: AgentKitController) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AgentKitRoot controller={controller} threadId={threadId} load="manual">
        <AgentKitChat composer={false} />
      </AgentKitRoot>,
    );
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

const work = () =>
  container.querySelector<HTMLElement>(".agentkit-activities")!;
const placeholder = () =>
  container.querySelector<HTMLElement>('[data-agentkit-work-handoff="leave"]');

describe("Worked for handoff to the reply footer", () => {
  beforeEach(() => {
    stubReducedMotion(false);
    // happy-dom lays nothing out; the handoff carries the row's height over.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes the row's old space while it fades in on a live finish", async () => {
    const live = reduce(liveEvents);
    const observable = observableController(snapshotOf(live, 0));
    await render(observable.controller);
    expect(work().closest(".agentkit-message-actions")).toBeNull();
    // Opened to watch the live work.
    await act(async () =>
      work()
        .querySelector<HTMLButtonElement>(".agentkit-disclosure-summary")!
        .click(),
    );
    expect(work().dataset.open).toBe("true");

    await act(async () =>
      observable.update(snapshotOf(reduce(finishEvents, live), 1)),
    );
    await flush();

    const settled = work();
    expect(settled.closest(".agentkit-message-actions")).not.toBeNull();
    expect(settled.dataset.handoff).toBe("enter");
    // It closes as it moves, so its steps never open below the reply.
    expect(settled.dataset.open).toBe("false");
    const leaving = placeholder();
    expect(leaving).not.toBeNull();
    expect(leaving!.getAttribute("aria-hidden")).toBe("true");
    expect(
      leaving!.style.getPropertyValue("--agentkit-work-handoff-size"),
    ).toBe("40px");
    expect(leaving!.textContent).toContain("Worked for");
    // It holds the row's old place, above the reply.
    const reply = container.querySelector('[data-message-id="reply"]')!;
    expect(
      leaving!.compareDocumentPosition(reply) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(placeholder()).toBeNull();
    expect(work().dataset.handoff).toBeUndefined();
  });

  it("hands off a row it saw running when the reply lands whole", async () => {
    const running = reduce(liveEvents.slice(0, 2));
    const observable = observableController(snapshotOf(running, 0));
    await render(observable.controller);
    expect(work().dataset.running).toBe("true");
    await act(async () =>
      observable.update(
        snapshotOf(
          reduce(
            [
              liveEvents[2]!,
              ...finishEvents.map((finish, index) => ({
                ...finish,
                id: `event-whole-${index}`,
                sequence: 4 + index,
              })),
            ],
            running,
          ),
          1,
        ),
      ),
    );
    await flush();
    expect(work().closest(".agentkit-message-actions")).not.toBeNull();
    expect(work().dataset.handoff).toBe("enter");
    expect(placeholder()).not.toBeNull();
  });

  it("does not animate a thread that loads already finished", async () => {
    const finished = reduce(finishEvents, reduce(liveEvents));
    const observable = observableController(snapshotOf(finished, 0));
    await render(observable.controller);
    await flush();
    expect(work().closest(".agentkit-message-actions")).not.toBeNull();
    expect(work().dataset.handoff).toBeUndefined();
    expect(placeholder()).toBeNull();
  });

  it("moves at once with reduced motion", async () => {
    stubReducedMotion(true);
    const live = reduce(liveEvents);
    const observable = observableController(snapshotOf(live, 0));
    await render(observable.controller);
    await act(async () =>
      observable.update(snapshotOf(reduce(finishEvents, live), 1)),
    );
    await flush();
    expect(work().closest(".agentkit-message-actions")).not.toBeNull();
    expect(work().dataset.handoff).toBeUndefined();
    expect(placeholder()).toBeNull();
  });
});
