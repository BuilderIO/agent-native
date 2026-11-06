// @vitest-environment happy-dom

import {
  createAgentThreadState,
  reduceAgentEvent,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { act, useEffect } from "react";
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
const follows = (later: Node, earlier: Node) =>
  Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

describe("Worked for row moving into the reply footer", () => {
  beforeEach(() => stubReducedMotion(false));

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lets the streaming reply be the focus, then puts the row in its footer", async () => {
    const live = reduce(liveEvents);
    const observable = observableController(snapshotOf(live, 0));
    await render(observable.controller);
    const reply = () => container.querySelector('[data-message-id="reply"]')!;
    // oracle-change: the reply's text is the newest output, so no work row shows while it streams, and the finish no longer animates a placeholder out of the space above the reply.
    expect(container.querySelector(".agentkit-activities")).toBeNull();

    await act(async () =>
      observable.update(snapshotOf(reduce(finishEvents, live), 1)),
    );
    await flush();

    expect(container.querySelectorAll(".agentkit-activities")).toHaveLength(1);
    expect(
      reply().contains(work().closest(".agentkit-message-work-host")),
    ).toBe(true);
    expect(work().textContent).toContain("Worked for");
    // Nothing is left holding a place above the reply.
    expect(reply().previousElementSibling).toBeNull();
  });

  it("moves a row it saw running when the reply lands whole", async () => {
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
    expect(container.querySelectorAll(".agentkit-activities")).toHaveLength(1);
    expect(work().closest(".agentkit-message-actions")).not.toBeNull();
  });

  it("renders a thread that loads finished with its row in the footer", async () => {
    const finished = reduce(finishEvents, reduce(liveEvents));
    const observable = observableController(snapshotOf(finished, 0));
    await render(observable.controller);
    await flush();
    expect(container.querySelectorAll(".agentkit-activities")).toHaveLength(1);
    expect(work().closest(".agentkit-message-actions")).not.toBeNull();
  });
});

