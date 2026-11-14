// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type {
  AgentThreadSnapshot,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
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
  useT: () => (key: string) => key,
}));

import { AgentKitChat } from "../../agentkit/react/components.js";
import { AgentKitProvider } from "../../agentkit/react/context.js";
import { AgentRunAwareness } from "./AgentRunAwareness.js";
import {
  CHAT_UNREAD_STATE_KEY,
  resetChatUnreadStateForTests,
  useChatUnreadThreads,
} from "./chat-unread-state.js";

/** Stands in for the sidebar list, which is what loads the stored row. */
function UnreadList() {
  const unread = useChatUnreadThreads();
  return <output data-unread={[...unread.unreadThreadIds].join(",")} />;
}

const at = "2026-10-24T00:00:00.000Z";

function snapshot(id: string): AgentThreadSnapshot {
  return {
    id,
    createdAt: at,
    updatedAt: at,
    messages: [
      { id: `${id}-user`, role: "user", parts: [{ type: "text", text: "Hi" }] },
      {
        id: `${id}-assistant`,
        role: "assistant",
        parts: [{ type: "text", text: "Hello." }],
      },
    ],
    runs: [],
    activeRunIds: [],
  };
}

let client: AgentKitClient;
let container: HTMLDivElement;
let root: Root;

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

/** A full-page chat route: AgentKitChat on its own, with no tab host. */
async function showChat(threadId: string) {
  await act(async () => {
    root.render(
      <>
        <AgentRunAwareness renderFavicon={null} />
        <UnreadList />
        <AgentKitProvider controller={client} threadId={threadId}>
          <AgentKitChat composer={false} />
        </AgentKitProvider>
      </>,
    );
  });
  await flush();
}

async function finishRun(threadId: string) {
  for (const detail of [
    { isRunning: true, phase: "working", threadId },
    { isRunning: false, phase: "idle", threadId, reason: "run.completed" },
  ]) {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", { detail }),
      );
    });
  }
  await flush();
}

describe("unread chats with AgentKitChat on its own", () => {
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // happy-dom does no layout; give every element an on-screen box.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 600,
      width: 600,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect);
    appState.rows.clear();
    appState.writes = 0;
    resetChatUnreadStateForTests();
    const transport = {
      capabilities: {},
      assertAiSetupReady: vi.fn(async () => {}),
      async getThreadSnapshot(id: string) {
        return snapshot(id);
      },
      async startRun() {
        return { runId: "run-2" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    } satisfies AgentTransport;
    client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");
    await client.loadThread("thread-2");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.dispose();
    container.remove();
    resetChatUnreadStateForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("leaves a chat read when its reply finishes while it is open", async () => {
    await showChat("thread-1");
    await finishRun("thread-1");
    expect(unreadIds()).toEqual([]);
    expect(appState.writes).toBe(0);
  });

  it("marks another chat unread and clears it when that chat is opened", async () => {
    await showChat("thread-2");
    await finishRun("thread-1");
    expect(unreadIds()).toEqual(["thread-1"]);

    await showChat("thread-1");
    expect(unreadIds()).toEqual([]);
  });

  it("clears a chat marked unread in an earlier session when navigation opens it", async () => {
    appState.rows.set(
      CHAT_UNREAD_STATE_KEY,
      JSON.stringify({ threads: { "thread-1": 1 } }),
    );
    await showChat("thread-2");
    expect(container.querySelector("output")?.getAttribute("data-unread")).toBe(
      "thread-1",
    );

    await showChat("thread-1");
    expect(unreadIds()).toEqual([]);
    expect(container.querySelector("output")?.getAttribute("data-unread")).toBe(
      "",
    );
  });
});
