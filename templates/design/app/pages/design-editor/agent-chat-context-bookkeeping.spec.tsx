// @vitest-environment happy-dom

import { publishAgentChatContextItems } from "@agent-native/core/client/agent-chat";
import {
  _resetChangeVersionStoreForTests,
  bumpChangeVersion,
} from "@agent-native/core/client/use-change-version";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentChatContextBookkeeping } from "./agent-chat-context-bookkeeping";

describe("Design agent-chat context bookkeeping", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    _resetChangeVersionStoreForTests();
    publishAgentChatContextItems([], { persist: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps app-state wakes local to the monitor while updating the shared ref", async () => {
    const presentRef = { current: true };
    let parentRenders = 0;
    function Parent() {
      parentRenders++;
      return (
        <AgentChatContextBookkeeping enabled={false} presentRef={presentRef} />
      );
    }

    await act(async () => root.render(<Parent />));
    expect(presentRef.current).toBe(false);
    expect(parentRenders).toBe(1);

    await act(async () => {
      bumpChangeVersion("app-state", 1);
    });
    expect(parentRenders).toBe(1);

    await act(async () => {
      publishAgentChatContextItems(
        [{ key: "design:selected-element", title: "Selection", context: "A" }],
        { persist: false },
      );
    });
    expect(presentRef.current).toBe(true);
    expect(parentRenders).toBe(1);
  });
});
