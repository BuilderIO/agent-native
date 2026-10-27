// @vitest-environment happy-dom

/**
 * `flushUpdates` is how a caller that also saves the same edit somewhere else
 * (SQL) waits until collaborators can receive it through the document first.
 * Saving first would let their editors insert the text from the saved copy and
 * then again from the late document update.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  _resetCollabDocRegistryForTests,
  useCollaborativeDoc,
  type UseCollaborativeDocResult,
} from "./client.js";

function Probe({
  onResult,
}: {
  onResult: (result: UseCollaborativeDocResult) => void;
}) {
  const result = useCollaborativeDoc({ docId: "flush-updates-doc" });
  onResult(result);
  return null;
}

describe("collab flushUpdates", () => {
  let root: Root;
  let container: HTMLDivElement;
  let updateOutcomes: Array<"ok" | "offline">;
  let updatesSent: number;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    updateOutcomes = [];
    updatesSent = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/collab\/[^/]+\/state/.test(url)) {
          return new Response(
            JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
          );
        }
        if (/\/collab\/[^/]+\/update/.test(url)) {
          updatesSent += 1;
          if (updateOutcomes.shift() === "offline") {
            throw new TypeError("Failed to fetch");
          }
          return new Response(JSON.stringify({}));
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mountReady() {
    let latest: UseCollaborativeDocResult | null = null;
    act(() => {
      root.render(<Probe onResult={(result) => (latest = result)} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const ready = latest as UseCollaborativeDocResult | null;
    expect(ready?.ydoc).toBeTruthy();
    return ready as UseCollaborativeDocResult;
  }

  it("resolves true immediately when nothing is outstanding", async () => {
    const result = await mountReady();
    await expect(result.flushUpdates()).resolves.toBe(true);
    expect(updatesSent).toBe(0);
  });

  it("sends the outstanding edit without waiting for the debounce", async () => {
    const result = await mountReady();
    result.ydoc!.getText("t").insert(0, "typed");
    await expect(result.flushUpdates()).resolves.toBe(true);
    expect(updatesSent).toBe(1);
  });

  it("flushes pending edits with keepalive on pagehide and remains editable after pageshow", async () => {
    const result = await mountReady();
    const ydoc = result.ydoc!;
    ydoc.getText("t").insert(0, "before");
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const updateCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input).endsWith("/update"));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]![1]?.keepalive).toBe(true);
    expect(ydoc.isDestroyed).toBe(false);

    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    ydoc.getText("t").insert(6, " after");
    await expect(result.flushUpdates()).resolves.toBe(true);
    expect(updatesSent).toBe(2);
    expect(ydoc.getText("t").toString()).toBe("before after");
  });

  it.each([200, 500])(
    "flushes restored edits on a second pagehide after the first request settles with %s",
    async (firstStatus) => {
      const result = await mountReady();
      const originalFetch = vi.mocked(fetch).getMockImplementation()!;
      let finishFirst!: (response: Response) => void;
      const updateRequests: RequestInit[] = [];
      vi.mocked(fetch).mockImplementation((input, init) => {
        if (!String(input).endsWith("/update"))
          return originalFetch(input, init);
        updateRequests.push(init!);
        if (updateRequests.length === 1)
          return new Promise<Response>((resolve) => {
            finishFirst = resolve;
          });
        return Promise.resolve(new Response("{}"));
      });
      result.ydoc!.getText("t").insert(0, "before");
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
      result.ydoc!.getText("t").insert(6, " after");
      window.dispatchEvent(new Event("pagehide"));
      expect(
        updateRequests.filter((request) => request.keepalive),
      ).toHaveLength(1);
      await act(async () => {
        finishFirst(new Response("{}", { status: firstStatus }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        updateRequests.filter((request) => request.keepalive),
      ).toHaveLength(2);
      const received = new Y.Doc();
      try {
        for (const request of updateRequests) {
          const { update } = JSON.parse(String(request.body));
          Y.applyUpdate(
            received,
            new Uint8Array(Buffer.from(update, "base64")),
          );
        }
        expect(received.getText("t").toString()).toBe("before after");
      } finally {
        received.destroy();
      }
    },
  );

  it("resolves false while delivery fails, then true once it succeeds", async () => {
    const result = await mountReady();
    updateOutcomes = ["offline"];
    result.ydoc!.getText("t").insert(0, "typed offline");
    await expect(result.flushUpdates()).resolves.toBe(false);

    await expect(result.flushUpdates()).resolves.toBe(true);
    expect(updatesSent).toBe(2);
  });
});
