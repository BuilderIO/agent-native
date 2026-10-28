// @vitest-environment happy-dom

/**
 * A caller whose edits reach the server only through the collab doc keeps
 * them in localStorage until the server acknowledges them, so a refresh, a
 * closed tab, or a stretch offline does not drop them.
 */
import { format } from "node:util";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import * as Y from "yjs";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
  type CollabUpdateAck,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
} from "./client.js";

const OUTBOX_PREFIX = "agent-native-collab-outbox-v1:";
const STRICT_OUTBOX_PREFIX = "agent-native-collab-outbox-v2:";
const USER = { name: "Ada", email: "ada@example.com", color: "#123456" };

function Probe({
  options,
  onResult,
}: {
  options: Partial<UseCollaborativeDocOptions>;
  onResult: (result: UseCollaborativeDocResult) => void;
}) {
  const result = useCollaborativeDoc({
    docId: "durable-updates-doc",
    user: USER,
    ...options,
  });
  onResult(result);
  return null;
}

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function outboxKeys(): string[] {
  return Object.keys(window.localStorage).filter(
    (key) =>
      key.startsWith(OUTBOX_PREFIX) || key.startsWith(STRICT_OUTBOX_PREFIX),
  );
}

type TestLockCallback = (
  lock: Pick<Lock, "name" | "mode"> | null,
) => void | Promise<void>;

function createTestLocks() {
  const held = new Map<string, Promise<void>>();
  return {
    request: vi.fn(
      async (
        name: string,
        optionsOrCallback: { ifAvailable?: boolean } | TestLockCallback,
        requestedCallback?: TestLockCallback,
      ) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : requestedCallback;
        if (!callback) throw new Error("Missing lock callback");
        const previous = held.get(name);
        if (
          typeof optionsOrCallback !== "function" &&
          optionsOrCallback.ifAvailable &&
          previous
        ) {
          await callback(null);
          return;
        }
        let release!: () => void;
        const finished = new Promise<void>((resolve) => {
          release = resolve;
        });
        held.set(name, finished);
        if (previous) await previous;
        try {
          await callback({ name, mode: "exclusive" });
        } finally {
          if (held.get(name) === finished) held.delete(name);
          release();
        }
      },
    ),
  };
}

