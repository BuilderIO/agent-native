// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const fake = {
    rows,
    writes: 0,
    readClientAppState: async (key: string) => {
      const row = rows.get(key);
      return row === undefined ? null : JSON.parse(row);
    },
    readClientAppStateMany: async (keys: readonly string[]) => {
      const values: Record<string, unknown> = {};
      for (const key of keys) {
        const row = rows.get(key);
        if (row !== undefined) values[key] = JSON.parse(row);
      }
      return { values, missing: keys.filter((key) => !rows.has(key)) };
    },
    compareAndSetClientAppState: async (
      key: string,
      expected: Record<string, unknown> | null,
      next: Record<string, unknown> | null,
    ) => {
      fake.writes += 1;
      const row = rows.get(key);
      if (
        expected === null ? row !== undefined : row !== JSON.stringify(expected)
      ) {
        return false;
      }
      if (next === null) rows.delete(key);
      else rows.set(key, JSON.stringify(next));
      return true;
    },
  };
  return fake;
});

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: appState.readClientAppState,
  readClientAppStateMany: appState.readClientAppStateMany,
  compareAndSetClientAppState: appState.compareAndSetClientAppState,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { title?: string }) =>
    key === "agentChat.documentTitle.running"
      ? `Working · ${options?.title}`
      : key === "agentChat.documentTitle.replyReady"
        ? `Reply ready · ${options?.title}`
        : key,
}));

import { registerChatThreadView } from "../../agentkit/react/viewed-threads.js";
import { AgentRunAwareness } from "./AgentRunAwareness.js";
import {
  CHAT_UNREAD_STATE_KEY,
  resetChatUnreadStateForTests,
} from "./chat-unread-state.js";

let visibility: DocumentVisibilityState = "visible";
let container: HTMLDivElement;
let root: Root;
const cleanups: Array<() => void> = [];

function unreadIds(): string[] {
  const row = appState.rows.get(CHAT_UNREAD_STATE_KEY);
  return row === undefined ? [] : Object.keys(JSON.parse(row).threads).sort();
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** Puts a transcript for `threadId` on screen, as MultiTabAssistantChat does. */
function showThread(threadId: string): () => void {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(element);
  let unregister!: () => void;
  act(() => {
    unregister = registerChatThreadView(threadId, element);
  });
  const hide = () => {
    unregister();
    element.remove();
  };
  cleanups.push(hide);
  return hide;
}

async function runChat(
  threadId: string,
  reason: string = "run.completed",
): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: true, phase: "working", threadId },
      }),
    );
  });
  expect(document.title).toBe("Working · Inbox");
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, phase: "idle", threadId, reason },
      }),
    );
  });
  await flush();
}

async function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();
}

describe("AgentRunAwareness", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    visibility = "visible";
    appState.rows.clear();
    appState.writes = 0;
    resetChatUnreadStateForTests();
    document.title = "Inbox";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<AgentRunAwareness renderFavicon={null} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.innerHTML = "";
    resetChatUnreadStateForTests();
    vi.unstubAllGlobals();
  });

  it("marks a chat unread when its reply finishes while another chat is open", async () => {
    showThread("b");
    await runChat("a");
    expect(unreadIds()).toEqual(["a"]);
    // The tab was visible, so the title only showed the run while it lasted.
    expect(document.title).toBe("Inbox");
  });

  it("leaves a chat read when its reply finishes while it is open", async () => {
    showThread("a");
    await runChat("a");
    expect(unreadIds()).toEqual([]);
    expect(appState.writes).toBe(0);
    expect(document.title).toBe("Inbox");
  });

  it("clears the unread mark when the chat is opened", async () => {
    const hideB = showThread("b");
    await runChat("a");
    expect(unreadIds()).toEqual(["a"]);
    hideB();
    showThread("a");
    await flush();
    expect(unreadIds()).toEqual([]);
  });

  it("does not mark a cancelled run unread", async () => {
    showThread("b");
    await runChat("a", "run.cancelled");
    expect(unreadIds()).toEqual([]);
  });

  it("shows reply ready in a hidden tab until it is visible, then clears the open chat", async () => {
    showThread("a");
    visibility = "hidden";
    await runChat("a");
    expect(document.title).toBe("Reply ready · Inbox");
    // Nobody was looking, even at the open chat.
    expect(unreadIds()).toEqual(["a"]);
    await setVisibility("visible");
    expect(document.title).toBe("Inbox");
    expect(unreadIds()).toEqual([]);
  });

  it("does not treat a chat in a closed sidebar as viewed", async () => {
    const sidebar = document.createElement("aside");
    sidebar.setAttribute("inert", "");
    document.body.appendChild(sidebar);
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
      }) as DOMRect;
    sidebar.appendChild(element);
    let unregister!: () => void;
    act(() => {
      unregister = registerChatThreadView("a", element);
    });
    cleanups.push(unregister);
    await runChat("a");
    expect(unreadIds()).toEqual(["a"]);
  });
});
