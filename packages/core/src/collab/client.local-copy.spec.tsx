// @vitest-environment happy-dom

/**
 * A doc opened with `localCopy` is drawn and edited from this browser's saved
 * copy before the server answers. The copy is a cache of the server's doc:
 * it only holds state the server acknowledged, the server's answer is a diff
 * against it, and a copy the server's doc does not cover is thrown away.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import { runBeforeSignOutCleanups } from "../client/use-session.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
} from "./client.js";
import {
  _flushCollabLocalCopiesForTests,
  _forgetCollabLocalCopiesInMemoryForTests,
  _setCollabLocalCopyPersistenceForTests,
  type CollabLocalCopyPersistence,
} from "./local-store.js";
import { prefetchCollabState } from "./state-prefetch.js";

const DOC = "local-copy-doc";
const BASE_URL = "/_agent-native/collab";
const ADA = { name: "Ada", email: "ada@example.com", color: "#123456" };
const BOB = { name: "Bob", email: "bob@example.com", color: "#654321" };

type StateResponse = "offline" | "server-error" | "not-found" | "no-vector";

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function textOf(state: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return doc.getText("content").toString();
  } finally {
    doc.destroy();
  }
}

/** Saved copies kept in memory, with IndexedDB's one-account rule. */
function memoryPersistence() {
  let owner: string | null = null;
  let available = true;
  const copies = new Map<string, Uint8Array>();
  const persistence: CollabLocalCopyPersistence = {
    async read(account, key) {
      if (!available) {
        return { status: "unavailable", error: new Error("blocked") };
      }
      if (owner !== null && owner !== account) {
        copies.clear();
        owner = account;
        return { status: "miss" };
      }
      const state = copies.get(key);
      return state ? { status: "hit", state } : { status: "miss" };
    },
    async account() {
      return owner;
    },
    async write(account, writes) {
      if (owner !== account) {
        copies.clear();
        owner = account;
      }
      for (const { key, state } of writes) copies.set(key, state);
    },
    async remove(account, key) {
      if (owner === account) copies.delete(key);
    },
    async clear() {
      copies.clear();
      owner = null;
    },
  };
  return {
    persistence,
    owner: () => owner,
    copy: () => copies.get(`${BASE_URL}\0${DOC}`),
    setAvailable(next: boolean) {
      available = next;
    },
  };
}

function Probe({
  options,
  onResult,
}: {
  options: Partial<UseCollaborativeDocOptions>;
  onResult: (result: UseCollaborativeDocResult) => void;
}) {
  const result = useCollaborativeDoc({
    docId: DOC,
    baseUrl: BASE_URL,
    user: ADA,
    localCopy: true,
    ...options,
  });
  onResult(result);
  return null;
}

