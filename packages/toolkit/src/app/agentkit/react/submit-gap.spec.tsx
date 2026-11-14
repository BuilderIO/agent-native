// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getComposerDraftKey } from "../../../composer/draft-key.js";
import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import type { TiptapComposerHandle } from "../../../composer/TiptapComposer.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

const THREAD_ID = "thread-submit-gap";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  localStorage.removeItem(getComposerDraftKey(`agentkit:${THREAD_ID}`));
  vi.unstubAllGlobals();
});

async function renderChat(options: { cancelRun?: () => Promise<void> } = {}) {
  const started = Promise.withResolvers<{ runId: string }>();
  const startRun = vi.fn<AgentTransport["startRun"]>(() => started.promise);
  const cancelRun = vi.fn<AgentTransport["cancelRun"]>(
    options.cancelRun ?? (async () => undefined),
  );
  const queueMessage = vi
    .fn<NonNullable<AgentTransport["queueMessage"]>>()
    .mockImplementation(async (input) => ({
      message: {
        id: input.id ?? "queued-1",
        threadId: input.threadId,
        text: input.text,
        createdAt: "2026-10-24T00:00:00.000Z",
      },
    }));
  const transport: AgentTransport = {
    capabilities: { messageQueue: true },
    assertAiSetupReady: async () => undefined,
    startRun,
    // The run stays live until the test ends, as a real one would.
    async *subscribeToRun({ signal }) {
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
    cancelRun,
    queueMessage,
    async getThreadSnapshot(threadId) {
      return {
        id: threadId,
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
        messages: [],
      };
    },
  };
  const client = new AgentKitClient({ transport });
  await client.loadThread(THREAD_ID);
  await client.getCapabilities();
  const composerRef = createRef<TiptapComposerHandle>();
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
        <AgentKitProvider controller={client} threadId={THREAD_ID}>
          <AgentKitChat
            composerProps={{
              composerRef,
              autoFocus: false,
              modelStatusChecksEnabled: false,
              voiceEnabled: false,
            }}
          />
        </AgentKitProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await Promise.resolve();
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    await client.shutdown();
    container.remove();
  });
  const settle = async () => {
    await act(async () => {
      for (let tick = 0; tick < 5; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  };
  const sendButton = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="send-button"]',
    );
  const stopButton = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
  const submit = async (text: string) => {
    await act(async () => composerRef.current!.setText(text));
    await act(async () => {
      sendButton()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const queuedRows = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-agent-message-queue-row="true"]',
      ),
      (row) => row.textContent ?? "",
    );
  const editorText = () =>
    container.querySelector('[contenteditable="true"]')?.textContent ?? "";
  const notices = () =>
    Array.from(
      container.querySelectorAll(
        '[data-agent-composer-slot="notices"] [data-agent-composer-notice]',
      ),
      (notice) => notice.textContent ?? "",
    );
  return {
    client,
    started,
    startRun,
    cancelRun,
    queueMessage,
    composerRef,
    settle,
    submit,
    sendButton,
    stopButton,
    queuedRows,
    editorText,
    notices,
  };
}

describe("AgentKit composer before the run registers", () => {
  it("shows Stop and queues a draft typed while the submission is pending", async () => {
    const chat = await renderChat();
    await chat.submit("Plan the launch");
    expect(chat.startRun).toHaveBeenCalledOnce();

    expect(chat.stopButton()).not.toBeNull();
    await act(async () => chat.composerRef.current!.setText("Then ship it"));
    expect(chat.sendButton()?.disabled).toBe(false);
    expect(chat.sendButton()?.getAttribute("aria-label")).toBe("Queue message");
    expect(chat.stopButton()).not.toBeNull();
    await chat.submit("Then ship it");

    expect(chat.queuedRows()).toEqual([
      expect.stringContaining("Then ship it"),
    ]);
    expect(chat.editorText()).toBe("");
    // The follow-up waits for the first turn's run instead of racing it.
    expect(chat.startRun).toHaveBeenCalledOnce();
    expect(chat.queueMessage).not.toHaveBeenCalled();

    chat.started.resolve({ runId: "run-1" });
    await chat.settle();

    expect(chat.startRun).toHaveBeenCalledOnce();
    expect(chat.queueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Then ship it" }),
      expect.anything(),
    );
    expect(chat.queuedRows()).toEqual([
      expect.stringContaining("Then ship it"),
    ]);
    expect(chat.notices()).toEqual([]);
  });

  it("stops the submission once its run exists", async () => {
    const chat = await renderChat();
    await chat.submit("Plan the launch");

    await act(async () => chat.stopButton()!.click());
    expect(chat.stopButton()?.disabled).toBe(true);
    expect(chat.cancelRun).not.toHaveBeenCalled();

    chat.started.resolve({ runId: "run-1" });
    await chat.settle();

    expect(chat.cancelRun).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD_ID, runId: "run-1" }),
      expect.anything(),
    );
  });

  it("reports a deferred stop that fails instead of looking stopped", async () => {
    const chat = await renderChat({
      cancelRun: async () => {
        throw new Error("The run could not be stopped.");
      },
    });
    await chat.submit("Plan the launch");
    await act(async () => chat.stopButton()!.click());

    chat.started.resolve({ runId: "run-1" });
    await chat.settle();

    expect(chat.notices()).toEqual([
      expect.stringContaining("The run could not be stopped."),
    ]);
    expect(chat.stopButton()?.disabled).toBe(false);
  });
});
