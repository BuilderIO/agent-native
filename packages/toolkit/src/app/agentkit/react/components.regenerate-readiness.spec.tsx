// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentTransport } from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import { AgentKitChat as AgentKitChatImplementation } from "./components.js";
import { AgentKitProvider } from "./context.js";

function AgentKitChat() {
  return (
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
      <AgentKitChatImplementation />
    </ComposerRuntimeAdaptersProvider>
  );
}

describe("AgentKit regenerate readiness", () => {
  it("checks readiness before creating a fork for regeneration", async () => {
    const setupRequired = new Error("AI setup is required");
    const assertAiSetupReady = vi.fn(async () => {
      throw setupRequired;
    });
    const forkThread = vi.fn(async (input: { threadId: string }) => ({
      id: `${input.threadId}-fork`,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    }));
    const startRun = vi.fn(async () => ({ runId: "run-regenerate-blocked" }));
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      assertAiSetupReady,
      forkThread,
      startRun,
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(threadId) {
        return {
          id: threadId,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
          messages: [
            {
              id: "user-regenerate-blocked",
              role: "user",
              status: "complete",
              parts: [{ type: "text", text: "Try this again" }],
            },
            {
              id: "assistant-regenerate-blocked",
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", text: "First answer" }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-regenerate-blocked");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      await act(async () => {
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-regenerate-blocked"
            onThreadForked={vi.fn()}
          >
            <AgentKitChat />
          </AgentKitProvider>,
        );
        await Promise.resolve();
      });

      const regenerateButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Regenerate response"]',
      );
      expect(regenerateButton).not.toBeNull();
      await act(async () => {
        regenerateButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(assertAiSetupReady).toHaveBeenCalledOnce();
      expect(forkThread).not.toHaveBeenCalled();
      expect(startRun).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      await client.shutdown();
      container.remove();
      if (previousActEnvironment === undefined) {
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });
});
