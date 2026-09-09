// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit-client";
import type { AgentTransport } from "@agent-native/agentkit-protocol";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

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
  vi.restoreAllMocks();
});

function createLoadedClient() {
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "run-1" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async getThreadSnapshot() {
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        messages: [
          {
            id: "assistant-1",
            role: "assistant" as const,
            parts: [{ type: "text" as const, text: "Ready." }],
          },
        ],
      };
    },
  };
  return new AgentKitClient({ transport });
}

function BrokenMessage(): React.ReactNode {
  throw new Error("renderer internals must stay private");
}

describe("AgentKit renderer isolation", () => {
  it("keeps a broken custom renderer from crashing the conversation", async () => {
    const client = createLoadedClient();
    await client.loadThread("thread-1");
    const onRenderError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root.render(
        <AgentKitProvider
          controller={client}
          threadId="thread-1"
          slots={{ message: BrokenMessage }}
          onRenderError={onRenderError}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );
    });

    expect(container.textContent).toContain(
      "This content couldn’t be displayed.",
    );
    expect(container.textContent).not.toContain("renderer internals");
    expect(onRenderError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        surface: "message",
        threadId: "thread-1",
      }),
    );
  });

  it("reports an observer failure without replacing the safe fallback", async () => {
    const client = createLoadedClient();
    await client.loadThread("thread-1");
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root.render(
        <AgentKitProvider
          controller={client}
          threadId="thread-1"
          slots={{ message: BrokenMessage }}
          onRenderError={() => {
            throw new Error("telemetry unavailable");
          }}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );
    });

    expect(reportError).toHaveBeenCalledWith(expect.any(Error));
    expect(container.textContent).toContain(
      "This content couldn’t be displayed.",
    );
  });
});
