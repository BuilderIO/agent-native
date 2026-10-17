// @vitest-environment happy-dom

/**
 * Once the server refuses one of a tab's updates as too large, every later
 * update from that tab depends on it. `rebuild` writes the tab's content onto
 * the server's copy as one update under a new client id, once that fits.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
  type CollabUpdateAck,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
} from "./client.js";
import { COLLAB_MAX_STATE_BYTES, COLLAB_MAX_UPDATE_BYTES } from "./limits.js";

const OUTBOX_PREFIX = "agent-native-collab-outbox-v1:";
const USER = { name: "Ada", email: "ada@example.com", color: "#123456" };
const DOC_ID = "rebuild-doc";
const PASTED = "x".repeat(COLLAB_MAX_UPDATE_BYTES + 1000);

function Probe({
  options,
  onResult,
}: {
  options: Partial<UseCollaborativeDocOptions>;
  onResult: (result: UseCollaborativeDocResult) => void;
}) {
  const result = useCollaborativeDoc({
    docId: DOC_ID,
    user: USER,
    durableUpdates: true,
    ...options,
  });
  onResult(result);
  return null;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// Exclusive Web Locks shared by every tab in a test, granted in request
// order: a name is held until the promise its holder's callback returns
// settles.
function installLocks() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const release = (name: string) => {
    const next = waiting.get(name)?.shift();
    if (next) next();
    else held.delete(name);
  };
  const acquire = (name: string, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (!held.has(name)) {
        held.add(name);
        resolve();
        return;
      }
      const queue = waiting.get(name) ?? [];
      waiting.set(name, queue);
      const abort = () => {
        queue.splice(queue.indexOf(grant), 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const grant = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      signal?.addEventListener("abort", abort, { once: true });
      queue.push(grant);
    });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (name: string, ...rest: unknown[]) => {
        const callback = rest[rest.length - 1] as (
          lock: unknown,
        ) => Promise<unknown>;
        const options = (rest.length > 1 ? rest[0] : {}) as {
          ifAvailable?: boolean;
          signal?: AbortSignal;
        };
        if (options.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (options.ifAvailable && held.has(name)) return callback(null);
        await acquire(name, options.signal);
        try {
          return await callback({ name });
        } finally {
          release(name);
        }
      },
      query: async () => ({
        held: Array.from(held, (name) => ({ name })),
        pending: [],
      }),
    },
  });
  return {
    held,
    /** Holds `name` as another open tab would, until the returned call. */
    hold(name: string): () => void {
      expect(held.has(name)).toBe(false);
      held.add(name);
      return () => release(name);
    },
  };
}

const OWNER_LOCK_PREFIX = "agent-native-collab-outbox-owner:";

// The lock a stored entry's connection holds while it keeps that entry.
function ownerLock(key: string): string {
  return OWNER_LOCK_PREFIX + key.slice(key.lastIndexOf(":") + 1);
}

// The key the connection named `owner` keeps its unsent updates under.
function outboxKey(owner: string): string {
  return `${OUTBOX_PREFIX}${encodeURIComponent(
    `/_agent-native/collab\0${DOC_ID}`,
  )}:${encodeURIComponent(USER.email)}:${owner}`;
}

function outboxEntries(): string[] {
  return Object.keys(window.localStorage)
    .filter((key) => key.startsWith(OUTBOX_PREFIX))
    .map((key) => window.localStorage.getItem(key)!);
}

// What an editor bound to `source` writes: its text, changing only the part
// that differs from the doc it writes onto.
function writeTextOf(source: () => Y.Doc) {
  return (doc: Y.Doc) => {
    const want = source().getText("t").toString();
    const text = doc.getText("t");
    const have = text.toString();
    let start = 0;
    while (start < have.length && have[start] === want[start]) start++;
    let end = 0;
    while (
      end < have.length - start &&
      end < want.length - start &&
      have[have.length - 1 - end] === want[want.length - 1 - end]
    ) {
      end++;
    }
    doc.transact(() => {
      text.delete(start, have.length - start - end);
      text.insert(start, want.slice(start, want.length - end));
    });
  };
}

