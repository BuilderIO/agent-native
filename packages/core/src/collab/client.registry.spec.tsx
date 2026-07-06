// @vitest-environment happy-dom

/**
 * Hook-level tests for the ref-counted per-docId connection registry in
 * useCollaborativeDoc (client.ts):
 *
 * 1. Two components mounting the hook for the same docId share ONE Y.Doc /
 *    Awareness and trigger ONE initial state fetch (no doubled traffic).
 * 2. Different docIds get independent connections.
 * 3. Last unmount tears the connection down after the dispose linger
 *    (Y.Doc destroyed, registry entry evicted); a fresh mount then gets a
 *    NEW connection and refetches state.
 * 4. StrictMode-style unmount→remount within the linger window keeps the
 *    connection alive (same Y.Doc, no refetch).
 */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import {
  useCollaborativeDoc,
  _collabDocRegistrySizeForTests,
  _resetCollabDocRegistryForTests,
  type UseCollaborativeDocResult,
} from "./client.js";

/** Minimal EventSource stand-in so the shared transport never opens SSE. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

/** Routes collab/poll endpoints to canned JSON and counts state fetches. */
function makeFetchMock() {
  const stateFetches: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/collab\/[^/]+\/state/.test(url)) {
      stateFetches.push(url);
      return new Response(JSON.stringify({ state: null }));
    }
    if (url.includes("/_agent-native/poll")) {
      return new Response(JSON.stringify({ version: 1, events: [] }));
    }
    if (url.includes("/awareness")) {
      return new Response(JSON.stringify({ states: [] }));
    }
    return new Response(JSON.stringify({}));
  });
  return { mock, stateFetches };
}

function Probe({
  docId,
  onResult,
}: {
  docId: string | null;
  onResult: (result: UseCollaborativeDocResult) => void;
}) {
  const result = useCollaborativeDoc({ docId });
  onResult(result);
  return null;
}

describe("useCollaborativeDoc connection registry", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];

  function mount(node: React.ReactElement): Root {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    act(() => {
      root.render(node);
    });
    return root;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    for (const container of containers) {
      container.remove();
    }
    roots = [];
    containers = [];
    _resetCollabDocRegistryForTests();
    _resetSyncTransportRegistryForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shares one Y.Doc and one state fetch across two mounts of the same docId", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let a: UseCollaborativeDocResult | undefined;
    let b: UseCollaborativeDocResult | undefined;
    mount(
      <>
        <Probe docId="doc-1" onResult={(r) => (a = r)} />
        <Probe docId="doc-1" onResult={(r) => (b = r)} />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(a?.ydoc).toBeTruthy();
    expect(a?.ydoc).toBe(b?.ydoc);
    expect(a?.awareness).toBe(b?.awareness);
    expect(stateFetches).toHaveLength(1);
    expect(_collabDocRegistrySizeForTests()).toBe(1);
    // Both subscribers converge on the same synced state.
    expect(a?.isSynced).toBe(true);
    expect(b?.isSynced).toBe(true);
  });

  it("keeps different docIds on independent connections", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let a: UseCollaborativeDocResult | undefined;
    let b: UseCollaborativeDocResult | undefined;
    mount(
      <>
        <Probe docId="doc-1" onResult={(r) => (a = r)} />
        <Probe docId="doc-2" onResult={(r) => (b = r)} />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(a?.ydoc).toBeTruthy();
    expect(b?.ydoc).toBeTruthy();
    expect(a?.ydoc).not.toBe(b?.ydoc);
    expect(stateFetches).toHaveLength(2);
    expect(_collabDocRegistrySizeForTests()).toBe(2);
  });

  it("tears down after the last unmount (post-linger) and refetches on a fresh mount", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let first: UseCollaborativeDocResult | undefined;
    const root = mount(<Probe docId="doc-1" onResult={(r) => (first = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const firstYdoc = first?.ydoc;
    expect(firstYdoc).toBeTruthy();
    expect(stateFetches).toHaveLength(1);

    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    // Still registered during the linger window…
    expect(_collabDocRegistrySizeForTests()).toBe(1);
    // …and evicted (doc destroyed) once it elapses.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(_collabDocRegistrySizeForTests()).toBe(0);

    let second: UseCollaborativeDocResult | undefined;
    mount(<Probe docId="doc-1" onResult={(r) => (second = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second?.ydoc).toBeTruthy();
    expect(second?.ydoc).not.toBe(firstYdoc);
    expect(stateFetches).toHaveLength(2);
  });

  it("survives unmount→remount within the linger window without teardown or refetch", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let first: UseCollaborativeDocResult | undefined;
    const root = mount(<Probe docId="doc-1" onResult={(r) => (first = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const firstYdoc = first?.ydoc;
    expect(stateFetches).toHaveLength(1);

    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // < DISPOSE_LINGER_MS
    });

    let second: UseCollaborativeDocResult | undefined;
    mount(<Probe docId="doc-1" onResult={(r) => (second = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second?.ydoc).toBe(firstYdoc);
    expect(stateFetches).toHaveLength(1);

    // With a live subscriber the linger must not fire later either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(_collabDocRegistrySizeForTests()).toBe(1);
  });

  it("keeps one shared connection under StrictMode double-mounting", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    mount(
      <React.StrictMode>
        <Probe docId="doc-strict" onResult={(r) => (result = r)} />
      </React.StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result?.ydoc).toBeTruthy();
    expect(stateFetches).toHaveLength(1);
    expect(_collabDocRegistrySizeForTests()).toBe(1);

    // The StrictMode remount cancelled the linger — no delayed teardown.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(_collabDocRegistrySizeForTests()).toBe(1);
    expect(result?.ydoc?.isDestroyed).toBe(false);
  });
});
