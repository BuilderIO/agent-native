// @vitest-environment happy-dom

/**
 * A caller whose edits reach the server only through the collab doc keeps
 * them in localStorage until the server acknowledges them, so a refresh, a
 * closed tab, or a stretch offline does not drop them.
 */
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
  return Object.keys(window.localStorage).filter((key) =>
    key.startsWith(OUTBOX_PREFIX),
  );
}

describe("collab durable updates", () => {
  let root: Root;
  let container: HTMLDivElement;
  let updateResponses: Array<"offline" | "unreadable" | "too_large" | object>;
  let sentUpdates: Uint8Array[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
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

  it("keeps an unacknowledged update until the server acknowledges it", async () => {
    const result = await mountReady({ durableUpdates: true });
    updateResponses = ["offline"];
    result().ydoc!.getText("t").insert(0, "typed offline");
    await expect(result().flushUpdates()).resolves.toBe(false);
    expect(outboxKeys()).toHaveLength(1);

    await expect(result().flushUpdates()).resolves.toBe(true);
    expect(outboxKeys()).toEqual([]);
  });

  it("sends what a closed tab kept when the doc opens again", async () => {
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
  });

  it("leaves another account's kept updates alone", async () => {
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
  });

  it("sends an account's kept updates when it signs in on an open doc", async () => {
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
  });

  it("keeps nothing without durableUpdates", async () => {
    const result = await mountReady({});
    updateResponses = ["offline"];
    result().ydoc!.getText("t").insert(0, "typed offline");
    await expect(result().flushUpdates()).resolves.toBe(false);
    expect(outboxKeys()).toEqual([]);
  });

  it("retries a refused update as before without durableUpdates", async () => {
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
  });

  it("does not deliver a previous document's acknowledgment after navigation", async () => {
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
  });

  it.each([false, true])(
    "does not deliver an earlier account's acknowledgment after switching (return=%s)",
    async (returnToFirstAccount) => {
      const ack = vi.fn();
      const result = await mountReady({ onUpdateAcknowledged: ack });
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
      expect(ack).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2])(
    "ignores a previous account's keepalive refusal (%s updates)",
    async (updateCount) => {
      const result = await mountReady({ durableUpdates: true });
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

      await mountReady({
        durableUpdates: true,
        user: { ...USER, email: "grace@example.com" },
      });
      const requestsBeforeAccountB = sentUpdates.length;
      for (let i = 0; i < 3; i++)
        result().ydoc!.getText("t").insert(0, "account B ");
      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result().updatesRefused).toBe(false);
      await expect(result().flushUpdates()).resolves.toBe(true);
      expect(sentUpdates).toHaveLength(requestsBeforeAccountB + 1);
    },
  );

  it.each([
    { pollInterval: 5000 },
    { pollIntervalWithSse: 60000 },
    { pauseWhenHidden: false },
  ])(
    "delivers a held acknowledgment after changing transport options %j",
    async (options) => {
      const ack = vi.fn();
      const result = await mountReady({ onUpdateAcknowledged: ack });
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
      await mountReady({ ...options, onUpdateAcknowledged: ack });
      await act(async () => {
        release();
        await flushing;
      });
      expect(ack).toHaveBeenCalledExactlyOnceWith({
        liveCopy: "not_derived",
        liveCopyReason: "flag_off",
      });
    },
  );

  it("reports when an update cannot be kept", async () => {
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
  });

  it("sends what it kept as soon as the tab is back online", async () => {
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
  });

  it("sends promptly when the tab is back online during a request that fails", async () => {
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
  });

  it("sends a batch the server refuses as too large in halves", async () => {
    const result = await mountReady({ durableUpdates: true });
    updateResponses = ["too_large"];
    const text = result().ydoc!.getText("t");
    for (const word of ["one ", "two ", "three"])
      text.insert(text.length, word);
    await expect(result().flushUpdates()).resolves.toBe(true);

    expect(sentUpdates).toHaveLength(3);
    const server = new Y.Doc();
    for (const update of sentUpdates.slice(1)) Y.applyUpdate(server, update);
    expect(server.getText("t").toString()).toBe("one two three");
    expect(result().updatesRefused).toBe(false);
    expect(outboxKeys()).toEqual([]);
  });

  it("stops sending, keeps and reports an update the server refuses as too large", async () => {
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
  });

  it("reports each acknowledgment's live-copy outcome", async () => {
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
  });

  it("sends an update again when its acknowledgment cannot be read", async () => {
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
  });
});