describe("rebuilding a doc whose update the server refused", () => {
  let root: Root;
  let container: HTMLDivElement;
  let server: Y.Doc;
  let sentUpdates: Uint8Array[];
  let pollLog: Array<{
    version: number;
    source: string;
    docId: string;
    update: string;
  }>;
  let stateGate: Promise<void> | null;
  let stateRequests: number;
  let updatesOffline: boolean;
  let otherTabs: Array<() => void>;
  let locks: ReturnType<typeof installLocks>;

  beforeEach(() => {
    locks = installLocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    window.localStorage.clear();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    server = new Y.Doc();
    server.getText("t").insert(0, "kept ");
    sentUpdates = [];
    pollLog = [];
    stateGate = null;
    stateRequests = 0;
    updatesOffline = false;
    otherTabs = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          stateRequests++;
          const vector = new URL(url, "http://test").searchParams.get(
            "stateVector",
          );
          // Read when the request arrives, as a server answers it.
          const state = encode(
            vector
              ? Y.encodeStateAsUpdate(server, decode(vector))
              : Y.encodeStateAsUpdate(server),
          );
          const gate = stateGate;
          return {
            ok: true,
            status: 200,
            json: async () => {
              await gate;
              return { state };
            },
          } as unknown as Response;
        }
        if (/\/collab\/[^/]+\/update/.test(url)) {
          if (updatesOffline) throw new TypeError("Failed to fetch");
          const update = decode(JSON.parse(String(init?.body)).update);
          sentUpdates.push(update);
          // The server measures the document after the update.
          const after = new Y.Doc();
          Y.applyUpdate(after, Y.encodeStateAsUpdate(server));
          Y.applyUpdate(after, update);
          const stateBytes = Y.encodeStateAsUpdate(after).length;
          after.destroy();
          if (
            update.length > COLLAB_MAX_UPDATE_BYTES ||
            stateBytes > COLLAB_MAX_STATE_BYTES
          ) {
            return new Response(JSON.stringify({ error: "too large" }), {
              status: 413,
            });
          }
          Y.applyUpdate(server, update);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (url.includes("/_agent-native/poll")) {
          const since = Number(
            new URL(url, "http://test").searchParams.get("since") ?? 0,
          );
          const events = pollLog.filter((event) => event.version > since);
          return new Response(
            JSON.stringify({ version: pollLog.length, events }),
          );
        }
        return new Response(JSON.stringify({ states: [] }));
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    for (const close of otherTabs) close();
    act(() => root.unmount());
    container.remove();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    vi.restoreAllMocks();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "locks");
  });

  async function mountReady(options: Partial<UseCollaborativeDocOptions> = {}) {
    let latest: UseCollaborativeDocResult | null = null;
    act(() => {
      root.render(
        <Probe options={options} onResult={(result) => (latest = result)} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect((latest as UseCollaborativeDocResult | null)?.ydoc).toBeTruthy();
    return () => latest as unknown as UseCollaborativeDocResult;
  }

  async function settle(ms = 200) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // A tab whose paste the server refused, with typing after it.
  async function refusedAfterPaste(
    options: Partial<UseCollaborativeDocOptions> = {},
  ) {
    const result = await mountReady(options);
    const text = result().ydoc!.getText("t");
    act(() => text.insert(text.length, PASTED));
    await act(async () => {
      await expect(result().flushUpdates()).resolves.toBe(false);
    });
    expect(result().updatesRefused).toBe(true);
    act(() => text.insert(text.length, "typed after"));
    await settle();
    return result;
  }

  function removePaste(result: () => UseCollaborativeDocResult) {
    const text = result().ydoc!.getText("t");
    act(() => text.delete(text.toString().indexOf(PASTED), PASTED.length));
  }

  async function rebuild(result: () => UseCollaborativeDocResult) {
    const doc = result().ydoc!;
    let outcome: Awaited<ReturnType<UseCollaborativeDocResult["rebuild"]>>;
    await act(async () => {
      outcome = await result().rebuild(writeTextOf(() => doc));
    });
    return outcome!;
  }

  // Another tab: the client module loaded again, with its own connections,
  // sharing this one's storage, locks and server. Closing it disposes them,
  // as a closed tab's go.
  async function openOtherTab(
    name: string,
    options: Partial<UseCollaborativeDocOptions> = {},
  ) {
    const tab = (await import(
      /* @vite-ignore */ `./client.js?${name}`
    )) as typeof import("./client.js");
    let latest: UseCollaborativeDocResult | null = null;
    function OtherTab() {
      latest = tab.useCollaborativeDoc({
        docId: DOC_ID,
        user: USER,
        durableUpdates: true,
        ...options,
      });
      return null;
    }
    const element = document.createElement("div");
    document.body.appendChild(element);
    const tabRoot = createRoot(element);
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      act(() => tabRoot.unmount());
      tab._resetCollabDocRegistryForTests();
      element.remove();
    };
    otherTabs.push(close);
    act(() => tabRoot.render(<OtherTab />));
    await settle(50);
    return {
      result: () => latest as unknown as UseCollaborativeDocResult,
      close,
    };
  }

  function closeThisTab() {
    act(() => root.unmount());
    _resetCollabDocRegistryForTests();
    root = createRoot(container);
  }

  function candidateKeys(): string[] {
    return Object.keys(window.localStorage).filter((key) =>
      key.includes(":rebuild:"),
    );
  }

  it("is unavailable until the server refuses an update", async () => {
    const result = await mountReady();
    await expect(result().rebuild(() => {})).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("keeps neither the refused update nor the ones after it", async () => {
    await refusedAfterPaste();

    expect(outboxEntries()).toEqual([]);
    expect(sentUpdates).toHaveLength(1);
  });

  it("sends the content as one update from a new doc once it fits", async () => {
    const result = await refusedAfterPaste();
    const refusedDoc = result().ydoc!;
    removePaste(result);
    sentUpdates = [];
    // The hook still reads the refused doc when the editor stops taking edits.
    const readWhenReplaced: Array<Y.Doc | null> = [];
    const replacedWith: Y.Doc[] = [];

    let outcome: Awaited<ReturnType<UseCollaborativeDocResult["rebuild"]>>;
    await act(async () => {
      outcome = await result().rebuild(
        writeTextOf(() => refusedDoc),
        {
          beforeReplace: (next) => {
            readWhenReplaced.push(result().ydoc);
            replacedWith.push(next);
          },
        },
      );
    });
    await settle();

    expect(readWhenReplaced).toEqual([refusedDoc]);
    expect(replacedWith).toEqual([result().ydoc]);
    expect(outcome!).toEqual({ status: "rebuilt", ydoc: result().ydoc });
    expect(result().ydoc).not.toBe(refusedDoc);
    expect(result().ydoc!.clientID).not.toBe(refusedDoc.clientID);
    expect(result().updatesRefused).toBe(false);
    expect(result().ydoc!.getText("t").toString()).toBe("kept typed after");
    expect(server.getText("t").toString()).toBe("kept typed after");
    expect(sentUpdates).toHaveLength(1);
    expect(outboxEntries()).toEqual([]);
  });

  it("keeps the content, and sends nothing, while it would still be refused", async () => {
    const result = await refusedAfterPaste();
    const refusedDoc = result().ydoc!;
    sentUpdates = [];

    const outcome = await rebuild(result);

    expect(outcome.status).toBe("too_large");
    expect(result().ydoc).toBe(refusedDoc);
    expect(result().updatesRefused).toBe(true);
    expect(sentUpdates).toEqual([]);
    const kept = outboxEntries();
    expect(kept).toHaveLength(1);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(copy, decode(kept[0]));
    expect(copy.getText("t").toString()).toBe(`kept ${PASTED}typed after`);
  });

  it("keeps the typing after a refused paste across a reload, without the paste's own update", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    act(() => root.unmount());
    _resetCollabDocRegistryForTests();
    root = createRoot(container);
    sentUpdates = [];

    const second = await mountReady();
    await settle();
    expect(second().ydoc!.getText("t").toString()).toBe(
      `kept ${PASTED}typed after`,
    );
    expect(second().updatesRefused).toBe(true);
    expect((await rebuild(second)).status).toBe("too_large");
    removePaste(second);
    sentUpdates = [];

    expect((await rebuild(second)).status).toBe("rebuilt");
    await settle();

    expect(server.getText("t").toString()).toBe("kept typed after");
    expect(sentUpdates).toHaveLength(1);
    expect(outboxEntries()).toEqual([]);
  });

  it("holds a collaborator's update that arrives while it rebuilds, so the content holds it once", async () => {
    const result = await refusedAfterPaste();
    removePaste(result);
    const doc = result().ydoc!;
    let openGate!: () => void;
    let rebuilt: Promise<unknown> | null = null;
    // The new doc's state is read before the collaborator's edit lands.
    const gated = stateRequests + 2;
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (/\/collab\/[^/]+\/state/.test(String(input))) {
        stateGate =
          stateRequests + 1 === gated
            ? new Promise<void>((resolve) => (openGate = resolve))
            : null;
      }
      return answer(input, init);
    });

    act(() => {
      rebuilt = result().rebuild(writeTextOf(() => doc));
    });
    await settle(0);
    const collaborator = new Y.Doc();
    Y.applyUpdate(collaborator, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(collaborator);
    collaborator.getText("t").insert(0, "R ");
    const edit = Y.encodeStateAsUpdate(collaborator, before);
    Y.applyUpdate(server, edit);
    pollLog.push({
      version: pollLog.length + 1,
      source: "collab",
      docId: DOC_ID,
      update: encode(edit),
    });
    await settle(2500);
    openGate();
    await act(async () => {
      await expect(rebuilt).resolves.toMatchObject({ status: "rebuilt" });
    });
    await settle(2500);

    expect(server.getText("t").toString()).toBe("R kept typed after");
    expect(result().ydoc!.getText("t").toString()).toBe("R kept typed after");
  });

  it("reports the new doc's acknowledgment to the hook", async () => {
    const acks: CollabUpdateAck[] = [];
    const result = await refusedAfterPaste({
      onUpdateAcknowledged: (ack) => acks.push(ack),
    });
    removePaste(result);

    expect((await rebuild(result)).status).toBe("rebuilt");
    await settle();

    expect(acks).toEqual([{ liveCopy: null }]);
  });

  it("fails, and stays refused, when the content cannot be written", async () => {
    const result = await refusedAfterPaste();

    const outcome = await result().rebuild(() => {
      throw new Error("no editor");
    });

    expect(outcome).toEqual({
      status: "failed",
      error: new Error("no editor"),
    });
    expect(result().updatesRefused).toBe(true);
  });

  it("holds the content once when the page opens again before a reload", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    act(() => root.unmount());
    // Past the connection's linger, in the same page.
    await settle(1100);
    root = createRoot(container);

    const second = await mountReady();
    await settle();

    expect(second().ydoc!.getText("t").toString()).toBe(
      `kept ${PASTED}typed after`,
    );
  });

  it("leaves the content another open tab keeps to that tab, and adopts it once that tab closes", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const [ownKey] = candidateKeys();
    const otherKey = ownKey!.replace(/rebuild:[^:]+$/, "rebuild:other-tab");
    // Another open tab of the same account keeps the paste and its own typing.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(other);
    other.getText("t").insert(5, `${PASTED}other typing`);
    const closeOther = locks.hold(ownerLock(otherKey));
    window.localStorage.setItem(
      otherKey,
      encode(Y.encodeStateAsUpdate(other, before)),
    );
    removePaste(first);
    sentUpdates = [];

    expect((await rebuild(first)).status).toBe("rebuilt");
    await settle();

    expect(server.getText("t").toString()).toBe("kept typed after");
    expect(first().ydoc!.getText("t").toString()).toBe("kept typed after");
    expect(first().updatesRefused).toBe(false);
    expect(sentUpdates).toHaveLength(1);
    expect(window.localStorage.getItem(otherKey)).not.toBeNull();

    // The rebuilt doc waits for that tab's lock, so takes what it kept once it
    // closes.
    closeOther();
    await settle();

    // Both tabs wrote after "kept " at once, so client ids order the two.
    expect([
      `kept ${PASTED}other typingtyped after`,
      `kept typed after${PASTED}other typing`,
    ]).toContain(first().ydoc!.getText("t").toString());
    expect(window.localStorage.getItem(otherKey)).toBeNull();
  });

  it("leaves another open tab's unsent paste to that tab, so the paste is kept once after both close", async () => {
    const pasting = await mountReady();
    act(() => pasting().ydoc!.getText("t").insert(5, PASTED));
    await settle(0);
    // Kept, and not sent yet.
    expect(outboxEntries()).toHaveLength(1);
    expect(sentUpdates).toEqual([]);

    const opened = await openOtherTab("unsent-paste");
    expect(opened.result().ydoc!.getText("t").toString()).toBe("kept ");

    await act(async () => {
      await expect(pasting().flushUpdates()).resolves.toBe(false);
    });
    expect((await rebuild(pasting)).status).toBe("too_large");
    expect(candidateKeys()).toHaveLength(1);
    opened.close();
    closeThisTab();

    const reopened = await mountReady();
    await settle();
    expect(reopened().ydoc!.getText("t").toString()).toBe(`kept ${PASTED}`);
  });

  it("sends what a reloading page kept once the old page lets it go, though the new page loads first", async () => {
    updatesOffline = true;
    const beforeReload = await openOtherTab("before-reload");
    act(() => beforeReload.result().ydoc!.getText("t").insert(5, "word "));
    await settle();
    expect(outboxEntries()).toHaveLength(1);

    const reloaded = await mountReady();
    await settle();
    expect(reloaded().ydoc!.getText("t").toString()).toBe("kept ");
    beforeReload.close();
    await settle();
    expect(reloaded().ydoc!.getText("t").toString()).toBe("kept word ");

    updatesOffline = false;
    await settle(16_000);

    expect(server.getText("t").toString()).toBe("kept word ");
    expect(reloaded().ydoc!.getText("t").toString()).toBe("kept word ");
    expect(outboxEntries()).toEqual([]);
    expect(locks.held.size).toBe(0);
  });

  it("sends what a closed tab kept when the page opens again", async () => {
    updatesOffline = true;
    const closed = await openOtherTab("closed-offline");
    act(() => closed.result().ydoc!.getText("t").insert(5, "word "));
    await settle();
    closed.close();
    updatesOffline = false;

    const reopened = await mountReady();
    await settle();

    expect(reopened().ydoc!.getText("t").toString()).toBe("kept word ");
    expect(server.getText("t").toString()).toBe("kept word ");
    expect(outboxEntries()).toEqual([]);
  });

  it("holds its lock only while it keeps something", async () => {
    const result = await mountReady();
    expect(locks.held.size).toBe(0);
    act(() => result().ydoc!.getText("t").insert(5, "a"));
    await settle(0);
    expect(locks.held.size).toBe(1);
    expect(outboxEntries()).toHaveLength(1);

    await settle();

    expect(server.getText("t").toString()).toBe("kept a");
    expect(outboxEntries()).toEqual([]);
    expect(locks.held.size).toBe(0);
  });

  it("keeps a candidate made after the account changes to this tab", async () => {
    const bea = { ...USER, name: "Bea", email: "bea@example.com" };
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const asBea = await mountReady({ user: bea });
    const text = asBea().ydoc!.getText("t");
    act(() => text.insert(text.length, PASTED));
    await act(async () => {
      await expect(asBea().flushUpdates()).resolves.toBe(false);
    });
    expect((await rebuild(asBea)).status).toBe("too_large");
    const beaKey = candidateKeys().find((key) =>
      key.includes(encodeURIComponent(bea.email)),
    );
    expect(beaKey).toBeTruthy();
    expect(locks.held.has(ownerLock(beaKey!))).toBe(true);

    const elsewhere = await openOtherTab("bea-elsewhere", { user: bea });

    expect(elsewhere.result().ydoc!.getText("t").toString()).toBe("kept ");
    expect(window.localStorage.getItem(beaKey!)).not.toBeNull();
  });

  it("keeps a caller's refused updates for its next visit in the tab when it keeps none in storage", async () => {
    const first = await refusedAfterPaste({ durableUpdates: false });
    removePaste(first);
    expect(first().ydoc!.getText("t").toString()).toBe("kept typed after");
    act(() => root.unmount());
    // Past the connection's linger, in the same page.
    await settle(1100);
    root = createRoot(container);

    const second = await mountReady({ durableUpdates: false });
    await settle();

    expect(second().ydoc!.getText("t").toString()).toBe("kept typed after");
    expect(locks.held.size).toBe(0);
  });

  it("holds the content once when a reload interrupts the handoff to the rebuilt doc", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const [oldKey] = candidateKeys();
    removePaste(first);
    const storage = window.localStorage;
    const removeItem = storage.removeItem.bind(storage);
    let checkpoint: Record<string, string> | undefined;
    const remove = vi.spyOn(storage, "removeItem").mockImplementation((key) => {
      if (key === oldKey) {
        checkpoint = Object.fromEntries(
          Object.keys(storage).map((name) => [name, storage.getItem(name)!]),
        );
      }
      removeItem(key);
    });
    try {
      expect((await rebuild(first)).status).toBe("rebuilt");
    } finally {
      remove.mockRestore();
    }
    // The old candidate and the rebuilt doc's own entry.
    expect(Object.keys(checkpoint!)).toHaveLength(2);
    closeThisTab();
    await settle(1100);
    storage.clear();
    for (const [key, value] of Object.entries(checkpoint!)) {
      storage.setItem(key, value);
    }

    const reopened = await mountReady();
    await settle();

    expect(reopened().ydoc!.getText("t").toString()).toBe("kept typed after");
  });

  it("keeps its candidate, and its doc, while the candidate cannot be replaced", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const [candidateKey] = candidateKeys();
    const kept = window.localStorage.getItem(candidateKey!);
    const refusedDoc = first().ydoc;
    removePaste(first);
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    let outcome: Awaited<ReturnType<UseCollaborativeDocResult["rebuild"]>>;
    try {
      outcome = await rebuild(first);
    } finally {
      setItem.mockRestore();
    }

    expect(outcome.status).toBe("failed");
    expect(first().ydoc).toBe(refusedDoc);
    expect(first().updatesRefused).toBe(true);
    expect(first().durableUpdatesFailed).toBe(true);
    expect(window.localStorage.getItem(candidateKey!)).toBe(kept);
  });

  it("leaves its candidate when the rebuilt doc cannot keep its update, so a reload holds the content once", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const [candidateKey] = candidateKeys();
    removePaste(first);
    updatesOffline = true;
    const storage = window.localStorage;
    const setItem = storage.setItem.bind(storage);
    const store = vi
      .spyOn(storage, "setItem")
      .mockImplementation((key, value) => {
        if (key.startsWith(OUTBOX_PREFIX) && !key.includes(":rebuild:")) {
          throw new DOMException("full", "QuotaExceededError");
        }
        setItem(key, value);
      });
    try {
      expect((await rebuild(first)).status).toBe("rebuilt");
    } finally {
      store.mockRestore();
    }
    expect(first().durableUpdatesFailed).toBe(true);
    expect(candidateKeys()).toEqual([candidateKey]);
    closeThisTab();
    await settle(1100);

    const reopened = await mountReady();
    await settle();

    expect(reopened().ydoc!.getText("t").toString()).toBe("kept typed after");
  });

  // Every outbox write but a candidate's fails while `run` runs.
  async function withOrdinaryWritesFailing<T>(run: () => Promise<T>) {
    const storage = window.localStorage;
    const setItem = storage.setItem.bind(storage);
    const store = vi
      .spyOn(storage, "setItem")
      .mockImplementation((key, value) => {
        if (key.startsWith(OUTBOX_PREFIX) && !key.includes(":rebuild:")) {
          throw new DOMException("full", "QuotaExceededError");
        }
        setItem(key, value);
      });
    try {
      return await run();
    } finally {
      store.mockRestore();
    }
  }

  it("holds a closed tab's entry it cannot keep itself until its candidate does, so the paste is kept once", async () => {
    const closed = new Y.Doc();
    Y.applyUpdate(closed, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(closed);
    closed.getText("t").insert(5, PASTED);
    const closedKey = outboxKey("closed-tab");
    window.localStorage.setItem(
      closedKey,
      encode(Y.encodeStateAsUpdate(closed, before)),
    );
    closed.destroy();

    const result = await withOrdinaryWritesFailing(() => mountReady());
    expect(result().ydoc!.getText("t").toString()).toBe(`kept ${PASTED}`);
    expect(result().durableUpdatesFailed).toBe(true);
    // No other page may adopt the paste while this one holds it unkept.
    expect(window.localStorage.getItem(closedKey)).not.toBeNull();
    expect(locks.held.has(ownerLock(closedKey))).toBe(true);

    await act(async () => {
      await expect(result().flushUpdates()).resolves.toBe(false);
    });
    expect((await rebuild(result)).status).toBe("too_large");

    expect(window.localStorage.getItem(closedKey)).toBeNull();
    expect(locks.held.has(ownerLock(closedKey))).toBe(false);
    expect(candidateKeys()).toHaveLength(1);
    expect(outboxEntries()).toHaveLength(1);
    closeThisTab();
    await settle(1100);

    const reopened = await mountReady();
    await settle();
    expect(reopened().ydoc!.getText("t").toString()).toBe(`kept ${PASTED}`);
  });

  it("hands the candidate it leaves to the rebuilt doc, whose own candidate replaces it", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const [oldKey] = candidateKeys();
    removePaste(first);
    expect((await withOrdinaryWritesFailing(() => rebuild(first))).status).toBe(
      "rebuilt",
    );
    expect(candidateKeys()).toEqual([oldKey]);
    expect(locks.held.has(ownerLock(oldKey!))).toBe(true);
    // A collaborator fills the doc before the rebuilt update is sent, so the
    // server refuses it for the state it would make.
    const filler = server.getText("t");
    const missing = () =>
      COLLAB_MAX_STATE_BYTES - 8 - Y.encodeStateAsUpdate(server).length;
    filler.insert(filler.length, "c".repeat(missing() - 16));
    while (missing() > 0) filler.insert(filler.length, "c".repeat(missing()));
    expect(missing()).toBe(0);
    await act(async () => {
      await expect(first().flushUpdates()).resolves.toBe(false);
    });
    expect(first().updatesRefused).toBe(true);

    expect((await rebuild(first)).status).toBe("too_large");

    const content = first().ydoc!.getText("t").toString();
    expect(content.split("typed after")).toHaveLength(2);
    expect(candidateKeys()).toHaveLength(1);
    expect(window.localStorage.getItem(oldKey!)).toBeNull();
    expect(locks.held.has(ownerLock(oldKey!))).toBe(false);
    closeThisTab();
    await settle(1100);

    const reopened = await mountReady();
    await settle();
    expect(reopened().ydoc!.getText("t").toString()).toBe(content);
  });

  it("saves a deletion that leaves a doc at the size limit smaller", async () => {
    const seed = (length: number) => {
      server.destroy();
      server = new Y.Doc();
      server.clientID = 12345;
      server.getText("t").insert(0, "a".repeat(length));
      return Y.encodeStateAsUpdate(server).length - length;
    };
    seed(COLLAB_MAX_STATE_BYTES - 8 - seed(COLLAB_MAX_STATE_BYTES));
    // A few bytes under the limit, so a little more typing is refused.
    expect(Y.encodeStateAsUpdate(server).length).toBe(
      COLLAB_MAX_STATE_BYTES - 8,
    );
    const result = await mountReady();
    const text = result().ydoc!.getText("t");
    act(() => text.insert(text.length, "z".repeat(100)));
    await act(async () => {
      await expect(result().flushUpdates()).resolves.toBe(false);
    });
    expect(result().updatesRefused).toBe(true);
    act(() => {
      text.delete(0, text.length);
      text.insert(0, "recovered");
    });

    expect((await rebuild(result)).status).toBe("rebuilt");
    await settle();

    expect(server.getText("t").toString()).toBe("recovered");
  });
});
