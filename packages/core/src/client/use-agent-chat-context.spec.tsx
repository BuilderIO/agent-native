// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetAgentChatContextForTests,
  getAgentChatContextState,
  publishAgentChatContextItems,
  refreshAgentChatContext,
} from "./agent-chat.js";
import { useAgentChatContext } from "./use-agent-chat-context.js";
import {
  _resetChangeVersionStoreForTests,
  bumpChangeVersion,
} from "./use-change-version.js";

function Probe({ enabled }: { enabled: boolean }) {
  const { items } = useAgentChatContext(enabled);
  return <div>{items.map((item) => item.key).join(",")}</div>;
}

describe("useAgentChatContext", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ values: {}, missing: ["agent-chat-context"] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    _resetAgentChatContextForTests();
    _resetChangeVersionStoreForTests();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not read application state while disabled", async () => {
    await act(async () => {
      root.render(<Probe enabled={false} />);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Probe enabled />);
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it("keeps thread-targeted context out of global context reads", async () => {
    publishAgentChatContextItems(
      [
        { key: "shared", title: "Shared", context: "Shared context" },
        {
          key: "prefill:thread-1",
          title: "Prefill",
          context: "Thread-only context",
          targetThreadId: "thread-1",
        },
      ],
      { persist: false },
    );
    await act(async () => root.render(<Probe enabled={false} />));
    expect(container.textContent).toBe("shared");
  });

  it("exposes newer watermarks and rejects older refreshes", async () => {
    const items = [{ key: "selection", title: "Selection", context: "A" }];
    const initial = publishAgentChatContextItems(items, {
      updatedAt: 10,
      persist: false,
    });
    const render = vi.fn();
    let displayedItems: typeof items | undefined;
    function TimestampProbe() {
      const state = useAgentChatContext(false);
      render();
      displayedItems = state.items;
      return (
        <div>{`${state.updatedAt}:${state.items.map((item) => item.key).join(",")}`}</div>
      );
    }

    await act(async () => root.render(<TimestampProbe />));
    const firstDisplayedItems = displayedItems;
    await act(async () => {
      publishAgentChatContextItems(items, { updatedAt: 30, persist: false });
    });
    expect(container.textContent).toBe("30:selection");
    expect(getAgentChatContextState().items).toBe(initial.items);
    expect(displayedItems).toBe(firstDisplayedItems);
    expect(render).toHaveBeenCalledTimes(2);

    await act(async () => {
      publishAgentChatContextItems(items, { updatedAt: 30, persist: false });
    });
    expect(render).toHaveBeenCalledTimes(2);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          values: {
            "agent-chat-context": {
              items: [{ ...items[0], context: "stale" }],
              updatedAt: 20,
            },
          },
          missing: [],
        }),
    });
    await act(async () => {
      await refreshAgentChatContext();
    });
    expect(container.textContent).toBe("30:selection");
    expect(getAgentChatContextState()).toEqual({ items, updatedAt: 30 });
    expect(render).toHaveBeenCalledTimes(2);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          values: { "agent-chat-context": { items, updatedAt: 40 } },
          missing: [],
        }),
    });
    await act(async () => {
      await refreshAgentChatContext();
    });
    expect(container.textContent).toBe("40:selection");
    expect(getAgentChatContextState().items).toBe(initial.items);
    expect(displayedItems).toBe(firstDisplayedItems);
    expect(render).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes for agent chat context and wildcard state changes only", async () => {
    await act(async () => root.render(<Probe enabled />));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(async () => bumpChangeVersion("app-state:selection", 1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => bumpChangeVersion("app-state:agent-chat-context", 2));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    await act(async () => bumpChangeVersion("app-state:*", 3));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
  });
});
