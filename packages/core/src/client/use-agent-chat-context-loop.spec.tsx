// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  _resetAgentChatContextForTests,
  getAgentChatContextState,
  publishAgentChatContextItems,
} from "./agent-chat.js";
import { useAgentChatContext } from "./use-agent-chat-context.js";
import { _resetChangeVersionStoreForTests } from "./use-change-version.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  _resetAgentChatContextForTests();
  _resetChangeVersionStoreForTests();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  _resetAgentChatContextForTests();
  _resetChangeVersionStoreForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not loop when an effect republishes identical context", async () => {
  const items = [{ key: "selection", title: "Selection", context: "A" }];
  const initial = publishAgentChatContextItems(items, {
    updatedAt: 10,
    persist: false,
  });
  let now = 100;
  vi.spyOn(Date, "now").mockImplementation(() => now++);
  const effect = vi.fn();
  function RepublishProbe() {
    const state = useAgentChatContext(false);
    useEffect(() => {
      effect();
      if (effect.mock.calls.length < 8) {
        publishAgentChatContextItems(items, { persist: false });
      }
    }, [state.items, state.updatedAt]);
    return <div>{state.updatedAt}</div>;
  }

  await act(async () => root.render(<RepublishProbe />));
  expect(effect).toHaveBeenCalledOnce();
  expect(container.textContent).toBe("10");
  expect(getAgentChatContextState()).toBe(initial);
});