describe("a reply that narrates between steps", () => {
  const search = (
    sequence: number,
    id: string,
    status: "running" | "completed",
  ) =>
    event(sequence, {
      type: status === "running" ? "tool.started" : "tool.updated",
      toolCall: {
        id,
        name: "web-search",
        status,
        messageId: "reply",
        input: { query: id },
      },
    });
  const narrated: AgentEvent[] = [
    event(1, { type: "run.started" }),
    event(2, {
      type: "message.created",
      message: {
        id: "reply",
        role: "assistant",
        status: "streaming",
        parts: [],
      },
    }),
    event(3, {
      type: "message.delta",
      messageId: "reply",
      text: "Looking it up.",
    }),
    search(4, "first", "running"),
    search(5, "first", "completed"),
    event(6, {
      type: "message.delta",
      messageId: "reply",
      text: "Checking stock.",
    }),
    search(7, "second", "running"),
  ];
  const answered: AgentEvent[] = [
    search(8, "second", "completed"),
    event(9, {
      type: "message.delta",
      messageId: "reply",
      text: "Buy the Trek.",
    }),
    event(10, {
      type: "message.completed",
      message: {
        id: "reply",
        role: "assistant",
        status: "complete",
        parts: [
          { type: "text", text: "Looking it up." },
          { type: "text", text: "Checking stock." },
          { type: "text", text: "Buy the Trek." },
        ],
      },
    }),
    event(11, { type: "run.completed" }),
  ];
  const rows = () => [
    ...container.querySelectorAll<HTMLElement>(".agentkit-activities"),
  ];

  beforeEach(() => stubReducedMotion(true));

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const textOf = (text: string): Node => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.includes(text)) return node;
    }
    throw new Error(`No text "${text}" on screen`);
  };

  it("keeps a saved reply's leading reasoning in the live row", async () => {
    const working = reduce([
      event(1, { type: "run.started" }),
      event(2, {
        type: "message.delta",
        messageId: "reply",
        role: "assistant",
        text: "Looking it up.",
      }),
      search(3, "first", "running"),
    ]);
    const saved: AgentThreadState = {
      ...working,
      messages: [
        {
          id: "reply",
          role: "assistant",
          status: "complete",
          parts: [
            { type: "reasoning", text: "Weighing the two bikes." },
            { type: "text", text: "Looking it up." },
          ],
        },
      ],
    };
    await render(observableController(snapshotOf(saved, 0)).controller);
    await flush();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.dataset.running).toBe("true");
    expect(rows()[0]!.textContent).toContain("Weighing the two bikes.");
  });

  it("shows a live row for a step whose only output is a result card", async () => {
    function SearchResult({ value }: { value: { id: string } }) {
      return <div data-search-result={value.id}>Results</div>;
    }
    const carded = reduce(narrated.slice(0, 5));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AgentKitRoot
          controller={observableController(snapshotOf(carded, 0)).controller}
          threadId={threadId}
          load="manual"
          registry={{ tools: { "web-search": SearchResult } }}
        >
          <AgentKitChat composer={false} />
        </AgentKitRoot>,
      );
      await Promise.resolve();
    });
    await flush();

    const reply = container.querySelector('[data-message-id="reply"]')!;
    expect(
      follows(reply, container.querySelector('[data-search-result="first"]')!),
    ).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.dataset.running).toBe("true");
    expect(follows(rows()[0]!, textOf("Looking"))).toBe(true);
  });

  it("shows no row while narration after a step streams", async () => {
    const observable = observableController(
      snapshotOf(reduce(narrated.slice(0, 6)), 0),
    );
    await render(observable.controller);
    await flush();

    expect(rows()).toHaveLength(0);
    expect(textOf("Checking")).toBeTruthy();
  });

  it("keeps one live row below the reply's latest text while the run works", async () => {
    const live = reduce(narrated);
    const observable = observableController(snapshotOf(live, 0));
    await render(observable.controller);
    await flush();

    expect(rows()).toHaveLength(1);
    const row = rows()[0]!;
    expect(row.dataset.running).toBe("true");
    expect(container.textContent).not.toContain("Worked for");
    expect(follows(row, textOf("Checking"))).toBe(true);
    const reply = container.querySelector('[data-message-id="reply"]')!;
    expect(follows(row, reply)).toBe(true);

    await act(async () =>
      observable.update(snapshotOf(reduce(answered, live), 1)),
    );
    await flush();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.closest(".agentkit-message-actions")).not.toBeNull();
    expect(follows(rows()[0]!, textOf("Buy the Trek."))).toBe(true);
    expect(container.textContent?.match(/Worked for/g)).toHaveLength(1);
  });

  it("keeps a step's result card above the reply through the finish", async () => {
    const mounts = vi.fn();
    function SearchResult({ value }: { value: { id: string } }) {
      useEffect(() => mounts(value.id), [value.id]);
      return <div data-search-result={value.id}>Results</div>;
    }
    const live = reduce(narrated);
    const observable = observableController(snapshotOf(live, 0));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AgentKitRoot
          controller={observable.controller}
          threadId={threadId}
          load="manual"
          registry={{ tools: { "web-search": SearchResult } }}
        >
          <AgentKitChat composer={false} />
        </AgentKitRoot>,
      );
      await Promise.resolve();
    });
    await flush();

    const reply = container.querySelector('[data-message-id="reply"]')!;
    const card = () => container.querySelector('[data-search-result="first"]')!;
    expect(follows(reply, card())).toBe(true);
    expect(follows(rows()[0]!, reply)).toBe(true);

    await act(async () =>
      observable.update(snapshotOf(reduce(answered, live), 1)),
    );
    await flush();

    expect(follows(reply, card())).toBe(true);
    expect(mounts.mock.calls.filter(([id]) => id === "first")).toHaveLength(1);
  });
});