describe("collab local copies", () => {
  let root: Root;
  let container: HTMLDivElement;
  let server: Y.Doc;
  let store: ReturnType<typeof memoryPersistence>;
  let stateRequests: string[];
  let stateResponses: StateResponse[];
  let updateResponses: Array<"offline">;
  let holdState: Promise<void> | null;
  let latest: UseCollaborativeDocResult | null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    store = memoryPersistence();
    _setCollabLocalCopyPersistenceForTests(store.persistence);
    server = new Y.Doc();
    server.getText("content").insert(0, "hello");
    stateRequests = [];
    stateResponses = [];
    updateResponses = [];
    holdState = null;
    latest = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          stateRequests.push(url);
          const response = stateResponses.shift();
          if (holdState) await holdState;
          if (response === "offline") throw new TypeError("Failed to fetch");
          if (response === "not-found") {
            return new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
            });
          }
          if (response === "server-error") {
            return new Response("{}", { status: 500 });
          }
          const vector = new URL(url, "http://test").searchParams.get(
            "stateVector",
          );
          const state = vector
            ? Y.encodeStateAsUpdate(server, fromBase64(vector))
            : Y.encodeStateAsUpdate(server);
          const headers = new Headers(init?.headers);
          return new Response(
            JSON.stringify({
              docId: DOC,
              state: toBase64(state),
              ...(vector && response !== "no-vector"
                ? { stateVector: toBase64(Y.encodeStateVector(server)) }
                : {}),
              ...(headers.get("X-Agent-Native-Poll-Baseline") === "1"
                ? {
                    activityBaseline: {
                      status: "ready",
                      version: 1,
                      cursor: "1.baseline",
                    },
                  }
                : {}),
            }),
          );
        }
        if (/\/collab\/[^/]+\/update/.test(url)) {
          if (updateResponses.shift() === "offline") {
            throw new TypeError("Failed to fetch");
          }
          const { update } = JSON.parse(String(init?.body)) as {
            update: string;
          };
          Y.applyUpdate(server, fromBase64(update));
          return new Response(JSON.stringify({ ok: true }));
        }
        if (url.includes("/_agent-native/poll")) {
          return new Response(JSON.stringify({ version: 1, events: [] }));
        }
        return new Response(JSON.stringify({ states: [] }));
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    _setCollabLocalCopyPersistenceForTests(null);
    server.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mount(options: Partial<UseCollaborativeDocOptions> = {}) {
    act(() => {
      root.render(
        <Probe options={options} onResult={(result) => (latest = result)} />,
      );
    });
  }

  function current(): UseCollaborativeDocResult {
    if (!latest) throw new Error("Not mounted");
    return latest;
  }

  function text(): string {
    return current().ydoc?.getText("content").toString() ?? "";
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // Opens the doc from the server, lets its copy save, and leaves the page.
  async function visit(options: Partial<UseCollaborativeDocOptions> = {}) {
    mount(options);
    await advance(50);
    expect(current().isSynced).toBe(true);
    await leave();
  }

  // A page load ends: the connection goes, and only stored copies remain.
  async function leave() {
    act(() => root.unmount());
    _resetCollabDocRegistryForTests();
    await _flushCollabLocalCopiesForTests();
    _forgetCollabLocalCopiesInMemoryForTests();
    root = createRoot(container);
    latest = null;
  }

  function holdStateResponses(): () => void {
    let release!: () => void;
    holdState = new Promise<void>((resolve) => (release = resolve));
    return () => {
      holdState = null;
      release();
    };
  }

  it("opens from the saved copy before the server answers, then takes the server's diff", async () => {
    await visit();
    expect(store.copy() && textOf(store.copy()!)).toBe("hello");

    // Another tab changes the doc while this one is away.
    const otherTab = new Y.Doc();
    Y.applyUpdate(otherTab, Y.encodeStateAsUpdate(server));
    otherTab.getText("content").insert(5, " world");
    Y.applyUpdate(server, Y.encodeStateAsUpdate(otherTab));
    otherTab.destroy();

    const release = holdStateResponses();
    stateRequests = [];
    mount();
    await advance(0);
    expect(current().fromLocalCopy).toBe(true);
    expect(current().isSynced).toBe(false);
    expect(current().initialization).toEqual({ status: "ready" });
    expect(text()).toBe("hello");
    expect(stateRequests).toHaveLength(1);
    expect(stateRequests[0]).toContain("stateVector=");

    release();
    await advance(10);
    expect(text()).toBe("hello world");
    expect(current().isSynced).toBe(true);
    expect(current().fromLocalCopy).toBe(false);
  });

  it("reopens a page in the same tab from memory, in the same task", async () => {
    mount();
    await advance(50);
    act(() => root.unmount());
    // The connection lingers a second, then saves its copy as it goes.
    await advance(1_100);

    root = createRoot(container);
    holdStateResponses();
    act(() => {
      root.render(
        <Probe options={{}} onResult={(result) => (latest = result)} />,
      );
    });
    expect(text()).toBe("hello");
    expect(current().fromLocalCopy).toBe(true);
  });

  it("sends edits made on the saved copy, and saves only what the server acknowledged", async () => {
    await visit();

    const release = holdStateResponses();
    mount();
    await advance(0);
    current().ydoc!.getText("content").insert(5, "!");
    await advance(100);
    // Everything the copy holds, the server has, so the edit is sent now.
    expect(server.getText("content").toString()).toBe("hello!");
    release();
    await advance(10);
    expect(current().isSynced).toBe(true);
    await advance(2_100);
    expect(textOf(store.copy()!)).toBe("hello!");

    // An edit the server never acknowledges is not saved.
    updateResponses.push("offline", "offline", "offline", "offline");
    current().ydoc!.getText("content").insert(6, "?");
    await advance(3_000);
    expect(textOf(store.copy()!)).toBe("hello!");
    await leave();
    expect(textOf(store.copy()!)).toBe("hello!");
  });

  it("keeps a deletion made on the server, however old the saved copy", async () => {
    server.getText("content").insert(5, " world");
    await visit();
    // An agent removes text while the page is closed.
    server.getText("content").delete(5, 6);

    const release = holdStateResponses();
    mount();
    await advance(0);
    expect(text()).toBe("hello world");
    release();
    await advance(10);
    expect(text()).toBe("hello");
    await advance(2_100);
    expect(textOf(store.copy()!)).toBe("hello");
  });

  it("takes an agent's rewrite of the body over an old copy, keeping what was typed meanwhile", async () => {
    await visit();
    // An agent (MCP edit-document) rewrites the body while the page is closed.
    const body = server.getText("content");
    body.delete(0, body.length);
    body.insert(0, "Rewritten by an agent.");

    const release = holdStateResponses();
    mount();
    await advance(0);
    expect(text()).toBe("hello");
    act(() => {
      current().ydoc!.getText("content").insert(5, " and typed");
    });
    release();
    await advance(50);

    expect(text()).toContain("Rewritten by an agent.");
    expect(text()).toContain(" and typed");
    expect(text()).not.toContain("hello");
    expect(server.getText("content").toString()).toBe(text());
  });

  it("throws a saved copy away when the server's doc does not hold it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await visit();
    // The server's doc starts again without the copy's text.
    server.destroy();
    server = new Y.Doc();
    server.getText("content").insert(0, "fresh");

    const release = holdStateResponses();
    mount();
    await advance(0);
    expect(text()).toBe("hello");
    release();
    await advance(50);
    expect(text()).toBe("fresh");
    expect(current().isSynced).toBe(true);
    expect(current().fromLocalCopy).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("holds state the server does not"),
    );
    await advance(2_100);
    expect(textOf(store.copy()!)).toBe("fresh");
  });

  it("forgets the copy and reports the doc unavailable when the server no longer has it", async () => {
    await visit();
    stateResponses.push("not-found");

    const release = holdStateResponses();
    mount();
    await advance(0);
    expect(text()).toBe("hello");
    release();
    await advance(10);
    expect(current().initialization).toEqual({
      status: "error",
      category: "forbidden-or-not-found",
    });
    expect(current().ydoc).toBeNull();
    await _flushCollabLocalCopiesForTests();
    expect(store.copy()).toBeUndefined();
  });

  it("stays editable offline and catches up once the network is back", async () => {
    await visit();
    stateResponses.push("offline");
    updateResponses.push("offline");

    mount();
    await advance(10);
    expect(current().initialization).toEqual({ status: "ready" });
    expect(current().fromLocalCopy).toBe(true);
    current().ydoc!.getText("content").insert(5, " offline");
    await advance(500);
    expect(server.getText("content").toString()).toBe("hello");

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await advance(50);
    expect(current().isSynced).toBe(true);
    await advance(3_000);
    expect(server.getText("content").toString()).toBe("hello offline");
  });

  it("retries a server error without leaving the saved copy", async () => {
    await visit();
    stateResponses.push("server-error");

    mount();
    await advance(10);
    expect(current().initialization).toEqual({ status: "ready" });
    expect(current().isSynced).toBe(false);
    await advance(1_100);
    expect(current().isSynced).toBe(true);
  });

  it("waits for the server's answer when asked to sync", async () => {
    await visit();
    const release = holdStateResponses();
    mount();
    await advance(0);

    let result: unknown;
    void current()
      .requestSync()
      .then((value) => (result = value));
    await advance(10);
    expect(result).toBeUndefined();
    release();
    await advance(10);
    expect(result).toEqual({ status: "synced" });
  });

  it("never opens one account's copy for another", async () => {
    await visit();
    expect(store.owner()).toBe(ADA.email);
    stateRequests = [];

    mount({ user: BOB });
    await advance(50);
    expect(current().isSynced).toBe(true);
    expect(stateRequests).toHaveLength(1);
    expect(stateRequests[0]).not.toContain("stateVector=");
    expect(store.owner()).toBe(BOB.email);
  });

  it("clears every saved copy on sign-out", async () => {
    await visit();
    expect(store.copy()).toBeDefined();
    await runBeforeSignOutCleanups();
    expect(store.copy()).toBeUndefined();
    expect(store.owner()).toBeNull();
  });

  it("opens from the server when saved copies cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await visit();
    store.setAvailable(false);
    stateRequests = [];

    mount();
    await advance(50);
    expect(current().isSynced).toBe(true);
    expect(stateRequests).toHaveLength(1);
    expect(stateRequests[0]).not.toContain("stateVector=");
  });

  it("checks the whole state when the server leaves its vector out", async () => {
    await visit();
    server.getText("content").insert(5, "!");
    stateResponses.push("no-vector");
    stateRequests = [];

    mount();
    await advance(50);
    expect(stateRequests).toHaveLength(2);
    expect(stateRequests[0]).toContain("stateVector=");
    expect(stateRequests[1]).not.toContain("stateVector=");
    expect(text()).toBe("hello!");
    expect(current().isSynced).toBe(true);
  });

  it("takes over the state read started at boot", async () => {
    await visit();
    server.getText("content").insert(5, "!");
    stateRequests = [];

    prefetchCollabState(DOC, { baseUrl: BASE_URL });
    await advance(0);
    expect(stateRequests).toHaveLength(1);
    expect(stateRequests[0]).toContain("stateVector=");

    mount();
    await advance(0);
    expect(current().fromLocalCopy || current().isSynced).toBe(true);
    await advance(50);
    expect(text()).toBe("hello!");
    expect(current().isSynced).toBe(true);
    expect(stateRequests).toHaveLength(1);
  });

  it("takes over a boot read made without a saved copy", async () => {
    stateRequests = [];
    prefetchCollabState(DOC, { baseUrl: BASE_URL });
    await advance(0);
    expect(stateRequests).toHaveLength(1);
    expect(stateRequests[0]).not.toContain("stateVector=");

    mount();
    await advance(50);
    expect(text()).toBe("hello");
    expect(current().isSynced).toBe(true);
    expect(stateRequests).toHaveLength(1);
  });

  it("drops a boot read built on another account's copy", async () => {
    await visit();
    stateRequests = [];
    prefetchCollabState(DOC, { baseUrl: BASE_URL });
    await advance(0);

    mount({ user: BOB });
    await advance(0);
    expect(current().fromLocalCopy).toBe(false);
    await advance(50);
    expect(text()).toBe("hello");
    expect(stateRequests).toHaveLength(2);
    expect(stateRequests[1]).not.toContain("stateVector=");
  });

  it("does not use saved copies unless asked", async () => {
    await visit();
    stateRequests = [];

    mount({ localCopy: false });
    await advance(0);
    expect(current().fromLocalCopy).toBe(false);
    await advance(50);
    expect(current().isSynced).toBe(true);
    expect(stateRequests[0]).not.toContain("stateVector=");
  });
});
