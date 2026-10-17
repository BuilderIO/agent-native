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

// Web Locks shared by every tab in a test: a name is held until the promise
// its holder's callback returns settles.
function installLocks(): Set<string> {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (name: string, ...rest: unknown[]) => {
        const callback = rest[rest.length - 1] as () => Promise<unknown>;
        held.add(name);
        try {
          return await callback();
        } finally {
          held.delete(name);
        }
      },
      query: async () => ({
        held: Array.from(held, (name) => ({ name })),
        pending: [],
      }),
    },
  });
  return held;
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
  let heldLocks: Set<string>;

  beforeEach(() => {
    heldLocks = installLocks();
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

  it("leaves the content another open tab keeps to that tab", async () => {
    const first = await refusedAfterPaste();
    expect((await rebuild(first)).status).toBe("too_large");
    const [ownKey] = Object.keys(window.localStorage);
    const otherKey = ownKey!.replace(/rebuild:[^:]+$/, "rebuild:other-tab");
    // Another tab of the same account keeps the paste and its own typing.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(other);
    other.getText("t").insert(5, `${PASTED}other typing`);
    window.localStorage.setItem(
      otherKey,
      encode(Y.encodeStateAsUpdate(other, before)),
    );
    heldLocks.add(otherKey);
    removePaste(first);
    sentUpdates = [];

    expect((await rebuild(first)).status).toBe("rebuilt");
    await settle();

    expect(server.getText("t").toString()).toBe("kept typed after");
    expect(first().ydoc!.getText("t").toString()).toBe("kept typed after");
    expect(first().updatesRefused).toBe(false);
    expect(sentUpdates).toHaveLength(1);
    expect(window.localStorage.getItem(otherKey)).not.toBeNull();

    // Once that tab is gone, the next open adopts what it kept.
    heldLocks.delete(otherKey);
    act(() => root.unmount());
    _resetCollabDocRegistryForTests();
    root = createRoot(container);
    const reopened = await mountReady();
    await settle();

    // Both tabs wrote after "kept " at once, so client ids order the two.
    expect([
      `kept ${PASTED}other typingtyped after`,
      `kept typed after${PASTED}other typing`,
    ]).toContain(reopened().ydoc!.getText("t").toString());
    expect(window.localStorage.getItem(otherKey)).toBeNull();
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
