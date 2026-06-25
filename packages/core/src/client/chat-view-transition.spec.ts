// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { SIDEBAR_OPEN_KEY } from "./agent-sidebar-state.js";
import {
  AGENT_CHAT_HOME_HANDOFF_TTL_MS,
  AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT,
  AGENT_CHAT_VIEW_TRANSITION_NAME,
  consumeAgentChatHomeHandoff,
  getAgentChatViewTransitionStyle,
  markAgentChatHomeHandoff,
  startAgentChatViewTransition,
  supportsAgentChatViewTransition,
  type AgentChatViewTransition,
} from "./chat-view-transition.js";

function fakeTransition(): AgentChatViewTransition {
  return {
    ready: Promise.resolve(),
    finished: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
    skipTransition: vi.fn(),
  };
}

describe("chat view-transition helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "startViewTransition");
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs without transition support", () => {
    const update = vi.fn();

    const transition = startAgentChatViewTransition(update);

    expect(transition).toBeNull();
    expect(update).toHaveBeenCalledOnce();
    expect(supportsAgentChatViewTransition()).toBe(false);
  });

  it("dispatches a prepare event before navigation updates", () => {
    const calls: string[] = [];
    const handler = vi.fn(() => calls.push("prepare"));
    window.addEventListener(AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT, handler);

    startAgentChatViewTransition(() => calls.push("update"));

    expect(handler).toHaveBeenCalledOnce();
    expect(calls).toEqual(["prepare", "update"]);
    window.removeEventListener(
      AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT,
      handler,
    );
  });

  it("wraps updates with document.startViewTransition when available", () => {
    const transition = fakeTransition();
    const update = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return transition;
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    const result = startAgentChatViewTransition(update);

    expect(result).toBe(transition);
    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(supportsAgentChatViewTransition()).toBe(true);
  });

  it("observes transition promise rejections so aborts do not surface as unhandled", () => {
    const ready = { catch: vi.fn() } as unknown as Promise<void>;
    const finished = { catch: vi.fn() } as unknown as Promise<void>;
    const updateCallbackDone = { catch: vi.fn() } as unknown as Promise<void>;
    const transition: AgentChatViewTransition = {
      ready,
      finished,
      updateCallbackDone,
      skipTransition: vi.fn(),
    };
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(() => transition),
    });

    expect(startAgentChatViewTransition(vi.fn())).toBe(transition);
    expect(ready.catch).toHaveBeenCalledOnce();
    expect(finished.catch).toHaveBeenCalledOnce();
    expect(updateCallbackDone.catch).toHaveBeenCalledOnce();
  });

  it("skips transitions when reduced motion is preferred", () => {
    const update = vi.fn();
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const result = startAgentChatViewTransition(update);

    expect(result).toBeNull();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it("builds a stable inline style for shared chat morph targets", () => {
    expect(getAgentChatViewTransitionStyle({ backgroundColor: "red" })).toEqual(
      {
        backgroundColor: "red",
        viewTransitionName: AGENT_CHAT_VIEW_TRANSITION_NAME,
      },
    );
  });

  it("marks and consumes a namespaced chat-home handoff once", () => {
    markAgentChatHomeHandoff("forms");

    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBeNull();
    expect(consumeAgentChatHomeHandoff("forms")).toBe(true);
    expect(consumeAgentChatHomeHandoff("forms")).toBe(false);
  });

  it("ignores expired chat-home handoffs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    markAgentChatHomeHandoff("forms");

    vi.setSystemTime(1_000 + AGENT_CHAT_HOME_HANDOFF_TTL_MS + 1);

    expect(consumeAgentChatHomeHandoff("forms")).toBe(false);
  });
});
