// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterAgentChatContextItems,
  refreshAgentChatContext,
} from "./agent-chat.js";
import { useAgentChatContext } from "./use-agent-chat-context.js";

const { agentChatContextState } = vi.hoisted(() => ({
  agentChatContextState: { items: [], updatedAt: 0 },
}));

vi.mock("./agent-chat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-chat.js")>();
  return {
    ...actual,
    clearAgentChatContext: vi.fn(),
    getAgentChatContextState: vi.fn(() => agentChatContextState),
    refreshAgentChatContext: vi.fn(async () => agentChatContextState),
    removeAgentChatContextItem: vi.fn(),
    setAgentChatContextItem: vi.fn(),
    subscribeAgentChatContext: vi.fn(() => () => {}),
  };
});

function Probe({ enabled }: { enabled: boolean }) {
  const { items } = useAgentChatContext(enabled);
  return <div>{items.map((item) => item.key).join(",")}</div>;
}

describe("useAgentChatContext", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    agentChatContextState.items = [];
    agentChatContextState.updatedAt = 0;
    vi.mocked(refreshAgentChatContext).mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not read application state while disabled", async () => {
    await act(async () => {
      root.render(<Probe enabled={false} />);
      await Promise.resolve();
    });

    expect(refreshAgentChatContext).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Probe enabled />);
      await Promise.resolve();
    });

    expect(refreshAgentChatContext).toHaveBeenCalledTimes(1);
  });

  it("keeps thread-targeted context out of global context reads", async () => {
    agentChatContextState.items = [
      { key: "shared", title: "Shared", context: "Shared context" },
      {
        key: "prefill:thread-1",
        title: "Prefill",
        context: "Thread-only context",
        targetThreadId: "thread-1",
      },
    ];

    await act(async () => {
      root.render(<Probe enabled />);
    });

    expect(container.textContent).toBe("shared");
    expect(filterAgentChatContextItems(agentChatContextState.items)).toEqual([
      agentChatContextState.items[0],
    ]);
  });
});
