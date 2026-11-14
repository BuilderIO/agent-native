// @vitest-environment happy-dom

import { AgentKitClient as AgentKitClientImplementation } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";
import {
  AgentKitQueueActionError,
  agentKitQueueErrorForDisplay,
} from "./queue-error-copy.js";

const labels = {
  queueItemBusy: "Sends after this reply.",
  queueItemBlocked: "Couldn't send this message.",
  queueOrderStale: "The queue changed.",
};

function codedError(code: string, retryable: boolean, message: string) {
  return Object.assign(new Error(message), { code, retryable });
}

describe("agentKitQueueErrorForDisplay", () => {
  it.each([
    ["queue_item_busy", true, labels.queueItemBusy],
    ["run_slot_busy", true, labels.queueItemBusy],
    ["queue_item_blocked", false, labels.queueItemBlocked],
    ["queue_order_stale", false, labels.queueOrderStale],
  ] as const)(
    "replaces %s protocol text with its copy",
    (code, retryable, copy) => {
      const cause = codedError(
        code,
        retryable,
        "Queued submission queued-message-1234 is still waiting in the server inbox.",
      );
      const mapped = agentKitQueueErrorForDisplay(cause, labels);

      expect(mapped).toBeInstanceOf(AgentKitQueueActionError);
      expect(mapped).toMatchObject({ message: copy, code, retryable });
      expect((mapped as Error).cause).toBe(cause);
    },
  );

  it("leaves other failures untouched", () => {
    const error = codedError("upload_failed", false, "Upload failed.");

    expect(agentKitQueueErrorForDisplay(error, labels)).toBe(error);
  });
});

class AgentKitClient extends AgentKitClientImplementation {
  constructor(
    options: ConstructorParameters<typeof AgentKitClientImplementation>[0],
  ) {
    super({ ...options, aiSetupReadiness: "not-applicable" });
  }
}

async function renderQueuedChat(
  steerQueuedMessage: NonNullable<AgentTransport["steerQueuedMessage"]>,
) {
  const transport: AgentTransport = {
    capabilities: { messageQueue: true },
    steerQueuedMessage,
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
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
        messages: [],
        activeRunIds: ["run-active"],
        runs: [
          {
            id: "run-active",
            threadId,
            status: "running" as const,
            lastSequence: 0,
          },
        ],
        queuedMessages: [
          {
            id: "queued-message-1234",
            threadId,
            text: "Follow up",
            createdAt: "2026-10-24T00:00:01.000Z",
          },
        ],
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
      <ComposerRuntimeAdaptersProvider
        adapters={{
          models: {
            useAgentEngineConfigured: () => ({
              missing: false,
              state: "configured",
            }),
            fetchAgentEngineConfiguredState: async () => "configured",
          },
        }}
      >
        <AgentKitProvider
          controller={client}
          threadId="thread-queue"
          labels={labels}
        >
          <AgentKitChat />
        </AgentKitProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await Promise.resolve();
  });
  const queueButton = (label: string) =>
    Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        'section[data-agent-message-queue="true"] button',
      ),
    ).find(
      (button) =>
        button.textContent?.trim() === label ||
        button.getAttribute("aria-label") === label,
    );
  return {
    client,
    container,
    queueButton,
    status: () =>
      container.querySelector("[data-agent-message-queue-status]")?.textContent,
    async click(button: HTMLElement | undefined) {
      await act(async () => {
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async openMenu() {
      await act(async () => {
        queueButton("More actions")?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });
    },
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      await client.dispose();
    },
  };
}

describe("queued message Send now", () => {
  it("shows localized copy instead of the inbox message and its id", async () => {
    const steerQueuedMessage = vi.fn<
      NonNullable<AgentTransport["steerQueuedMessage"]>
    >(async ({ messageId }) => {
      throw codedError(
        "queue_item_blocked",
        false,
        `Queued submission ${messageId} is blocked in the server inbox.`,
      );
    });
    const chat = await renderQueuedChat(steerQueuedMessage);
    try {
      await chat.click(chat.queueButton("Send now"));

      expect(steerQueuedMessage).toHaveBeenCalledOnce();
      const text = document.body.textContent ?? "";
      expect(text).toContain(labels.queueItemBlocked);
      expect(text).not.toContain("server inbox");
      expect(text).not.toContain("Queued submission");
      expect(text).not.toContain("queued-message-1234");
      expect(
        chat.client
          .getThread("thread-queue")
          .queuedMessages.map(({ id }) => id),
      ).toEqual(["queued-message-1234"]);
    } finally {
      await chat.cleanup();
    }
  });

  it("sends into the running turn and shows the row as sending", async () => {
    const steerQueuedMessage = vi.fn<
      NonNullable<AgentTransport["steerQueuedMessage"]>
    >(async () => ({ delivery: "steering" }));
    const chat = await renderQueuedChat(steerQueuedMessage);
    try {
      await chat.click(chat.queueButton("Send now"));

      expect(steerQueuedMessage).toHaveBeenCalledWith(
        {
          threadId: "thread-queue",
          messageId: "queued-message-1234",
          deliverInActiveRun: true,
        },
        expect.anything(),
      );
      expect(chat.status()).toBe("Sending…");
      expect(chat.queueButton("Send now")).toBeUndefined();
      expect(document.body.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await chat.cleanup();
    }
  });

  it("stops the run only from Stop and send, and shows a refused stop as after this reply", async () => {
    const steerQueuedMessage = vi.fn<
      NonNullable<AgentTransport["steerQueuedMessage"]>
    >(async () => ({ delivery: "after_reply" }));
    const chat = await renderQueuedChat(steerQueuedMessage);
    try {
      await chat.openMenu();
      const stopAndSend = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.trim() === "Stop and send");
      await chat.click(stopAndSend);

      expect(steerQueuedMessage).toHaveBeenCalledWith(
        {
          threadId: "thread-queue",
          messageId: "queued-message-1234",
          interruptActiveRun: true,
        },
        expect.anything(),
      );
      expect(chat.status()).toBe("Sends after this reply");
      expect(document.body.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await chat.cleanup();
    }
  });
});
