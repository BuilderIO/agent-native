// @vitest-environment happy-dom

/**
 * A caller whose edits reach the server only through the collab doc keeps
 * them in localStorage until the server acknowledges them, so a refresh, a
 * closed tab, or a stretch offline does not drop them.
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
  let updateResponses: Array<"offline" | "unreadable" | object>;
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

  it("keeps nothing without durableUpdates", async () => {
    const result = await mountReady({});
    updateResponses = ["offline"];
    result().ydoc!.getText("t").insert(0, "typed offline");
    await expect(result().flushUpdates()).resolves.toBe(false);
    expect(outboxKeys()).toEqual([]);
  });

  it("reports when an update cannot be kept", async () => {
    const result = await mountReady({ durableUpdates: true });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
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
