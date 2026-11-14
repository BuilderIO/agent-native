// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const fake = {
    rows,
    beforeCompare: null as null | (() => void),
    readFails: null as null | Error,
    readClientAppState: async (key: string) => {
      if (fake.readFails) throw fake.readFails;
      const row = rows.get(key);
      return row === undefined ? null : JSON.parse(row);
    },
    readClientAppStateMany: async (keys: readonly string[]) => {
      const values: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const key of keys) {
        const row = rows.get(key);
        if (row === undefined) missing.push(key);
        else values[key] = JSON.parse(row);
      }
      return { values, missing };
    },
    // The server compares serialized text, so this fake does too.
    compareAndSetClientAppState: async (
      key: string,
      expected: Record<string, unknown> | null,
      next: Record<string, unknown> | null,
    ) => {
      fake.beforeCompare?.();
      const row = rows.get(key);
      const matches =
        expected === null
          ? row === undefined
          : row === JSON.stringify(expected);
      if (!matches) return false;
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

import {
  CHAT_UNREAD_STATE_KEY,
  ChatUnreadStateUnreadableError,
  MAX_UNREAD_CHATS,
  markChatThreadRead,
  markChatThreadUnread,
  parseChatUnreadState,
  resetChatUnreadStateForTests,
  useChatUnreadThreads,
  withChatUnread,
  type ChatUnreadThreads,
} from "./chat-unread-state.js";

let latest: ChatUnreadThreads | null = null;
let root: Root | null = null;

function Probe({ enabled }: { enabled?: boolean }) {
  latest = useChatUnreadThreads({ enabled });
  return null;
}

async function renderUnread(props: { enabled?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Probe, props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return latest!;
}

function stored() {
  const row = appState.rows.get(CHAT_UNREAD_STATE_KEY);
  return row === undefined ? undefined : JSON.parse(row);
}

describe("chat unread state", () => {
  beforeEach(() => {
    appState.rows.clear();
    appState.beforeCompare = null;
    appState.readFails = null;
    resetChatUnreadStateForTests();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    latest = null;
    document.body.innerHTML = "";
    resetChatUnreadStateForTests();
    vi.unstubAllGlobals();
  });

  it("reads an absent row as nothing unread and anything malformed as unreadable", () => {
    expect(parseChatUnreadState(null)).toEqual({ threads: {} });
    for (const value of [
      "x",
      [],
      {},
      { threads: [] },
      { threads: { a: "soon" } },
      { threads: { a: Number.NaN } },
    ]) {
      expect(() => parseChatUnreadState(value)).toThrow(
        ChatUnreadStateUnreadableError,
      );
    }
  });

  it("keeps the newest unread chats when the cap is reached", () => {
    let state = { threads: {} as Record<string, number> };
    for (let i = 0; i < MAX_UNREAD_CHATS + 5; i += 1) {
      state = withChatUnread(state, `t${i}`, i);
    }
    const ids = Object.keys(state.threads);
    expect(ids).toHaveLength(MAX_UNREAD_CHATS);
    expect(ids).not.toContain("t0");
    expect(ids).toContain(`t${MAX_UNREAD_CHATS + 4}`);
  });

  it("marks a chat unread, then read, and deletes the row when nothing is left", async () => {
    await markChatThreadUnread("a", 10);
    await markChatThreadUnread("b", 20);
    expect(stored()).toEqual({ threads: { a: 10, b: 20 } });
    await markChatThreadRead("a");
    expect(stored()).toEqual({ threads: { b: 20 } });
    await markChatThreadRead("b");
    expect(stored()).toBeUndefined();
    // Reading a chat that is not unread writes nothing.
    await markChatThreadRead("b");
    expect(stored()).toBeUndefined();
  });

  it("retries on a concurrent write and keeps the other writer's chat", async () => {
    await markChatThreadUnread("a", 10);
    let raced = false;
    appState.beforeCompare = () => {
      if (raced) return;
      raced = true;
      appState.rows.set(
        CHAT_UNREAD_STATE_KEY,
        JSON.stringify({ threads: { a: 10, other: 15 } }),
      );
    };
    await markChatThreadUnread("b", 20);
    expect(stored()).toEqual({ threads: { a: 10, other: 15, b: 20 } });
  });

  it("refuses to overwrite a row it cannot read", async () => {
    appState.rows.set(CHAT_UNREAD_STATE_KEY, JSON.stringify({ unread: ["a"] }));
    await expect(markChatThreadUnread("b", 20)).rejects.toThrow(
      ChatUnreadStateUnreadableError,
    );
    expect(stored()).toEqual({ unread: ["a"] });
  });

  it("gives up loudly when another writer keeps winning", async () => {
    let n = 0;
    appState.beforeCompare = () => {
      n += 1;
      appState.rows.set(
        CHAT_UNREAD_STATE_KEY,
        JSON.stringify({ threads: { [`w${n}`]: n } }),
      );
    };
    await expect(markChatThreadUnread("b", 20)).rejects.toThrow(/not saved/);
  });

  it("reports a failed load as unreadable, not as nothing unread", async () => {
    appState.readFails = new Error("503");
    const seen = await renderUnread();
    expect(seen.status).toBe("unreadable");
    expect(seen.unreadThreadIds.size).toBe(0);
  });

  it("loads unread chats for a list and reflects this tab's writes", async () => {
    appState.rows.set(
      CHAT_UNREAD_STATE_KEY,
      JSON.stringify({ threads: { a: 10 } }),
    );
    const seen = await renderUnread();
    expect(seen.status).toBe("ready");
    expect([...seen.unreadThreadIds]).toEqual(["a"]);
    await act(async () => {
      await markChatThreadUnread("b", 20);
    });
    expect([...latest!.unreadThreadIds].sort()).toEqual(["a", "b"]);
  });

  it("only reports what is loaded when not enabled", async () => {
    appState.rows.set(
      CHAT_UNREAD_STATE_KEY,
      JSON.stringify({ threads: { a: 10 } }),
    );
    const seen = await renderUnread({ enabled: false });
    expect(seen.status).toBe("loading");
  });
});
