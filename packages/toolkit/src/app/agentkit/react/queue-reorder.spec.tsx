// @vitest-environment happy-dom

import { AgentKitClient as AgentKitClientImplementation } from "@agent-native/agentkit/client";
import type {
  AgentQueuedMessage,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

class AgentKitClient extends AgentKitClientImplementation {
  constructor(
    options: ConstructorParameters<typeof AgentKitClientImplementation>[0],
  ) {
    super({ ...options, aiSetupReadiness: "not-applicable" });
  }
}

const queuedMessages: AgentQueuedMessage[] = ["first", "second"].map(
  (id, index) => ({
    id: `queued-${id}`,
    threadId: "thread-queue",
    text: id === "first" ? "First" : "Second",
    createdAt: `2026-09-26T00:00:0${index}.000Z`,
  }),
);

async function renderQueue(
  reorderQueuedMessages: AgentTransport["reorderQueuedMessages"],
) {
  const transport: AgentTransport = {
    capabilities: { messageQueue: true },
    reorderQueuedMessages,
    async steerQueuedMessage() {},
    async startRun() {
      return { runId: "run-queue" };
    },
    async *subscribeToRun({ signal }) {
      if (!signal) return;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async cancelRun() {},
    async getThreadSnapshot(threadId) {
      return {
        id: threadId,
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
        messages: [
          {
            id: "user-1",
            role: "user" as const,
            status: "complete" as const,
            parts: [{ type: "text" as const, text: "Start" }],
          },
        ],
        activeRunIds: ["run-active"],
        runs: [
          {
            id: "run-active",
            threadId,
            status: "running" as const,
            lastSequence: 0,
          },
        ],
        queuedMessages,
      };
    },
  };
  const client = new AgentKitClient({ transport });
  await client.loadThread("thread-queue");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    root.render(
      <AgentKitProvider controller={client} threadId="thread-queue">
        <AgentKitChat />
      </AgentKitProvider>,
    );
    await Promise.resolve();
  });
  const rowText = () =>
    Array.from(
      container.querySelectorAll('section[data-agent-message-queue="true"] li'),
    ).map((row) => row.textContent ?? "");
  const moveFirstDown = async () => {
    const handle = container.querySelector<HTMLButtonElement>(
      '[data-agent-message-queue-handle="true"]',
    )!;
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const cleanup = async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    await client.shutdown();
    container.remove();
    vi.unstubAllGlobals();
  };
  return { client, container, rowText, moveFirstDown, cleanup };
}

describe("AgentKit queue reordering", () => {
  it("persists a keyboard reorder through the controller", async () => {
    const reorder = vi.fn(async () => undefined);
    const view = await renderQueue(reorder);
    try {
      await view.moveFirstDown();
      expect(reorder).toHaveBeenCalledWith(
        {
          threadId: "thread-queue",
          messageIds: ["queued-second", "queued-first"],
        },
        expect.anything(),
      );
      expect(
        view.client
          .getThread("thread-queue")
          .queuedMessages.map(({ id }) => id),
      ).toEqual(["queued-second", "queued-first"]);
      expect(view.rowText()[0]).toContain("Second");
    } finally {
      await view.cleanup();
    }
  });

  it("puts the order back and says so when the server refuses", async () => {
    const view = await renderQueue(async () => {
      throw new Error("queue_order_stale");
    });
    try {
      await view.moveFirstDown();
      expect(view.rowText()[0]).toContain("First");
      expect(
        view.client
          .getThread("thread-queue")
          .queuedMessages.map(({ id }) => id),
      ).toEqual(["queued-first", "queued-second"]);
      expect(
        document.querySelector('[data-notice="message-queue-reorder-failed"]')
          ?.textContent,
      ).toContain("Couldn't reorder the queue. Try again.");
    } finally {
      await view.cleanup();
    }
  });

  it("offers no drag handle when the transport cannot reorder", async () => {
    const view = await renderQueue(undefined);
    try {
      expect(
        view.container.querySelector("[data-agent-message-queue-handle]"),
      ).toBeNull();
    } finally {
      await view.cleanup();
    }
  });
});
