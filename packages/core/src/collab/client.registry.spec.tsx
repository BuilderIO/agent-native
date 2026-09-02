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
  type CollabUser,
  type UseCollaborativeDocResult,
} from "./client.js";

/**
 * Minimal EventSource stand-in so the shared transport never opens a real
 * SSE connection. Tracks every constructed instance so tests can push
 * synthetic push events without going through a real EventSource.
 */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

function emptyStateResponse(): Response {
  // A valid Yjs update for a document whose `content` text is "seed".
  return new Response(
    JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
  );
}

/** Routes collab/poll endpoints to canned JSON and counts state fetches. */
function makeFetchMock() {
  const stateFetches: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/collab\/[^/]+\/state/.test(url)) {
      stateFetches.push(url);
      return emptyStateResponse();
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
  user,
}: {
  docId: string | null;
  onResult: (result: UseCollaborativeDocResult) => void;
  user?: CollabUser;
}) {
  const result = useCollaborativeDoc({ docId, user });
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
    FakeEventSource.instances = [];
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
      await Promise.resolve();
      await Promise.resolve();
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

  it.each([
    [
      "403",
      () => new Response("forbidden", { status: 403 }),
      "forbidden-or-not-found",
    ],
    [
      "404",
      () => new Response("missing", { status: 404 }),
      "forbidden-or-not-found",
    ],
    ["500", () => new Response("error", { status: 500 }), "server"],
    [
      "malformed success",
      () => new Response(JSON.stringify({ state: null })),
      "invalid-payload",
    ],
  ] as const)(
    "fails closed for initial %s responses without posting an update on pagehide",
    async (_name, response, category) => {
      const mock = vi.fn(async (input: RequestInfo | URL) => {
        if (/\/collab\/[^/]+\/state/.test(String(input))) return response();
        return new Response(JSON.stringify({}));
      });
      vi.stubGlobal("fetch", mock);

      let result: UseCollaborativeDocResult | undefined;
      mount(<Probe docId="failed-doc" onResult={(r) => (result = r)} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result?.isLoading).toBe(false);
      expect(result?.isSynced).toBe(false);
      expect(result?.initialization).toEqual({ status: "error", category });
      expect(result?.ydoc).toBeNull();
      expect(result?.awareness).toBeNull();
      expect(FakeEventSource.instances).toHaveLength(0);
      expect(
        mock.mock.calls.filter(([input]) =>
          /\/(?:update|awareness)$|\/_agent-native\/poll/.test(String(input)),
        ),
      ).toHaveLength(0);
      result?.ydoc?.getText("content").insert(0, "must not send");
      window.dispatchEvent(new Event("pagehide"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(
        mock.mock.calls.filter(([input]) => String(input).includes("/update")),
      ).toHaveLength(0);
    },
  );

  it("accepts an empty Yjs state for a new document", async () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state/.test(url)) {
        return new Response(JSON.stringify({ state: "" }));
      }
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 1, events: [] }));
      }
      return new Response(JSON.stringify({ states: [] }));
    });
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    mount(<Probe docId="new-empty-doc" onResult={(next) => (result = next)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result?.initialization).toEqual({ status: "ready" });
    expect(result?.isSynced).toBe(true);
    expect(result?.ydoc?.getText("content").toString()).toBe("");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("fails closed after a network rejection and enables updates only after retry succeeds", async () => {
    let attempts = 0;
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state/.test(url)) {
        attempts++;
        if (attempts === 1) throw new Error("offline");
        return emptyStateResponse();
      }
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 1, events: [] }));
      }
      return new Response(JSON.stringify({ states: [] }));
    });
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    mount(<Probe docId="retry-doc" onResult={(r) => (result = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.initialization).toEqual({
      status: "error",
      category: "network",
    });
    expect(result?.ydoc).toBeNull();
    expect(FakeEventSource.instances).toHaveLength(0);
    result?.ydoc?.getText("content").insert(0, "before retry");
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      mock.mock.calls.filter(([input]) => String(input).includes("/update")),
    ).toHaveLength(0);

    act(() => result?.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.initialization).toEqual({ status: "ready" });
    expect(result?.isSynced).toBe(true);
    expect(result?.ydoc?.getText("content").toString()).toBe("seed");
    result?.ydoc?.getText("content").insert(0, "after retry");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(
      mock.mock.calls.filter(([input]) => String(input).includes("/update")),
    ).toHaveLength(1);
  });

  it("discards partial Yjs mutations before retrying malformed initial state", async () => {
    let attempts = 0;
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state/.test(url)) {
        attempts++;
        if (attempts === 1) {
          // Truncated update: this version of Yjs applies "poison" before
          // throwing, which proves validation must happen off the live doc.
          return new Response(
            JSON.stringify({
              state: "AQGp2K6eCgAEAQdjb250ZW50BnBvaXNvbg==",
            }),
          );
        }
        return emptyStateResponse();
      }
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 1, events: [] }));
      }
      return new Response(JSON.stringify({ states: [] }));
    });
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    mount(<Probe docId="malformed-retry-doc" onResult={(r) => (result = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result?.initialization).toEqual({
      status: "error",
      category: "invalid-payload",
    });

    act(() => result?.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result?.initialization).toEqual({ status: "ready" });
    expect(result?.ydoc?.getText("content").toString()).toBe("seed");
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

  it("publishes and updates the local avatar in awareness identity", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe
        docId="doc-avatar"
        onResult={(next) => (result = next)}
        user={{
          name: "Local",
          email: "local@example.com",
          color: "local-color",
          avatarUrl: "https://example.com/first.jpg",
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result?.awareness?.getLocalState()?.user).toEqual({
      name: "Local",
      email: "local@example.com",
      color: "local-color",
      avatarUrl: "https://example.com/first.jpg",
    });

    act(() => {
      root.render(
        <Probe
          docId="doc-avatar"
          onResult={(next) => (result = next)}
          user={{
            name: "Local",
            email: "local@example.com",
            color: "local-color",
            avatarUrl: "https://example.com/second.jpg",
          }}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result?.awareness?.getLocalState()?.user).toMatchObject({
      avatarUrl: "https://example.com/second.jpg",
    });
  });

  it("does not re-broadcast local awareness state when a REMOTE awareness event arrives (no storm)", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    mount(
      <Probe
        docId="doc-1"
        onResult={() => {}}
        user={{ name: "Local", email: "local@example.com", color: "#111" }}
      />,
    );
    // Flush the initial state fetch + first poll cycle, then let the local
    // `setUser` awareness push (origin "local") land.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(200);
    });

    const source = FakeEventSource.instances.at(-1);
    expect(source).toBeTruthy();
    source!.onopen?.();

    const awarenessPostsBefore = mock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/awareness") &&
        (init as RequestInit | undefined)?.method === "POST",
    ).length;

    // Simulate a REMOTE peer's cursor move arriving over the shared SSE
    // transport — this is what `applyAwarenessEvent` receives, and it emits
    // `awareness.emit("change", [changes, "remote"])` after reconciling.
    await act(async () => {
      source!.onmessage?.({
        data: JSON.stringify({
          source: "awareness",
          type: "awareness-change",
          docId: "doc-1",
          states: [
            {
              clientId: 999_001,
              state: JSON.stringify({
                user: {
                  name: "Remote",
                  email: "remote@example.com",
                  color: "#222",
                },
                cursor: { x: 0.5, y: 0.5 },
              }),
            },
          ],
        }),
      });
      // Past the 150ms fast-awareness-push throttle window.
      await vi.advanceTimersByTimeAsync(200);
    });

    const awarenessPostsAfter = mock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/awareness") &&
        (init as RequestInit | undefined)?.method === "POST",
    ).length;

    // A remote-originated awareness change must not cause THIS client to
    // re-broadcast its own (unchanged) state — otherwise every peer's cursor
    // move would fan out into an extra POST from every other connected
    // client (an awareness storm that gets worse as more people join).
    expect(awarenessPostsAfter).toBe(awarenessPostsBefore);
  });

  it("cancels a pending local awareness push when the connection is disposed", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe
        docId="doc-dispose-awareness"
        onResult={(next) => (result = next)}
        user={{ name: "Local", email: "local@example.com", color: "#111" }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const awarenessPostsBeforeDispose = mock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/awareness") &&
        (init as RequestInit | undefined)?.method === "POST",
    ).length;
    result?.awareness?.setLocalStateField("cursor", { x: 0.25, y: 0.75 });

    act(() => root.unmount());
    roots = roots.filter((candidate) => candidate !== root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const awarenessPostsAfterDispose = mock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/awareness") &&
        (init as RequestInit | undefined)?.method === "POST",
    ).length;
    expect(awarenessPostsAfterDispose).toBe(awarenessPostsBeforeDispose);
  });
});
