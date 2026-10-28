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
import * as Y from "yjs";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
import { runBeforeSignOutCleanups } from "../client/use-session.js";
import {
  useCollaborativeDoc,
  _collabDocRegistrySizeForTests,
  _resetCollabDocRegistryForTests,
  type CollabUser,
  type UseCollaborativeDocResult,
} from "./client.js";

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
  return new Response(
    JSON.stringify({
      state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA",
      activityBaseline: {
        status: "ready",
        version: 1,
        cursor: "1.baseline",
      },
    }),
  );
}

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  return {
    promise: new Promise<Response>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

function makeFetchMock() {
  const stateFetches: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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

  it.each(["network", "503", "ambiguous", "success"])(
    "retains edits made during an in-flight %s response and converges on acknowledgement",
    async (outcome) => {
      const server = new Y.Doc();
      server.getText("content").insert(0, "seed");
      const { mock: fallback } = makeFetchMock();
      const bodies: string[] = [];
      let release!: () => void;
      const firstRequest = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/state")) {
            return new Response(
              JSON.stringify({
                state: Buffer.from(Y.encodeStateAsUpdate(server)).toString(
                  "base64",
                ),
                activityBaseline: {
                  status: "ready",
                  version: 1,
                  cursor: "1.baseline",
                },
              }),
            );
          }
          if (!url.endsWith("/update")) return fallback(input);
          const body = String(init?.body);
          bodies.push(body);
          if (bodies.length === 1) {
            await firstRequest;
            if (outcome === "network") throw new TypeError("offline");
            if (outcome === "503") return new Response(null, { status: 503 });
            Y.applyUpdate(
              server,
              Buffer.from(JSON.parse(body).update, "base64"),
            );
            if (outcome === "ambiguous") throw new TypeError("response lost");
          } else {
            Y.applyUpdate(
              server,
              Buffer.from(JSON.parse(body).update, "base64"),
            );
          }
          return new Response(JSON.stringify({ ok: true }));
        }),
      );
      let result: UseCollaborativeDocResult | undefined;
      mount(
        <Probe
          docId="outbound-retry"
          onResult={(next) => {
            result = next;
          }}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => result!.ydoc!.getText("content").insert(4, " one"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80);
      });
      act(() => result!.ydoc!.getText("content").insert(8, " two"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80);
      });
      expect(bodies).toHaveLength(1);
      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(bodies).toHaveLength(2);
      expect(server.getText("content").toString()).toBe("seed one two");
      expect(result!.ydoc!.getText("content").toString()).toBe("seed one two");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(bodies).toHaveLength(2);
      server.destroy();
    },
  );

  it.each([true, false])(
    "retains failed teardown operations only for the same user (same=%s)",
    async (sameUser) => {
      const server = new Y.Doc();
      server.getText("content").insert(0, "seed");
      const { mock: fallback } = makeFetchMock();
      let failUpdates = true;
      let updateCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/state"))
            return new Response(
              JSON.stringify({
                state: Buffer.from(Y.encodeStateAsUpdate(server)).toString(
                  "base64",
                ),
                activityBaseline: {
                  status: "ready",
                  version: 1,
                  cursor: "1.baseline",
                },
              }),
            );
          if (!url.endsWith("/update")) return fallback(input);
          updateCount++;
          if (failUpdates) return new Response(null, { status: 503 });
          Y.applyUpdate(
            server,
            Buffer.from(JSON.parse(String(init?.body)).update, "base64"),
          );
          return new Response(JSON.stringify({ ok: true }));
        }),
      );
      const user = {
        name: "Editor",
        email: "editor@example.test",
        color: "blue",
      };
      let result: UseCollaborativeDocResult | undefined;
      const root = mount(
        <Probe
          docId="retired-updates"
          user={user}
          onResult={(next) => {
            result = next;
          }}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => result!.ydoc!.getText("content").insert(4, " unsent"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80);
      });
      act(() => root.render(null));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      const retiredCount = updateCount;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(updateCount).toBe(retiredCount);
      expect(_collabDocRegistrySizeForTests()).toBe(0);
      failUpdates = false;
      mount(
        <Probe
          docId="retired-updates"
          user={sameUser ? user : { ...user, email: "another@example.test" }}
          onResult={(next) => {
            result = next;
          }}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(server.getText("content").toString()).toBe(
        sameUser ? "seed unsent" : "seed",
      );
      expect(result!.ydoc!.getText("content").toString()).toBe(
        sameUser ? "seed unsent" : "seed",
      );
      expect(updateCount).toBe(retiredCount + (sameUser ? 1 : 0));
      server.destroy();
    },
  );

  it.each(["pagehide", "timeout"])(
    "replays an unacknowledged original update after %s",
    async (trigger) => {
      const server = new Y.Doc();
      server.getText("content").insert(0, "seed");
      const { mock: fallback } = makeFetchMock();
      const requests: RequestInit[] = [];
      let rejectFirst!: () => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/state"))
            return new Response(
              JSON.stringify({
                state: Buffer.from(Y.encodeStateAsUpdate(server)).toString(
                  "base64",
                ),
                activityBaseline: {
                  status: "ready",
                  version: 1,
                  cursor: "1.baseline",
                },
              }),
            );
          if (!url.endsWith("/update")) return fallback(input);
          requests.push(init!);
          Y.applyUpdate(
            server,
            Buffer.from(JSON.parse(String(init?.body)).update, "base64"),
          );
          if (requests.length === 1) {
            return new Promise<Response>((_resolve, reject) => {
              rejectFirst = () => reject(new TypeError("response lost"));
              init?.signal?.addEventListener("abort", rejectFirst, {
                once: true,
              });
            });
          }
          return new Response(JSON.stringify({ ok: true }));
        }),
      );
      let result: UseCollaborativeDocResult | undefined;
      mount(
        <Probe
          docId="ambiguous-delivery"
          onResult={(next) => {
            result = next;
          }}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => result!.ydoc!.getText("content").insert(4, " once"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80);
      });
      if (trigger === "pagehide") {
        window.dispatchEvent(new Event("pagehide"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(requests[1]?.keepalive).toBe(true);
        await act(async () => {
          rejectFirst();
          await vi.advanceTimersByTimeAsync(0);
        });
      } else {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(17_000);
        });
      }
      expect(requests).toHaveLength(2);
      expect(requests[1]?.body).toBe(requests[0]?.body);
      expect(server.getText("content").toString()).toBe("seed once");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(requests).toHaveLength(2);
      server.destroy();
    },
  );

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
    expect(a?.isSynced).toBe(true);
    expect(b?.isSynced).toBe(true);
  });

  it("keeps the cold-load connection when the authenticated user resolves", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe docId="cold-load-identity" onResult={(next) => (result = next)} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    const initialYdoc = result?.ydoc;
    expect(initialYdoc).toBeTruthy();
    expect(stateFetches).toHaveLength(1);

    act(() => {
      root.render(
        <Probe
          docId="cold-load-identity"
          user={{
            name: "Ada",
            email: "ada@example.test",
            color: "blue",
          }}
          onResult={(next) => (result = next)}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result?.ydoc).toBe(initialYdoc);
    expect(stateFetches).toHaveLength(1);
    expect(_collabDocRegistrySizeForTests()).toBe(1);
  });

  it("reuses a cold-load connection after identity resolution", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    const user = {
      name: "Ada",
      email: "ada@example.test",
      color: "blue",
    };
    let first: UseCollaborativeDocResult | undefined;
    const firstRoot = mount(
      <Probe
        docId="resolved-registry-identity"
        onResult={(r) => (first = r)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    const coldLoadYdoc = first?.ydoc;

    act(() => {
      firstRoot.render(
        <Probe
          docId="resolved-registry-identity"
          user={user}
          onResult={(r) => (first = r)}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    let second: UseCollaborativeDocResult | undefined;
    mount(
      <Probe
        docId="resolved-registry-identity"
        user={user}
        onResult={(r) => (second = r)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(first?.ydoc).toBe(coldLoadYdoc);
    expect(second?.ydoc).toBe(coldLoadYdoc);
    expect(stateFetches).toHaveLength(1);
    expect(_collabDocRegistrySizeForTests()).toBe(1);
  });

  function awarenessPosts(mock: ReturnType<typeof makeFetchMock>["mock"]) {
    return mock.mock.calls
      .filter(([input]) => String(input).endsWith("/awareness"))
      .map(([, init]) => ({
        ...JSON.parse(String(init?.body)),
        keepalive: init?.keepalive,
      }));
  }

  async function mountPresence() {
    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe
        docId="page-lifecycle"
        user={{ name: "Ada", email: "ada@example.test", color: "blue" }}
        onResult={(next) => (result = next)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result?.isSynced).toBe(true);
    return { root, result: result! };
  }

  it.each([false, true])(
    "clears pagehide presence (persisted=%s) and cancels queued posts",
    async (persisted) => {
      const { mock } = makeFetchMock();
      vi.stubGlobal("fetch", mock);
      const { result } = await mountPresence();
      const before = awarenessPosts(mock);
      result.awareness!.setLocalStateField("cursor", { x: 1 });
      const pagehide = new Event("pagehide");
      Object.defineProperty(pagehide, "persisted", { value: persisted });
      expect((pagehide as PageTransitionEvent).persisted).toBe(persisted);
      window.dispatchEvent(pagehide);
      const clear = awarenessPosts(mock).at(-1)!;
      expect(clear).toMatchObject({
        clientId: result.ydoc!.clientID,
        state: null,
        keepalive: true,
        clearToken: before.at(-1)!.clearToken,
      });
      expect(clear.clientSequence).toBeGreaterThan(
        before.at(-1)!.clientSequence,
      );
      expect(result.ydoc!.isDestroyed).toBe(false);
      expect(result.awareness!.getLocalState()?.user.email).toBe(
        "ada@example.test",
      );

      result.awareness!.setLocalStateField("cursor", { x: 2 });
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(awarenessPosts(mock)).toHaveLength(before.length + 1);
    },
  );

  it("keeps ordinary hidden-tab presence without a clear", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);
    await mountPresence();
    const before = awarenessPosts(mock).length;
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      const posts = awarenessPosts(mock).slice(before);
      expect(posts.length).toBeGreaterThan(0);
      expect(
        posts.every(
          ({ state }) => state !== null && JSON.parse(state).visible === false,
        ),
      ).toBe(true);
    } finally {
      visibility.mockRestore();
    }
  });

  it("resumes the same BFCache document with later presence sequences across repeated restores", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);
    const { result } = await mountPresence();
    const ydoc = result.ydoc!;
    for (let cycle = 0; cycle < 2; cycle++) {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const clear = awarenessPosts(mock).at(-1)!;
      expect(clear.state).toBeNull();
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
      const resumed = awarenessPosts(mock).at(-1)!;
      expect(JSON.parse(resumed.state).visible).toBe(true);
      expect(resumed.clientSequence).toBeGreaterThan(clear.clientSequence);
      expect(resumed.clearToken).toBe(clear.clearToken);
      expect(resumed.clientId).toBe(ydoc.clientID);
      expect(ydoc.isDestroyed).toBe(false);
    }
    expect(stateFetches).toHaveLength(1);
  });

  it("does not publish presence when an in-flight poll completes after pagehide", async () => {
    const { mock } = makeFetchMock();
    const heldPoll = deferredResponse();
    mock.mockImplementationOnce(async () => emptyStateResponse());
    const fallback = mock.getMockImplementation()!;
    mock.mockImplementation(async (input, init) =>
      String(input).includes("/_agent-native/poll")
        ? heldPoll.promise
        : fallback(input, init),
    );
    vi.stubGlobal("fetch", mock);
    await mountPresence();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const count = awarenessPosts(mock).length;
    expect(awarenessPosts(mock).at(-1)).toMatchObject({ state: null });
    await act(async () => {
      heldPoll.resolve(
        new Response(JSON.stringify({ version: 1, events: [] })),
      );
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(awarenessPosts(mock)).toHaveLength(count);
  });

  it("orders a clear and BFCache resume after an older in-flight presence post", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);
    const { result } = await mountPresence();
    const heldPost = deferredResponse();
    const fallback = mock.getMockImplementation()!;
    mock.mockImplementation((input, init) =>
      String(input).endsWith("/awareness")
        ? heldPost.promise
        : fallback(input, init),
    );
    result.awareness!.setLocalStateField("cursor", { x: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    const older = awarenessPosts(mock).at(-1)!;
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    const clear = awarenessPosts(mock).at(-1)!;
    expect(clear.state).toBeNull();
    expect(clear.clientSequence).toBeGreaterThan(older.clientSequence);
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    const resumed = awarenessPosts(mock).at(-1)!;
    expect(resumed.clientSequence).toBeGreaterThan(clear.clientSequence);
    expect(resumed.clearToken).toBe(older.clearToken);
    await act(async () => {
      heldPost.resolve(new Response(null, { status: 204 }));
      await vi.advanceTimersByTimeAsync(0);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(awarenessPosts(mock).at(-1)!.clientSequence).toBeGreaterThan(
      resumed.clientSequence,
    );
  });

  it.each(["dispose", "sign-out"])(
    "does not double-clear or resume after pagehide then %s",
    async (ending) => {
      const { mock } = makeFetchMock();
      vi.stubGlobal("fetch", mock);
      const { root, result } = await mountPresence();
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
      if (ending === "dispose") {
        act(() => root.unmount());
        roots = roots.filter((candidate) => candidate !== root);
      } else {
        await act(async () => {
          await runBeforeSignOutCleanups();
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const posts = awarenessPosts(mock);
      expect(posts.filter(({ state }) => state === null)).toHaveLength(1);
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(awarenessPosts(mock)).toHaveLength(posts.length);
      expect(
        ending === "dispose"
          ? result.ydoc!.isDestroyed
          : result.awareness!.getLocalState() === null,
      ).toBe(true);
    },
  );

  it("captures edits while sign-out cleanup is pending and the editor remains mounted", async () => {
    const { mock } = makeFetchMock();
    const originalFetch = mock.getMockImplementation()!;
    let finishClear!: (response: Response) => void;
    mock.mockImplementation((input, init) => {
      if (
        String(input).endsWith("/awareness") &&
        init?.body &&
        JSON.parse(String(init.body)).state === null
      )
        return new Promise<Response>((resolve) => {
          finishClear = resolve;
        });
      return originalFetch(input, init);
    });
    vi.stubGlobal("fetch", mock);
    const { result } = await mountPresence();
    const cleanup = runBeforeSignOutCleanups();
    expect(result.ydoc!.isDestroyed).toBe(false);
    result.ydoc!.getText("logout-edit").insert(0, "still mounted");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const requests = mock.mock.calls.filter(([input]) =>
      String(input).endsWith("/update"),
    );
    expect(requests.length).toBeGreaterThan(0);
    const received = new Y.Doc();
    try {
      for (const [, init] of requests) {
        const { update } = JSON.parse(String(init?.body));
        Y.applyUpdate(received, new Uint8Array(Buffer.from(update, "base64")));
      }
      expect(received.getText("logout-edit").toString()).toBe("still mounted");
    } finally {
      received.destroy();
    }
    finishClear(new Response("{}"));
    await cleanup;
  });

  it("clears local presence and stops polling before sign-out", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    mount(
      <Probe
        docId="sign-out-presence"
        user={{
          name: "Ada",
          email: "ada@example.test",
          color: "blue",
        }}
        onResult={() => {}}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    const awarenessRequests = () =>
      mock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith("/sign-out-presence/awareness") &&
          (init as RequestInit | undefined)?.method === "POST",
      );
    expect(awarenessRequests()).toHaveLength(1);
    await act(async () => {
      await runBeforeSignOutCleanups();
    });

    expect(awarenessRequests()).toHaveLength(2);
    expect(JSON.parse(String(awarenessRequests()[1]![1]?.body)).state).toBe(
      null,
    );
    const pollCount = mock.mock.calls.filter(([input]) =>
      String(input).includes("/_agent-native/poll"),
    ).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      mock.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/poll"),
      ),
    ).toHaveLength(pollCount);
  });

  it("retires the authenticated connection when its user signs out", async () => {
    const { mock, stateFetches } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe
        docId="signed-out-presence"
        user={{
          name: "Ada",
          email: "ada@example.test",
          color: "blue",
        }}
        onResult={(r) => (result = r)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.ydoc).toBeTruthy();
    expect(stateFetches).toHaveLength(1);

    const pollCount = mock.mock.calls.filter(([input]) =>
      String(input).includes("/_agent-native/poll"),
    ).length;
    act(() => {
      root.render(
        <Probe docId="signed-out-presence" onResult={(r) => (result = r)} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    const clearPosts = mock.mock.calls.filter(([input, init]) => {
      if (
        !String(input).endsWith("/signed-out-presence/awareness") ||
        (init as RequestInit | undefined)?.method !== "POST"
      ) {
        return false;
      }
      return JSON.parse(String(init?.body)).state === null;
    });
    expect(clearPosts).toHaveLength(1);
    expect(result?.ydoc).toBeNull();
    expect(stateFetches).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      mock.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/poll"),
      ),
    ).toHaveLength(pollCount);
    expect(_collabDocRegistrySizeForTests()).toBe(0);
  });

  it.each([200, 503])(
    "publishes presence after same-page reauthentication before an old clear settles with %s",
    async (status) => {
      const { mock } = makeFetchMock();
      const originalFetch = mock.getMockImplementation()!;
      let finishClear!: (response: Response) => void;
      const pendingUpdates: Array<(response: Response) => void> = [];
      mock.mockImplementation((input, init) => {
        if (String(input).endsWith("/update"))
          return new Promise<Response>((resolve) => {
            pendingUpdates.push(resolve);
          });
        if (
          String(input).endsWith("/awareness") &&
          init?.body &&
          JSON.parse(String(init.body)).state === null
        )
          return new Promise<Response>((resolve) => {
            finishClear = resolve;
          });
        return originalFetch(input, init);
      });
      vi.stubGlobal("fetch", mock);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { root, result } = await mountPresence();
      const originalClient = result.ydoc!.clientID;
      result.ydoc!.getText("pending-return").insert(0, "kept edit");
      act(() =>
        root.render(<Probe docId="page-lifecycle" onResult={() => {}} />),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const before = awarenessPosts(mock).length;
      let restored: UseCollaborativeDocResult | undefined;
      act(() =>
        root.render(
          <Probe
            docId="page-lifecycle"
            user={{ name: "Ada", email: "ada@example.test", color: "blue" }}
            onResult={(next) => {
              restored = next;
            }}
          />,
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      const returned = awarenessPosts(mock)
        .slice(before)
        .filter((post) => post.state !== null);
      expect(returned.length).toBeGreaterThan(0);
      expect(returned.at(-1)!.clientId).not.toBe(originalClient);
      expect(JSON.parse(returned.at(-1)!.state).user.email).toBe(
        "ada@example.test",
      );
      expect(restored?.ydoc?.getText("pending-return").toString()).toBe(
        "kept edit",
      );
      await act(async () => {
        for (const resolve of pendingUpdates)
          resolve(new Response("{}", { status: 200 }));
        finishClear(new Response("{}", { status }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(error.mock.calls.length).toBe(status === 503 ? 1 : 0);
    },
  );

  it("creates a new awareness client identity when the authenticated user changes", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);

    const firstUser = {
      name: "First editor",
      email: "first@example.test",
      color: "blue",
    };
    const secondUser = {
      name: "Second editor",
      email: "second@example.test",
      color: "green",
    };
    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe
        docId="account-switch"
        user={firstUser}
        onResult={(next) => (result = next)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const firstClientId = result!.ydoc!.clientID;
    const awarenessPosts = () =>
      mock.mock.calls
        .filter(
          ([input, init]) =>
            String(input).includes("/account-switch/awareness") &&
            (init as RequestInit | undefined)?.method === "POST",
        )
        .map(
          ([, init]) =>
            JSON.parse(String(init?.body)) as {
              clientId: number;
              clearToken: string;
              state: string | null;
            },
        );
    expect(awarenessPosts()).toHaveLength(1);
    expect(awarenessPosts()[0]).toMatchObject({ clientId: firstClientId });
    expect(JSON.parse(awarenessPosts()[0]!.state!).user.email).toBe(
      firstUser.email,
    );

    act(() => {
      root.render(
        <Probe
          docId="account-switch"
          user={secondUser}
          onResult={(next) => (result = next)}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const secondClientId = result!.ydoc!.clientID;
    expect(secondClientId).not.toBe(firstClientId);
    expect(awarenessPosts()).toHaveLength(2);
    expect(awarenessPosts()[1]).toMatchObject({ clientId: secondClientId });
    expect(JSON.parse(awarenessPosts()[1]!.state!).user.email).toBe(
      secondUser.email,
    );
    expect(awarenessPosts()[0]!.clearToken).toMatch(/^[0-9a-f]{64}$/);
    expect(awarenessPosts()[1]!.clearToken).not.toBe(
      awarenessPosts()[0]!.clearToken,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(awarenessPosts()).toHaveLength(3);
    expect(awarenessPosts()[2]).toMatchObject({
      clientId: firstClientId,
      clearToken: awarenessPosts()[0]!.clearToken,
      state: null,
    });
    expect(_collabDocRegistrySizeForTests()).toBe(1);
  });

  it("reconciles state before accepting the first poll watermark without a baseline", async () => {
    const server = new Y.Doc();
    server.getText("content").insert(0, "seed");
    const initialState = Buffer.from(Y.encodeStateAsUpdate(server)).toString(
      "base64",
    );
    let stateVectorFetches = 0;
    const pollUrls: string[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state$/.test(url)) {
        return new Response(
          JSON.stringify({
            state: initialState,
            activityBaseline: { status: "unavailable" },
          }),
        );
      }
      if (/\/collab\/[^/]+\/state\?/.test(url)) {
        stateVectorFetches++;
        server.getText("content").insert(4, " updated");
        const stateVector = Buffer.from(
          new URL(url, window.location.href).searchParams.get("stateVector")!,
          "base64",
        );
        const update = Y.encodeStateAsUpdate(server, stateVector);
        return new Response(
          JSON.stringify({ state: Buffer.from(update).toString("base64") }),
        );
      }
      if (url.includes("/_agent-native/poll")) {
        pollUrls.push(url);
        return new Response(JSON.stringify({ version: 100, events: [] }));
      }
      if (url.includes("/awareness")) {
        return new Response(JSON.stringify({ states: [] }));
      }
      return new Response(JSON.stringify({}));
    });
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    mount(
      <Probe
        docId="unavailable-baseline"
        onResult={(next) => {
          result = next;
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pollUrls[0]).toContain("since=0");
    expect(stateVectorFetches).toBe(1);
    expect(result?.ydoc?.getText("content").toString()).toBe("seed updated");

    server.destroy();
  });

  it("returns a fresh sync receipt after an older transport fetch completes", async () => {
    const backgroundState = deferredResponse();
    const requestedState = deferredResponse();
    let stateVectorFetches = 0;
    const stateVectorRequests: RequestInit[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state\?/.test(url)) {
        stateVectorFetches++;
        stateVectorRequests.push(init ?? {});
        return stateVectorFetches === 1
          ? backgroundState.promise
          : requestedState.promise;
      }
      if (/\/collab\/[^/]+\/state$/.test(url)) return emptyStateResponse();
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 2_000, events: [] }));
      }
      return new Response(JSON.stringify({ states: [] }));
    });
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe docId="receipt-doc" onResult={(next) => (result = next)} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result?.initialization.status).toBe("ready");
    expect(stateVectorFetches).toBe(1);
    const requestSync = result!.requestSync;
    let receipt!: ReturnType<UseCollaborativeDocResult["requestSync"]>;
    act(() => {
      receipt = result!.requestSync();
    });
    expect(stateVectorFetches).toBe(2);
    expect(stateVectorRequests[1]?.cache).toBe("no-store");

    act(() => {
      root.render(
        <Probe docId="receipt-doc" onResult={(next) => (result = next)} />,
      );
    });
    expect(result?.requestSync).toBe(requestSync);

    let outcome: Awaited<typeof receipt> | undefined;
    await act(async () => {
      requestedState.resolve(emptyStateResponse());
      outcome = await receipt;
    });
    expect(outcome).toEqual({ status: "synced" });

    await act(async () => {
      backgroundState.resolve(emptyStateResponse());
      await Promise.resolve();
    });
  });

  it("reports state-vector failure and can retry without a false sync ack", async () => {
    let stateVectorFetches = 0;
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state\?/.test(url)) {
        stateVectorFetches++;
        if (stateVectorFetches === 1) {
          return new Response("nope", { status: 503 });
        }
        if (stateVectorFetches === 2) {
          return new Response(JSON.stringify({ state: "AQ==" }));
        }
        if (stateVectorFetches === 3) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Timed out", "AbortError"));
            });
          });
        }
        return emptyStateResponse();
      }
      if (/\/collab\/[^/]+\/state$/.test(url)) return emptyStateResponse();
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 1, events: [] }));
      }
      return new Response(JSON.stringify({ states: [] }));
    });
    vi.stubGlobal("fetch", mock);

    let result: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe docId="failed-receipt-doc" onResult={(next) => (result = next)} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const failed = await result!.requestSync();
    expect(failed.status).toBe("failed");
    if (failed.status === "failed") {
      expect(failed.error.message).toContain("HTTP 503");
    }
    const malformed = await result!.requestSync();
    expect(malformed.status).toBe("failed");
    const timedOutReceipt = result!.requestSync();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    const timedOut = await timedOutReceipt;
    expect(timedOut.status).toBe("failed");
    await expect(result!.requestSync()).resolves.toEqual({ status: "synced" });

    const staleRequestSync = result!.requestSync;
    act(() => root.unmount());
    roots = roots.filter((candidate) => candidate !== root);
    await expect(staleRequestSync()).resolves.toEqual({
      status: "unavailable",
    });
    expect(stateVectorFetches).toBe(4);
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
    [
      "empty success",
      () => new Response(JSON.stringify({ state: "" })),
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
    expect(_collabDocRegistrySizeForTests()).toBe(1);
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

  it("removes a departed editor from the awareness snapshot", async () => {
    const awarenessByClient = new Map<number, string>();
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state$/.test(url)) return emptyStateResponse();
      if (url.includes("/_agent-native/poll")) {
        return new Response(JSON.stringify({ version: 1, events: [] }));
      }
      if (url.endsWith("/awareness")) {
        const body = JSON.parse(String(init?.body)) as {
          clientId: number;
          state: string | null;
        };
        if (body.state === null) {
          awarenessByClient.delete(body.clientId);
        } else {
          awarenessByClient.set(body.clientId, body.state);
        }
        return new Response(
          JSON.stringify({
            states: Array.from(awarenessByClient, ([clientId, state]) => ({
              clientId,
              state,
            })).filter(({ clientId }) => clientId !== body.clientId),
          }),
        );
      }
      return new Response(JSON.stringify({}));
    });
    vi.stubGlobal("fetch", mock);

    const user = {
      name: "First editor",
      email: "first@example.test",
      color: "#111",
    };
    let first: UseCollaborativeDocResult | undefined;
    const root = mount(
      <Probe
        docId="awareness-unmount"
        user={user}
        onResult={(r) => (first = r)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(awarenessByClient.size).toBe(1);

    act(() => root.unmount());
    roots = roots.filter((candidate) => candidate !== root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(awarenessByClient.size).toBe(0);

    let second: UseCollaborativeDocResult | undefined;
    mount(
      <Probe
        docId="awareness-unmount"
        user={{
          name: "Second editor",
          email: "second@example.test",
          color: "#222",
        }}
        onResult={(r) => (second = r)}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(second?.activeUsers).not.toContainEqual(
      expect.objectContaining({ email: "first@example.test" }),
    );
    expect(first?.ydoc?.isDestroyed).toBe(true);
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
      await vi.advanceTimersByTimeAsync(100);
    });

    let second: UseCollaborativeDocResult | undefined;
    mount(<Probe docId="doc-1" onResult={(r) => (second = r)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second?.ydoc).toBe(firstYdoc);
    expect(stateFetches).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(_collabDocRegistrySizeForTests()).toBe(1);
  });

  it("sends nothing for a document whose last subscriber left before its state arrived", async () => {
    const state = deferredResponse();
    const requests: string[] = [];
    const { mock: fallback } = makeFetchMock();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/collab/deleted-screen/state")) return state.promise;
        return fallback(input);
      }),
    );

    const root = mount(
      <Probe
        docId="deleted-screen"
        onResult={() => {}}
        user={{ name: "Ada", email: "ada@example.com", color: "#000" }}
      />,
    );
    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    await act(async () => {
      state.resolve(emptyStateResponse());
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(
      requests.filter((url) => url.includes("/collab/deleted-screen/")),
    ).toEqual(["/_agent-native/collab/deleted-screen/state"]);
  });

  it("resumes polling when a subscriber returns within the linger window", async () => {
    const { mock } = makeFetchMock();
    vi.stubGlobal("fetch", mock);
    const polls = () =>
      mock.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/poll"),
      ).length;

    const root = mount(<Probe docId="doc-1" onResult={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const pollsBeforeRemount = polls();
    mount(<Probe docId="doc-1" onResult={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(polls()).toBeGreaterThan(pollsBeforeRemount);
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
      await vi.advanceTimersByTimeAsync(200);
    });

    const awarenessPostsAfter = mock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/awareness") &&
        (init as RequestInit | undefined)?.method === "POST",
    ).length;

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

  it("does not post awareness after the last subscriber leaves during a poll, and resumes on remount", async () => {
    const pollResponses: ReturnType<typeof deferredResponse>[] = [];
    const awarenessPosts: string[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state$/.test(url)) {
        return emptyStateResponse();
      }
      if (url.includes("/_agent-native/poll")) {
        const response = deferredResponse();
        pollResponses.push(response);
        return response.promise;
      }
      if (url.endsWith("/awareness")) {
        awarenessPosts.push(url);
        return new Response("missing", { status: 404 });
      }
      return new Response(JSON.stringify({}));
    });
    vi.stubGlobal("fetch", mock);

    const user = {
      name: "Local",
      email: "local@example.com",
      color: "#111",
    };
    let first: UseCollaborativeDocResult | undefined;
    const firstRoot = mount(
      <Probe
        docId="doc-poll-unmount"
        onResult={(next) => (first = next)}
        user={user}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pollResponses.length).toBeGreaterThan(0);
    const initialPollCount = pollResponses.length;
    expect(first?.awareness?.getLocalState()?.user).toMatchObject(user);
    act(() => firstRoot.unmount());
    roots = roots.filter((candidate) => candidate !== firstRoot);
    await act(async () => {
      for (const response of pollResponses.slice(0, initialPollCount)) {
        response.resolve(
          new Response(JSON.stringify({ version: 1, events: [] })),
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(awarenessPosts).toEqual([]);

    let second: UseCollaborativeDocResult | undefined;
    mount(
      <Probe
        docId="doc-poll-unmount"
        onResult={(next) => (second = next)}
        user={user}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(second?.ydoc).toBe(first?.ydoc);
    const resumedPolls = pollResponses.slice(initialPollCount);
    expect(resumedPolls.length).toBeGreaterThan(0);
    await act(async () => {
      for (const response of resumedPolls) {
        response.resolve(
          new Response(JSON.stringify({ version: 2, events: [] })),
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(awarenessPosts.length).toBeGreaterThan(0);
    expect(
      awarenessPosts.every((url) => url.endsWith("doc-poll-unmount/awareness")),
    ).toBe(true);
  });

  it("does not let an old in-flight poll schedule another chain after remount", async () => {
    const pollResponses: ReturnType<typeof deferredResponse>[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state$/.test(url)) return emptyStateResponse();
      if (url.includes("/_agent-native/poll")) {
        const response = deferredResponse();
        pollResponses.push(response);
        return response.promise;
      }
      if (url.endsWith("/awareness")) {
        return new Response(JSON.stringify({ states: [] }));
      }
      return new Response(JSON.stringify({}));
    });
    vi.stubGlobal("fetch", mock);

    const firstRoot = mount(
      <Probe docId="doc-poll-remount" onResult={() => {}} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const initialPollCount = pollResponses.length;
    expect(initialPollCount).toBeGreaterThan(0);

    act(() => firstRoot.unmount());
    roots = roots.filter((candidate) => candidate !== firstRoot);

    const secondRoot = mount(
      <Probe docId="doc-poll-remount" onResult={() => {}} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const remountedPollCount = pollResponses.length;
    expect(remountedPollCount).toBeGreaterThan(initialPollCount);

    await act(async () => {
      for (const response of pollResponses.slice(0, initialPollCount)) {
        response.resolve(
          new Response(JSON.stringify({ version: 2, events: [] })),
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(
      mock.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/poll"),
      ),
    ).toHaveLength(remountedPollCount);

    act(() => secondRoot.unmount());
    roots = roots.filter((candidate) => candidate !== secondRoot);
    await act(async () => {
      for (const response of pollResponses.slice(initialPollCount)) {
        response.resolve(
          new Response(JSON.stringify({ version: 3, events: [] })),
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
