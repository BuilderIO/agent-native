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

  it("resolves false while delivery fails, then true once it succeeds", async () => {
    const result = await mountReady();
    updateOutcomes = ["offline"];
    result.ydoc!.getText("t").insert(0, "typed offline");
    await expect(result.flushUpdates()).resolves.toBe(false);

    await expect(result.flushUpdates()).resolves.toBe(true);
    expect(updatesSent).toBe(2);
  });
});