describe("collab durable updates", () => {
  let root: Root;
  let container: HTMLDivElement;
  let updateResponses: Array<"offline" | "unreadable" | "too_large" | object>;
  let sentUpdates: Uint8Array[];
  let locks: ReturnType<typeof createTestLocks>;
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    locks = createTestLocks();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks,
    });
    window.localStorage.clear();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    updateResponses = [];
    sentUpdates = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          return new Response(
            JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
          );
        }
        if (/\/collab\/[^/]+\/update/.test(url)) {
          sentUpdates.push(
            decode(JSON.parse(String(init?.body)).update as string),
          );
          const response = updateResponses.shift() ?? { ok: true };
          if (response === "offline") throw new TypeError("Failed to fetch");
          if (response === "unreadable") return new Response("<html>");
          if (response === "too_large") {
            const error = JSON.stringify({ error: "Payload too large" });
            return new Response(error, { status: 413 });
          }
          return new Response(JSON.stringify(response));
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
    vi.restoreAllMocks();
    if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
    else Reflect.deleteProperty(navigator, "locks");
    window.localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mountReady(options: Partial<UseCollaborativeDocOptions>) {
    let latest: UseCollaborativeDocResult | null = null;
    act(() => {
      root.render(
        <Probe options={options} onResult={(result) => (latest = result)} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const ready = latest as UseCollaborativeDocResult | null;
    expect(ready?.ydoc).toBeTruthy();
    return () => latest as unknown as UseCollaborativeDocResult;
  }

  // A closed tab: its connection goes away without an acknowledgment, and
  // nothing it held in memory reaches the next page load.
  async function closeTab() {
    updateResponses.push("offline");
    act(() => root.unmount());
    _resetCollabDocRegistryForTests();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    root = createRoot(container);
  }

  function holdUpdateResponse() {
    const originalFetch = fetch;
    let release!: () => void;
    let held = false;
    const responseGate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await originalFetch(input, init);
        if (/\/collab\/[^/]+\/update/.test(String(input)) && !held) {
          held = true;
          await responseGate;
        }
        return response;
      }),
    );
    return release;
  }

  function serveCommittedUpdates(
    maxUpdateBytes: () => number = () => Infinity,
  ) {
    const server = new Y.Doc();
    const requests: RequestInit[] = [];
    onTestFinished(() => server.destroy());
    const originalFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (/\/collab\/[^/]+\/state/.test(String(input))) {
          return new Response(
            JSON.stringify({
              state: btoa(
                String.fromCharCode(...Y.encodeStateAsUpdate(server)),
              ),
            }),
          );
        }
        const isUpdate = /\/collab\/[^/]+\/update/.test(String(input));
        if (isUpdate) requests.push(init ?? {});
        const response = await originalFetch(input, init);
        if (isUpdate && response.ok) {
          const update = decode(JSON.parse(String(init?.body)).update);
          if (update.length > maxUpdateBytes())
            return new Response("Payload too large", { status: 413 });
          const candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server));
            Y.applyUpdate(candidate, update);
            if (
              candidate.store.pendingStructs !== null ||
              candidate.store.pendingDs !== null
            )
              return new Response(
                JSON.stringify({
                  errorCode: "malformed_state",
                  reason: "missing_dependencies",
                }),
                { status: 400 },
              );
            Y.applyUpdate(server, update);
          } finally {
            candidate.destroy();
          }
        }
        return response;
      }),
    );
    return { server, requests };
  }

  const transitionRows: Array<{
    name: string;
    baseline: string;
    run: () => Promise<void>;
  }> = [
    {
      name: "keeps an unacknowledged update until the server acknowledges it",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({ durableUpdates: true });
        updateResponses = ["offline"];
        result().ydoc!.getText("t").insert(0, "typed offline");
        await expect(result().flushUpdates()).resolves.toBe(false);
        expect(outboxKeys()).toHaveLength(1);

        await expect(result().flushUpdates()).resolves.toBe(true);
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "sends what a closed tab kept when the doc opens again",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        updateResponses = ["offline"];
        first().ydoc!.getText("t").insert(0, "kept");
        await expect(first().flushUpdates()).resolves.toBe(false);
        await closeTab();
        expect(outboxKeys()).toHaveLength(1);
        sentUpdates = [];

        await mountReady({ durableUpdates: true });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });

        const server = new Y.Doc();
        for (const update of sentUpdates) Y.applyUpdate(server, update);
        expect(server.getText("t").toString()).toBe("kept");
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "leaves another account's kept updates alone",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        updateResponses = ["offline"];
        first().ydoc!.getText("t").insert(0, "theirs");
        await expect(first().flushUpdates()).resolves.toBe(false);
        await closeTab();
        sentUpdates = [];

        await mountReady({
          durableUpdates: true,
          user: { ...USER, email: "grace@example.com" },
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });

        expect(sentUpdates).toEqual([]);
        expect(outboxKeys()).toHaveLength(1);
      },
    },
    {
      name: "sends an account's kept updates when it signs in on an open doc",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const grace = { ...USER, email: "grace@example.com" };
        const first = await mountReady({ durableUpdates: true, user: grace });
        updateResponses = ["offline"];
        first().ydoc!.getText("t").insert(0, "theirs");
        await expect(first().flushUpdates()).resolves.toBe(false);
        await closeTab();
        await mountReady({ durableUpdates: true });
        sentUpdates = [];

        await mountReady({ durableUpdates: true, user: grace });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });

        const server = new Y.Doc();
        for (const update of sentUpdates) Y.applyUpdate(server, update);
        expect(server.getText("t").toString()).toBe("theirs");
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "does not give an earlier account's ordinary updates the next account's strict custody",
      baseline:
        "Regression: exact 008402 fails this transition’s retained runtime assertion.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        first().ydoc!.getText("t").insert(0, "ordinary account A");
        updateResponses = ["offline"];
        await expect(first().flushUpdates()).resolves.toBe(false);
        const otherAck = vi.fn();
        await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: otherAck,
          user: { ...USER, email: "grace@example.com" },
        });
        const ordinary = await mountReady({ durableUpdates: true });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        await expect(ordinary().flushUpdates()).resolves.toBe(true);
        expect(otherAck).not.toHaveBeenCalled();
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "replays ordinary retired updates under their request source after disposal",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const options = { requestSource: "fixture-retired-source" };
        const first = await mountReady(options);
        updateResponses = Array(20).fill("offline");
        first().ydoc!.getText("t").insert(0, "ordinary retired edit");
        await expect(first().flushUpdates()).resolves.toBe(false);
        act(() => root.render(null));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });
        sentUpdates = [];
        updateResponses = [];
        const reopened = await mountReady(options);
        await expect(reopened().flushUpdates()).resolves.toBe(true);
        const server = new Y.Doc();
        onTestFinished(() => server.destroy());
        for (const update of sentUpdates) Y.applyUpdate(server, update);
        expect(server.getText("t").toString()).toBe("ordinary retired edit");
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "keeps nothing without durableUpdates",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({});
        updateResponses = ["offline"];
        result().ydoc!.getText("t").insert(0, "typed offline");
        await expect(result().flushUpdates()).resolves.toBe(false);
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "retries a refused update as before without durableUpdates",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({});
        updateResponses = ["too_large", { ok: true }];
        result().ydoc!.getText("t").insert(0, "a retained edit");
        await expect(result().flushUpdates()).resolves.toBe(false);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000);
        });
        expect(sentUpdates).toHaveLength(2);
        expect(result().updatesRefused).toBe(false);
        await expect(result().flushUpdates()).resolves.toBe(true);
      },
    },
    {
      name: "does not deliver a previous document's acknowledgment after navigation",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const oldAck = vi.fn();
        const newAck = vi.fn();
        const result = await mountReady({ onUpdateAcknowledged: oldAck });
        const release = holdUpdateResponse();
        result().ydoc!.getText("t").insert(0, "document A");
        const flushing = result().flushUpdates();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(sentUpdates).toHaveLength(1);
        await mountReady({ docId: "document-b", onUpdateAcknowledged: newAck });
        await act(async () => {
          release();
          await flushing;
        });
        expect(oldAck).not.toHaveBeenCalled();
        expect(newAck).not.toHaveBeenCalled();
      },
    },
    ...[false, true].map((value) => ({
      name: format(
        "does not deliver an earlier account's acknowledgment after switching (return=%s)",
        ...(Array.isArray(value) ? value : [value]),
      ),
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const returnToFirstAccount = value;
        const ack = vi.fn();
        const result = await mountReady({ onUpdateAcknowledged: ack });
        // Returning to A may retry its retained update. Keep that new request
        // offline so this assertion measures only the earlier receipt.
        updateResponses = [
          { ok: true, liveCopy: "not_derived", liveCopyReason: "flag_off" },
          "offline",
        ];
        const release = holdUpdateResponse();
        result().ydoc!.getText("t").insert(0, "account A");
        const flushing = result().flushUpdates();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(sentUpdates).toHaveLength(1);
        await mountReady({
          user: { ...USER, email: "grace@example.com" },
          onUpdateAcknowledged: ack,
        });
        if (returnToFirstAccount)
          await mountReady({ user: USER, onUpdateAcknowledged: ack });
        await act(async () => {
          release();
          await flushing;
        });
        expect(ack.mock.calls).not.toContainEqual([
          { liveCopy: "not_derived", liveCopyReason: "flag_off" },
        ]);
        if (!returnToFirstAccount) expect(ack).not.toHaveBeenCalled();
      },
    })),
    ...[1, 2].map((value) => ({
      name: format(
        "ignores a previous account's keepalive refusal (%s updates)",
        ...(Array.isArray(value) ? value : [value]),
      ),
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const updateCount = value;
        const result = await mountReady({
          durableUpdates: true,
          requestSource: "account-a",
        });
        updateResponses = ["too_large"];
        const release = holdUpdateResponse();
        for (let i = 0; i < updateCount; i++)
          result().ydoc!.getText("t").insert(0, "account A ");
        window.dispatchEvent(new Event("pagehide"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const request = vi
          .mocked(fetch)
          .mock.calls.find(([input]) =>
            /\/collab\/[^/]+\/update/.test(String(input)),
          );
        expect(request?.[1]?.keepalive).toBe(true);
        expect(sentUpdates).toHaveLength(1);

        const current = await mountReady({
          durableUpdates: true,
          requestSource: "account-b",
          user: { ...USER, email: "grace@example.com" },
        });
        for (let i = 0; i < 3; i++)
          current().ydoc!.getText("t").insert(0, "account B ");
        await act(async () => {
          release();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(current().updatesRefused).toBe(false);
        await expect(current().flushUpdates()).resolves.toBe(true);
        const currentRequests = vi
          .mocked(fetch)
          .mock.calls.filter(
            ([input, init]) =>
              /\/collab\/[^/]+\/update/.test(String(input)) &&
              JSON.parse(String(init?.body)).requestSource === "account-b",
          );
        expect(currentRequests).toHaveLength(1);
      },
    })),
    ...[
      { pollInterval: 5000 },
      { pollIntervalWithSse: 60000 },
      { pauseWhenHidden: false },
    ].map((value) => ({
      name: format(
        "delivers a held acknowledgment after changing transport options %j",
        ...(Array.isArray(value) ? value : [value]),
      ),
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const options = value;
        const ack = vi.fn();
        const result = await mountReady({
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        updateResponses = [
          { ok: true, liveCopy: "not_derived", liveCopyReason: "flag_off" },
        ];
        const release = holdUpdateResponse();
        result().ydoc!.getText("t").insert(0, "typed");
        const flushing = result().flushUpdates();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(sentUpdates).toHaveLength(1);
        await mountReady({
          ...options,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        await act(async () => {
          release();
          await flushing;
        });
        expect(ack).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "not_derived",
          liveCopyReason: "flag_off",
        });
      },
    })),
    {
      name: "reports when an update cannot be kept",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({ durableUpdates: true });
        const setItem = vi
          .spyOn(window.localStorage, "setItem")
          .mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
          });
        // The afterEach restoreAllMocks leaves this spy on happy-dom's storage,
        // which would break every later test's outbox.
        onTestFinished(() => setItem.mockRestore());
        updateResponses = ["offline"];
        act(() => {
          result().ydoc!.getText("t").insert(0, "typed offline");
        });
        expect(result().durableUpdatesFailed).toBe(true);
      },
    },
    {
      name: "sends what it kept as soon as the tab is back online",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({ durableUpdates: true });
        updateResponses = ["offline"];
        result().ydoc!.getText("t").insert(0, "typed offline");
        await expect(result().flushUpdates()).resolves.toBe(false);
        sentUpdates = [];

        await act(async () => {
          window.dispatchEvent(new Event("online"));
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(sentUpdates).toHaveLength(1);
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "sends promptly when the tab is back online during a request that fails",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({ durableUpdates: true });
        updateResponses = ["offline", "offline"];
        result().ydoc!.getText("t").insert(0, "typed offline");
        await expect(result().flushUpdates()).resolves.toBe(false);

        const failing = result().flushUpdates();
        window.dispatchEvent(new Event("online"));
        await act(async () => {
          await expect(failing).resolves.toBe(false);
        });
        sentUpdates = [];
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });

        expect(sentUpdates).toHaveLength(1);
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "sends a batch the server refuses as too large in halves",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({ durableUpdates: true });
        updateResponses = ["too_large"];
        const text = result().ydoc!.getText("t");
        for (const word of ["one ", "two ", "three"])
          text.insert(text.length, word);
        await expect(result().flushUpdates()).resolves.toBe(true);

        expect(sentUpdates).toHaveLength(3);
        const server = new Y.Doc();
        for (const update of sentUpdates.slice(1))
          Y.applyUpdate(server, update);
        expect(server.getText("t").toString()).toBe("one two three");
        expect(result().updatesRefused).toBe(false);
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "stops sending, keeps and reports an update the server refuses as too large",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const result = await mountReady({ durableUpdates: true });
        updateResponses = ["too_large"];
        result().ydoc!.getText("t").insert(0, "a pasted page");
        await act(async () => {
          await expect(result().flushUpdates()).resolves.toBe(false);
        });
        expect(result().updatesRefused).toBe(true);

        act(() => {
          result().ydoc!.getText("t").insert(0, "typed after ");
        });
        await act(async () => {
          window.dispatchEvent(new Event("online"));
          await vi.advanceTimersByTimeAsync(60_000);
        });
        await expect(result().flushUpdates()).resolves.toBe(false);

        expect(sentUpdates).toHaveLength(1);
        expect(outboxKeys()).toHaveLength(1);
      },
    },
    {
      name: "reports each acknowledgment's live-copy outcome",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const acks: CollabUpdateAck[] = [];
        const result = await mountReady({
          onUpdateAcknowledged: (ack) => acks.push(ack),
        });
        updateResponses = [
          { ok: true, liveCopy: "not_derived", liveCopyReason: "flag_off" },
          { ok: true },
        ];
        result().ydoc!.getText("t").insert(0, "one");
        await expect(result().flushUpdates()).resolves.toBe(true);
        result().ydoc!.getText("t").insert(0, "two");
        await expect(result().flushUpdates()).resolves.toBe(true);

        expect(acks).toEqual([
          { liveCopy: "not_derived", liveCopyReason: "flag_off" },
          { liveCopy: null },
        ]);
      },
    },
    {
      name: "sends an update again when its acknowledgment cannot be read",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const acks: CollabUpdateAck[] = [];
        const result = await mountReady({
          onUpdateAcknowledged: (ack) => acks.push(ack),
        });
        updateResponses = ["unreadable", { ok: true, liveCopy: "derived" }];
        result().ydoc!.getText("t").insert(0, "typed");
        await expect(result().flushUpdates()).resolves.toBe(false);
        await expect(result().flushUpdates()).resolves.toBe(true);

        expect(sentUpdates).toHaveLength(2);
        expect(acks).toEqual([{ liveCopy: "derived" }]);
      },
    },
    {
      name: "keeps a strict update durable until a known live-copy outcome arrives",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const ack = vi.fn();
        const result = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        updateResponses = [{ ok: true }, { ok: true, liveCopy: "derived" }];
        result().ydoc!.getText("t").insert(0, "unconfirmed");
        await expect(result().flushUpdates()).resolves.toBe(false);
        expect(outboxKeys()).toHaveLength(1);
        expect(ack).not.toHaveBeenCalled();

        await expect(result().flushUpdates()).resolves.toBe(true);
        expect(sentUpdates).toHaveLength(2);
        expect(outboxKeys()).toEqual([]);
        expect(ack).toHaveBeenCalledExactlyOnceWith({ liveCopy: "derived" });
      },
    },
    {
      name: "keeps an unknown final keepalive outcome across a closed tab",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
        });
        first().ydoc!.getText("t").insert(0, "survives closing");
        act(() => root.unmount());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });
        expect(sentUpdates.length).toBeGreaterThan(0);
        expect(outboxKeys()).toHaveLength(1);
        _resetCollabDocRegistryForTests();
        root = createRoot(container);
        sentUpdates = [];
        updateResponses = [{ ok: true, liveCopy: "derived" }];
        const reopened = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: vi.fn(),
        });
        await expect(reopened().flushUpdates()).resolves.toBe(true);
        const server = new Y.Doc();
        for (const update of sentUpdates) Y.applyUpdate(server, update);
        expect(server.getText("t").toString()).toBe("survives closing");
        expect(outboxKeys()).toEqual([]);
      },
    },
    ...(
      [
        ["before", "derived"],
        ["before", "not_derived"],
        ["before", null],
        ["during", "derived"],
        ["during", "not_derived"],
        ["during", null],
      ] as const
    ).map((value) => ({
      name: format(
        "retains strict custody when the last owner leaves %s keepalive (%s)",
        ...(Array.isArray(value) ? value : [value]),
      ),
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const [when, liveCopy] = value;
        const { server, requests } = serveCommittedUpdates();
        const oldAck = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: oldAck,
        });
        updateResponses = [liveCopy ? { ok: true, liveCopy } : { ok: true }];
        first().ydoc!.getText("t").insert(0, "retained once");
        if (when === "before") {
          act(() => root.render(null));
          _resetCollabDocRegistryForTests();
        } else {
          const release = holdUpdateResponse();
          window.dispatchEvent(new Event("pagehide"));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
          });
          act(() => root.render(null));
          release();
        }
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(sentUpdates).toHaveLength(1);
        expect(requests[0]?.keepalive).toBe(true);
        expect(server.getText("t").toString()).toBe("retained once");
        expect(oldAck).not.toHaveBeenCalled();
        expect(outboxKeys()).toHaveLength(1);

        _resetCollabDocRegistryForTests();
        const ownerAck = vi.fn();
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        const reopened = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ownerAck,
        });
        expect(reopened().ydoc!.getText("t").toString()).toBe("retained once");
        expect(outboxKeys()).toHaveLength(1);
        await expect(reopened().flushUpdates()).resolves.toBe(true);
        expect(ownerAck).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "unchanged",
        });
        expect(outboxKeys()).toEqual([]);

        updateResponses = [{ ok: true, liveCopy: "derived" }];
        reopened().ydoc!.getText("t").insert(13, " + later");
        await expect(reopened().flushUpdates()).resolves.toBe(true);
        expect(reopened().updatesRefused).toBe(false);
        expect(server.getText("t").toString()).toBe("retained once + later");
        expect(ownerAck).toHaveBeenCalledTimes(2);
        expect(oldAck).not.toHaveBeenCalled();
        expect(outboxKeys()).toEqual([]);
      },
    })),
    {
      name: "retains a disposed strict connection's receipt even with its old subscriber",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        serveCommittedUpdates();
        const ack = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        updateResponses = [{ ok: true, liveCopy: "not_derived" }];
        first().ydoc!.getText("t").insert(0, "disposed owner");
        _resetCollabDocRegistryForTests();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(ack).not.toHaveBeenCalled();
        expect(outboxKeys()).toHaveLength(1);
      },
    },
    {
      name: "does not hand strict custody to an ordinary subscriber",
      baseline:
        "Compatibility control: exact 008402 already passes this named behavior; it protects existing ACK, lifecycle, storage or refusal compatibility.",
      run: async () => {
        const oldAck = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: oldAck,
        });
        first().ydoc!.getText("t").insert(0, "strict work");
        const ordinaryAck = vi.fn();
        const ordinary = await mountReady({
          durableUpdates: true,
          onUpdateAcknowledged: ordinaryAck,
        });
        updateResponses = [{ ok: true, liveCopy: "not_derived" }];
        await expect(ordinary().flushUpdates()).resolves.toBe(false);
        expect(outboxKeys()).toHaveLength(1);
        expect(ordinaryAck).not.toHaveBeenCalled();
        const ownerAck = vi.fn();
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ownerAck,
        });
        updateResponses = [{ ok: true, liveCopy: "not_derived" }];
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(ownerAck).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "not_derived",
        });
        expect(outboxKeys()).toEqual([]);
        expect(oldAck).not.toHaveBeenCalled();
      },
    },
    ...(["derived", "not_derived"] as const).map((value) => ({
      name: format(
        "drains ordinary edits after the strict owner handles %s and leaves live-copy mode",
        ...(Array.isArray(value) ? value : [value]),
      ),
      baseline:
        "Regression: exact 008402 fails this transition’s retained runtime assertion.",
      run: async () => {
        const liveCopy = value;
        const { server } = serveCommittedUpdates();
        const ack = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        first().ydoc!.getText("t").insert(0, "strict then legacy");
        updateResponses = [{ ok: true, liveCopy }];
        await expect(first().flushUpdates()).resolves.toBe(true);
        expect(ack).toHaveBeenCalledExactlyOnceWith({ liveCopy });

        const ordinary = await mountReady({});
        ordinary().ydoc!.getText("t").insert(18, " + ordinary");
        updateResponses = [{ ok: true }];
        await expect(ordinary().flushUpdates()).resolves.toBe(true);
        expect(server.getText("t").toString()).toBe(
          "strict then legacy + ordinary",
        );
        expect(ack).toHaveBeenCalledTimes(1);
        expect(ordinary().updatesRefused).toBe(false);
        expect(outboxKeys()).toEqual([]);
      },
    })),
    ...(["before", "during"] as const).map((value) => ({
      name: format(
        "drains ordinary work separately when its owner leaves %s the strict request",
        ...(Array.isArray(value) ? value : [value]),
      ),
      baseline:
        "Regression: exact 008402 fails this transition’s retained runtime assertion.",
      run: async () => {
        const when = value;
        const { server } = serveCommittedUpdates();
        const oldAck = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: oldAck,
        });
        first().ydoc!.getText("t").insert(0, "strict");
        const strictBytes = Y.encodeStateAsUpdate(first().ydoc!);
        let flushing: Promise<boolean> | undefined;
        let release: (() => void) | undefined;
        if (when === "during") {
          updateResponses = [{ ok: true, liveCopy: "not_derived" }];
          release = holdUpdateResponse();
          flushing = first().flushUpdates();
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
          });
        }
        const ordinary = await mountReady({});
        ordinary().ydoc!.getText("t").insert(6, " + ordinary");
        if (release) {
          await act(async () => {
            release!();
            await expect(flushing).resolves.toBe(false);
          });
        }
        const sentBefore = sentUpdates.length;
        updateResponses = [{ ok: true }, { ok: true, liveCopy: "derived" }];
        // The global flush remains unconfirmed while old strict work has no
        // owner, but its ordinary successor must still be delivered once.
        await expect(ordinary().flushUpdates()).resolves.toBe(false);
        expect(sentUpdates.length - sentBefore).toBe(when === "before" ? 2 : 1);
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        expect(oldAck).not.toHaveBeenCalled();
        expect(outboxKeys()).toHaveLength(1);

        updateResponses = [{ ok: true, liveCopy: "derived" }];
        window.dispatchEvent(new Event("online"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const replay = new Y.Doc();
        onTestFinished(() => replay.destroy());
        Y.applyUpdate(replay, strictBytes);
        Y.applyUpdate(replay, sentUpdates.at(-1)!);
        expect(replay.getText("t").toString()).toBe("strict");
        expect(ordinary().updatesRefused).toBe(false);
        expect(outboxKeys()).toHaveLength(1);

        const ownerAck = vi.fn();
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ownerAck,
        });
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(ownerAck).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "unchanged",
        });
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        expect(outboxKeys()).toEqual([]);
      },
    })),
    {
      name: "keeps strict custody across an ordinary remount without blocking ordinary delivery",
      baseline:
        "Regression: exact 008402 fails this transition’s retained runtime assertion.",
      run: async () => {
        const { server } = serveCommittedUpdates();
        const oldAck = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: oldAck,
        });
        first().ydoc!.getText("t").insert(0, "strict");
        await mountReady({});
        act(() => root.render(null));
        updateResponses = [{ ok: true, liveCopy: "not_derived" }];
        _resetCollabDocRegistryForTests();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(outboxKeys()).toHaveLength(1);
        const ordinary = await mountReady({ durableUpdates: true });
        expect(ordinary().ydoc!.getText("t").toString()).toBe("strict");
        ordinary().ydoc!.getText("t").insert(6, " + ordinary");
        updateResponses = [{ ok: true }, { ok: true, liveCopy: "not_derived" }];
        await expect(ordinary().flushUpdates()).resolves.toBe(false);
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        expect(oldAck).not.toHaveBeenCalled();
        expect(outboxKeys()).toHaveLength(1);
        const ownerAck = vi.fn();
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ownerAck,
        });
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(ownerAck).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "unchanged",
        });
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "replays a mixed outbox when the server lacks the ordinary update's strict predecessor",
      baseline:
        "Regression: exact 008402 fails this transition’s retained runtime assertion.",
      run: async () => {
        const { server } = serveCommittedUpdates();
        const connectedFetch = fetch;
        let online = false;
        vi.stubGlobal(
          "fetch",
          async (input: RequestInfo | URL, init?: RequestInit) => {
            if (!online && /\/collab\/[^/]+\/update/.test(String(input)))
              throw new TypeError("Failed to fetch");
            return connectedFetch(input, init);
          },
        );
        const strict = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: vi.fn(),
        });
        strict().ydoc!.getText("t").insert(0, "strict");
        const ordinary = await mountReady({ durableUpdates: true });
        ordinary().ydoc!.getText("t").insert(6, " + ordinary");
        await expect(ordinary().flushUpdates()).resolves.toBe(false);
        await closeTab();
        expect(server.getText("t").toString()).toBe("");
        updateResponses = [];
        online = true;

        const reopened = await mountReady({ durableUpdates: true });
        expect(reopened().ydoc!.getText("t").toString()).toBe(
          "strict + ordinary",
        );
        await expect(reopened().flushUpdates()).resolves.toBe(false);
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        expect(outboxKeys()).toHaveLength(1);
        await closeTab();
        updateResponses = [];
        const ack = vi.fn();
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(owner().ydoc!.getText("t").toString()).toBe("strict + ordinary");
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        expect(ack).toHaveBeenCalledExactlyOnceWith({ liveCopy: "unchanged" });
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "legacy-enqueued work keeps normal ACK custody when a strict subscriber arrives mid-request",
      baseline:
        "Regression: 008402 upgrades the in-flight ordinary item and rejects its current owner.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        updateResponses = [
          { ok: true, liveCopy: "not_derived", liveCopyReason: "flag_off" },
          { ok: true, liveCopy: "not_derived", liveCopyReason: "flag_off" },
        ];
        const release = holdUpdateResponse();
        first().ydoc!.getText("t").insert(0, "needs fallback");
        const flushing = first().flushUpdates();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const ack = vi.fn();
        await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        await act(async () => {
          release();
          await expect(flushing).resolves.toBe(true);
        });
        expect(outboxKeys()).toEqual([]);
        expect(ack).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "not_derived",
          liveCopyReason: "flag_off",
        });
      },
    },
    {
      name: "legacy-enqueued nullable ACK remains ordinary when strict mode arrives during its response body",
      baseline:
        "Regression: 008402 upgrades an ordinary item while its body is pending.",
      run: async () => {
        const ack = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          onUpdateAcknowledged: ack,
        });
        const originalFetch = fetch;
        let release!: () => void;
        const bodyGate = new Promise<void>((resolve) => (release = resolve));
        vi.stubGlobal(
          "fetch",
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const response = await originalFetch(input, init);
            if (/\/collab\/[^/]+\/update/.test(String(input))) {
              const readBody = response.json.bind(response);
              response.json = async () => {
                await bodyGate;
                return readBody();
              };
            }
            return response;
          },
        );
        first().ydoc!.getText("t").insert(0, "held body");
        const flushing = first().flushUpdates();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        await act(async () => {
          release();
          await expect(flushing).resolves.toBe(true);
        });
        expect(outboxKeys()).toEqual([]);
        expect(ack).not.toHaveBeenCalled();
      },
    },
    {
      name: "v2 ordinary custody survives reload into a strict subscription",
      baseline:
        "Regression: 008402 stores no per-item bit and upgrades restored ordinary work.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        first().ydoc!.getText("t").insert(0, "ordinary before reload");
        updateResponses = ["offline"];
        await expect(first().flushUpdates()).resolves.toBe(false);
        const key = outboxKeys()[0];
        expect(key.startsWith(STRICT_OUTBOX_PREFIX)).toBe(true);
        expect(
          JSON.parse(localStorage.getItem(key)!).updates.map(
            (item: { requireLiveCopyOutcome: boolean }) =>
              item.requireLiveCopyOutcome,
          ),
        ).toEqual([false]);
        await closeTab();
        const ack = vi.fn();
        updateResponses = [{ ok: true }];
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(ack).not.toHaveBeenCalled();
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "a current remounted strict owner handles an earlier request's not_derived outcome",
      baseline:
        "Regression: 008402 rejects the new owner's captured subscription scope.",
      run: async () => {
        const oldAck = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: oldAck,
        });
        updateResponses = [
          { ok: true, liveCopy: "not_derived", liveCopyReason: "flag_off" },
        ];
        const release = holdUpdateResponse();
        first().ydoc!.getText("t").insert(0, "current owner fallback");
        const flushing = first().flushUpdates();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        act(() => root.render(null));
        const currentAck = vi.fn();
        await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: currentAck,
        });
        await act(async () => {
          release();
          await expect(flushing).resolves.toBe(true);
        });
        expect(oldAck).not.toHaveBeenCalled();
        expect(currentAck).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "not_derived",
          liveCopyReason: "flag_off",
        });
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "strict custody remains durable when its current owner's outcome handler throws",
      baseline:
        "Regression: 008402 clears bytes before dispatching the strict outcome.",
      run: async () => {
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: () => {
            throw new Error("fixture owner unavailable");
          },
        });
        first().ydoc!.getText("t").insert(0, "outcome unhandled");
        updateResponses = [{ ok: true, liveCopy: "not_derived" }];
        await expect(first().flushUpdates()).resolves.toBe(false);
        expect(outboxKeys()).toHaveLength(1);
        const ack = vi.fn();
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(ack).toHaveBeenCalledExactlyOnceWith({ liveCopy: "unchanged" });
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "legacy v1 bytes retain ordinary adoption compatibility",
      baseline:
        "Compatibility control: 008402 already reads bare v1 Yjs bytes; v1 has no historical custody bit.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        first().ydoc!.getText("t").insert(0, "old format kept edit");
        const bytes = Y.encodeStateAsUpdate(first().ydoc!);
        await closeTab();
        const oldKey = outboxKeys()[0];
        const key = oldKey.replace(STRICT_OUTBOX_PREFIX, OUTBOX_PREFIX);
        localStorage.setItem(key, btoa(String.fromCharCode(...bytes)));
        if (key !== oldKey) localStorage.removeItem(oldKey);
        updateResponses = [{ ok: true }];
        const ordinary = await mountReady({ durableUpdates: true });
        await expect(ordinary().flushUpdates()).resolves.toBe(true);
        expect(ordinary().ydoc!.getText("t").toString()).toBe(
          "old format kept edit",
        );
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "strict predecessors deliver separately without inflating an ordinary successor into a refusal",
      baseline:
        "Regression: 008402 cannot drain the ordinary successor without a strict owner.",
      run: async () => {
        let limit = Infinity;
        const { server, requests } = serveCommittedUpdates(() => limit);
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: vi.fn(),
        });
        const updates: Uint8Array[] = [];
        first().ydoc!.on("update", (update) => updates.push(update));
        first().ydoc!.getText("t").insert(0, "s".repeat(100));
        const ordinary = await mountReady({});
        ordinary().ydoc!.getText("t").insert(100, "o".repeat(100));
        limit = Math.max(...updates.map((update) => update.length)) + 1;
        await expect(ordinary().flushUpdates()).resolves.toBe(false);
        expect(server.getText("t").toString()).toBe(
          "s".repeat(100) + "o".repeat(100),
        );
        expect(
          requests.every(
            (request) =>
              decode(JSON.parse(String(request.body)).update).length <= limit,
          ),
        ).toBe(true);
        expect(ordinary().updatesRefused).toBe(false);
        expect(outboxKeys()).toHaveLength(1);
        const ack = vi.fn();
        const owner = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: ack,
        });
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        await expect(owner().flushUpdates()).resolves.toBe(true);
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "leaves a frozen owner's stored bytes untouched until that owner is gone",
      baseline:
        "Regression: 912f6406 adopts a live owner's entry and sends its edit from the joining tab.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        first().ydoc!.getText("t").insert(0, "frozen edit");
        updateResponses = ["offline"];
        await expect(first().flushUpdates()).resolves.toBe(false);
        await closeTab();
        const key = outboxKeys()[0];
        if (!key) throw new Error("Missing retained update");
        const raw = window.localStorage.getItem(key);
        let release!: () => void;
        let entered!: () => void;
        const acquired = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const lease = locks.request(
          "agent-native-collab-outbox-owner:" +
            key.replace(STRICT_OUTBOX_PREFIX, OUTBOX_PREFIX),
          () => {
            entered();
            return new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        );
        await acquired;
        onTestFinished(async () => {
          release();
          await lease;
        });
        sentUpdates = [];
        const joining = await mountReady({ durableUpdates: true });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(joining().ydoc!.getText("t").toString()).toBe("");
        expect(sentUpdates).toEqual([]);
        expect(window.localStorage.getItem(key)).toBe(raw);

        release();
        await lease;
        await closeTab();
        updateResponses = [];
        sentUpdates = [];
        const reopened = await mountReady({ durableUpdates: true });
        await expect(reopened().flushUpdates()).resolves.toBe(true);
        const server = new Y.Doc();
        onTestFinished(() => server.destroy());
        for (const update of sentUpdates) Y.applyUpdate(server, update);
        expect(server.getText("t").toString()).toBe("frozen edit");
        expect(outboxKeys()).toEqual([]);
      },
    },
    {
      name: "keeps another owner's bytes when the browser cannot check its lock",
      baseline:
        "Regression: 912f6406 adopts entries without checking whether their owner is alive.",
      run: async () => {
        const first = await mountReady({ durableUpdates: true });
        first().ydoc!.getText("t").insert(0, "kept without ownership proof");
        updateResponses = ["offline"];
        await expect(first().flushUpdates()).resolves.toBe(false);
        await closeTab();
        const key = outboxKeys()[0];
        if (!key) throw new Error("Missing retained update");
        const raw = window.localStorage.getItem(key);
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: undefined,
        });
        sentUpdates = [];
        const joining = await mountReady({ durableUpdates: true });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(joining().durableUpdatesFailed).toBe(true);
        expect(joining().ydoc!.getText("t").toString()).toBe("");
        expect(window.localStorage.getItem(key)).toBe(raw);
        expect(sentUpdates).toEqual([]);
      },
    },
    {
      name: "a late final keepalive does not reclaim a dead owner's retained strict edit",
      baseline:
        "Regression: 59e468df reacquires a disposed owner's lock after an ordinary keepalive ACK, blocking a new strict owner's receipt.",
      run: async () => {
        const { server, requests } = serveCommittedUpdates();
        const oldAck = vi.fn();
        const first = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: oldAck,
        });
        first().ydoc!.getText("t").insert(0, "strict");
        const ordinary = await mountReady({});
        updateResponses = [{ ok: true, liveCopy: "derived" }];
        await expect(ordinary().flushUpdates()).resolves.toBe(false);
        expect(server.getText("t").toString()).toBe("strict");
        expect(oldAck).not.toHaveBeenCalled();

        ordinary().ydoc!.getText("t").insert(6, " + ordinary");
        updateResponses = [{ ok: true }];
        const release = holdUpdateResponse();
        onTestFinished(release);
        act(() => root.unmount());
        _resetCollabDocRegistryForTests();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(requests.at(-1)?.keepalive).toBe(true);
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        await act(async () => {
          release();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(outboxKeys()).toHaveLength(1);

        root = createRoot(container);
        const currentAck = vi.fn();
        updateResponses = [{ ok: true, liveCopy: "unchanged" }];
        const reopened = await mountReady({
          durableUpdates: true,
          requireLiveCopyOutcome: true,
          onUpdateAcknowledged: currentAck,
        });
        await expect(reopened().flushUpdates()).resolves.toBe(true);
        expect(currentAck).toHaveBeenCalledExactlyOnceWith({
          liveCopy: "unchanged",
        });
        expect(outboxKeys()).toEqual([]);
        expect(server.getText("t").toString()).toBe("strict + ordinary");
        expect(oldAck).not.toHaveBeenCalled();
      },
    },
  ];

  it.each(
    transitionRows.map(
      (row, index) =>
        [`T${index + 1}`, row.name, row.baseline, row.run] as const,
    ),
  )("custody transition %s: %s [%s]", async (_id, _name, _baseline, run) => {
    await run();
  });
});
