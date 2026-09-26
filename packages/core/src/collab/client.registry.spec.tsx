// @vitest-environment happy-dom


import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { _resetSyncTransportRegistryForTests } from "../client/use-db-sync.js";
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
    JSON.stringify({ state: "AQGw+tWiDgAEAQdjb250ZW50BHNlZWQA" }),
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
});
