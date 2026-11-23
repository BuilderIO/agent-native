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

const THREAD_ID = "thread-optimistic-sync";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  localStorage.removeItem(getComposerDraftKey(`agentkit:${THREAD_ID}`));
  vi.unstubAllGlobals();
});

async function renderChat() {
  const transport: AgentTransport = {
    capabilities: { uploads: true },
    assertAiSetupReady: async () => undefined,
    startRun: async () => ({ runId: "run-sent" }),
    async *subscribeToRun() {},
    async cancelRun() {},
    async getThreadSnapshot(threadId) {
      return {
        id: threadId,
        createdAt: "2026-11-20T00:00:00.000Z",
        updatedAt: "2026-11-20T00:00:00.000Z",
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
  return { client, composerRef, container };
}

describe("AgentKit synchronous optimistic send", () => {
  it("renders the user bubble in the same microtask as the Enter key", async () => {
    const chat = await renderChat();
    await act(async () =>
      chat.composerRef.current!.setText("Instant feedback"),
    );

    const sendButton = chat.container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="send-button"]',
    )!;

    // The optimistic bubble must be in the DOM before the submit chain
    // yields its first microtask. Without the eager fast path, the
    // attachment-submission barrier (addQueue → Promise.all →
    // cleanStaleAttachments) awaits several microtasks before
    // startOptimisticSubmission runs, so the bubble only lands after at
    // least one macrotask and the user feels a "weird lag" between
    // hitting Enter and seeing their message. React commits the event's
    // synchronous state updates before the click dispatch returns — no
    // microtask yield required.
    sendButton.click();
    const bubble = chat.container.querySelector<HTMLElement>(
      'article.agentkit-message[data-role="user"]',
    );
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain("Instant feedback");

    // Let the submit chain settle so the afterEach cleanup does not warn
    // about an in-flight state update.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });
});
