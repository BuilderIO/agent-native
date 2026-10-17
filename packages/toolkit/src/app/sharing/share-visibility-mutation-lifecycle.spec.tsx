// @vitest-environment happy-dom

import {
  useShareButtonController,
  type ShareButtonController,
} from "@agent-native/core/client/sharing/useShareButtonController";
import {
  useShareDialogController,
  type ResourceSharesResponse,
  type ShareDialogController,
  type ShareVisibility,
} from "@agent-native/core/client/sharing/useShareDialogController";
import { ShareVisibilityNotSavedError } from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These specs drive the real TanStack `useMutation` / `useQuery` observers
// behind a controllable transport. A per-call `mutate(vars, { onSuccess })`
// callback only fires for the observer's latest call and only while it is
// mounted, so code built on those callbacks leaves the promise it returned
// pending after a newer write or an unmount. Nothing here invokes those
// callbacks by hand: the library decides, which is the behavior under test.
const transport = vi.hoisted(() => {
  interface WriteCall {
    resourceId: string;
    visibility: "private" | "org" | "public";
    resolve: (visibility?: "private" | "org" | "public") => void;
    reject: (error: Error) => void;
  }
  return {
    server: { visibility: "private" as "private" | "org" | "public" },
    resources: new Map<string, "private" | "org" | "public">(),
    reads: [] as string[],
    pauseReads: false,
    releaseReads: [] as Array<() => void>,
    shared: vi.fn(),
    writes: [] as WriteCall[],
  };
});

vi.mock("@agent-native/core/client/use-action", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    useActionQuery: (
      name: string,
      params: { resourceId?: string },
      options?: { enabled?: boolean; staleTime?: number },
    ) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: async () => {
          if (name !== "list-resource-shares") return [];
          const id = params.resourceId ?? "doc-1";
          transport.reads.push(id);
          const data: ResourceSharesResponse = {
            ownerEmail: "owner@example.test",
            orgId: "org-1",
            visibility:
              id === "doc-1"
                ? transport.server.visibility
                : (transport.resources.get(id) ?? "private"),
            role: "owner",
            shares: [],
            policy: { allowPublic: true },
          };
          return transport.pauseReads
            ? new Promise<ResourceSharesResponse>((resolve) =>
                transport.releaseReads.push(() => resolve(data)),
              )
            : data;
        },
        ...options,
      }),
    useActionMutation: (name: string) =>
      useMutation({
        mutationFn: (variables: {
          resourceId: string;
          visibility: ShareVisibility;
        }) => {
          if (name !== "set-resource-visibility") {
            return Promise.reject(new Error(`Unexpected write: ${name}`));
          }
          return new Promise<{ visibility: ShareVisibility }>(
            (resolve, reject) => {
              transport.writes.push({
                resourceId: variables.resourceId,
                visibility: variables.visibility,
                resolve: (visibility = variables.visibility) => {
                  if (variables.resourceId === "doc-1")
                    transport.server.visibility = visibility;
                  else
                    transport.resources.set(variables.resourceId, visibility);
                  resolve({ visibility });
                },
                reject,
              });
            },
          );
        },
      }),
  };
});

/** What an awaited promise has done so far, without ever awaiting it. */
interface Outcome {
  status: "pending" | "resolved" | "rejected";
  reason?: unknown;
}

function track(promise: Promise<unknown>): Outcome {
  const outcome: Outcome = { status: "pending" };
  promise.then(
    () => {
      outcome.status = "resolved";
    },
    (reason) => {
      outcome.status = "rejected";
      outcome.reason = reason;
    },
  );
  return outcome;
}

/** Starts a call inside `act` and records how its promise ends. */
async function start(call: () => Promise<unknown>): Promise<Outcome> {
  let outcome!: Outcome;
  await act(async () => {
    outcome = track(call());
  });
  return outcome;
}

/** Settles a transport write inside `act` so React state updates are flushed. */
async function drive(action: () => void) {
  await act(async () => {
    action();
  });
}

/** Lets timers, microtasks and React effects run for a bounded moment. */
async function tick(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

interface Surface {
  mount: () => Promise<void>;
  unmount: () => void;
  /** The Promise API under test for this controller. */
  request: (next: ShareVisibility) => Promise<void>;
  requestFromUi: (next: ShareVisibility) => void;
  setOpen: (open: boolean) => void;
  setResource: (id: string) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
  value: () => ShareVisibility;
  busy: () => boolean;
  /** The error the UI shows for the share surface; null when clean. */
  error: () => unknown;
}

interface Env {
  root: () => Root;
  queryClient: () => QueryClient;
}

const surfaces: Array<[string, (env: Env) => Surface]> = [
  ["ShareButton handleVisibilityChange", buttonSurface],
  ["ShareDialog visibility.transition.request", dialogSurface],
];

describe.each(surfaces)("%s lifecycle", (_name, createSurface) => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let queryClient: QueryClient;
  let surface: Surface;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          orgId: "org-1",
          orgName: "Acme",
          orgs: [],
          members: [],
        }),
      }),
    );
    transport.server.visibility = "private";
    transport.resources.clear();
    transport.reads.length = 0;
    transport.pauseReads = false;
    transport.releaseReads.length = 0;
    transport.shared.mockClear();
    transport.writes.length = 0;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    surface = createSurface({
      root: () => root,
      queryClient: () => queryClient,
    });
    await surface.mount();
  });

  afterEach(async () => {
    if (mounted) act(() => root.unmount());
    transport.pauseReads = false;
    await drive(() => transport.releaseReads.forEach((release) => release()));
    await drive(() => transport.writes.forEach((write) => write.resolve()));
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  const unmount = () => {
    act(() => surface.unmount());
    mounted = false;
  };

  const cacheKey = (resourceId: string) =>
    [
      "action",
      "list-resource-shares",
      { resourceType: "document", resourceId },
    ] as const;
  const cached = (id: string) =>
    queryClient.getQueryData<ResourceSharesResponse>(cacheKey(id));
  const moveTo = async (id: string) => {
    await drive(() => surface.setResource(id));
    await until(() => cached(id) !== undefined, `the ${id} share state`);
    await tick();
  };

  it.each([
    ["removed", "fails"],
    ["recreated", "fails"],
    ["removed", "succeeds"],
    ["recreated", "succeeds"],
  ] as const)(
    "clears A's own override when its query is %s and its save %s",
    async (entry, outcome) => {
      const initial = cached("doc-1");
      const heldA = await start(() => surface.request("org"));
      await start(() => surface.confirm());
      await until(() => transport.writes.length === 1, "A's confirmed write");
      await moveTo("doc-2");
      const oldQuery = queryClient
        .getQueryCache()
        .find({ queryKey: cacheKey("doc-1"), exact: true });
      await drive(() => {
        queryClient.removeQueries({ queryKey: cacheKey("doc-1"), exact: true });
        if (entry === "recreated")
          queryClient.setQueryData(cacheKey("doc-1"), initial);
      });
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: cacheKey("doc-1"), exact: true }),
      ).not.toBe(oldQuery);
      const bSnapshot = cached("doc-2");
      const readsBeforeSettlement = [...transport.reads];
      await drive(() => {
        if (outcome === "fails")
          transport.writes[0].reject(new Error("A save failed"));
        else transport.writes[0].resolve();
      });
      await tick();
      expect(heldA.status).toBe(outcome === "fails" ? "rejected" : "resolved");
      expect(cached("doc-1")).toEqual(
        entry === "recreated" ? initial : undefined,
      );
      expect(cached("doc-2")).toEqual(bSnapshot);
      expect(surface.value()).toBe("private");
      expect(surface.error()).toBeNull();
      expect(transport.shared).not.toHaveBeenCalled();
      expect(transport.reads).toEqual(readsBeforeSettlement);
      // The next authoritative read may reflect a later access change too.
      transport.server.visibility = "private";
      await moveTo("doc-1");
      expect(cached("doc-1")?.visibility).toBe("private");
      expect(surface.value()).toBe("private");
      const newer = await start(() => surface.request("public"));
      await until(() => transport.writes.length === 2, "A's newer write");
      await drive(() =>
        queryClient.setQueryData<ResourceSharesResponse>(
          cacheKey("doc-1"),
          (previous) =>
            previous ? { ...previous, visibility: "private" } : previous,
        ),
      );
      await tick();
      expect(surface.value()).toBe("public");
      expect(newer.status).toBe("pending");
      await drive(() => transport.writes[1].resolve());
      await tick();
      expect(newer.status).toBe("resolved");
      expect(surface.value()).toBe("public");
    },
  );

  it("rolls back A without changing pending B or discarding unrelated share updates", async () => {
    const heldA = await start(() => surface.request("org"));
    const confirmedA = await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "A's confirmed write");
    expect(cached("doc-1")?.visibility).toBe("org");
    await moveTo("doc-2");
    const pendingB = await start(() => surface.request("public"));
    await until(() => transport.writes.length === 2, "B's direct write");
    const bSnapshot = cached("doc-2");
    const addedShare = {
      id: "new-share",
      principalType: "user" as const,
      principalId: "viewer@example.test",
      role: "viewer" as const,
    };
    await drive(() =>
      queryClient.setQueryData<ResourceSharesResponse>(
        cacheKey("doc-1"),
        (previous) =>
          previous
            ? { ...previous, shares: [addedShare], agentReadable: true }
            : previous,
      ),
    );
    const readsBeforeFailure = [...transport.reads];
    await drive(() => transport.writes[0].reject(new Error("A save failed")));
    await tick();
    expect(cached("doc-1")).toMatchObject({
      visibility: "private",
      shares: [addedShare],
      agentReadable: true,
    });
    expect(cached("doc-2")).toEqual(bSnapshot);
    expect(surface.value()).toBe("public");
    expect(surface.error()).toBeNull();
    expect(surface.busy()).toBe(true);
    expect(pendingB.status).toBe("pending");
    expect(heldA).toMatchObject({
      status: "rejected",
      reason: { reason: "dropped" },
    });
    expect(confirmedA.status).toBe("resolved");
    expect(transport.reads).toEqual(readsBeforeFailure);
    await moveTo("doc-1");
    expect(surface.value()).toBe("private");
    await drive(() => transport.writes[1].resolve());
    await tick();
    expect(pendingB.status).toBe("resolved");
  });

  it("commits A's authoritative success without clearing B's override or invoking B's UI work", async () => {
    const heldA = await start(() => surface.request("org"));
    await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "A's confirmed write");
    await moveTo("doc-2");
    const pendingB = await start(() => surface.request("public"));
    await until(() => transport.writes.length === 2, "B's direct write");
    const readsBeforeSuccess = [...transport.reads];
    await drive(() => transport.writes[0].resolve("private"));
    await tick();
    expect(cached("doc-1")?.visibility).toBe("private");
    expect(cached("doc-2")?.visibility).toBe("public");
    expect(surface.value()).toBe("public");
    expect(surface.error()).toBeNull();
    expect(surface.busy()).toBe(true);
    expect(heldA.status).toBe("resolved");
    expect(pendingB.status).toBe("pending");
    expect(transport.shared).not.toHaveBeenCalled();
    expect(transport.reads).toEqual(readsBeforeSuccess);
    await drive(() => transport.writes[1].resolve());
    await tick();
  });

  it("restores A on A to B to A and permits a new intent only after A's failed physical save settles", async () => {
    await start(() => surface.request("org"));
    await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "A's confirmed write");
    await moveTo("doc-2");
    await moveTo("doc-1");
    const refused = await start(() => surface.request("public"));
    expect(refused).toMatchObject({
      status: "rejected",
      reason: { reason: "ignored" },
    });
    expect(transport.writes).toHaveLength(1);
    await drive(() =>
      transport.writes[0].reject(new Error("A obsolete failure")),
    );
    await tick();
    expect(surface.value()).toBe("private");
    expect(surface.error()).toBeNull();
    const newer = await start(() => surface.request("public"));
    await until(() => transport.writes.length === 2, "A's newer write");
    expect(cached("doc-1")?.visibility).toBe("public");
    await drive(() => transport.writes[1].resolve());
    await tick();
    expect(newer.status).toBe("resolved");
    expect(surface.value()).toBe("public");
  });

  it("does not refetch B or run share-success UI when A settles after navigation without a B write", async () => {
    const heldA = await start(() => surface.request("org"));
    await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "A's confirmed write");
    await moveTo("doc-2");
    const readsBeforeSuccess = [...transport.reads];
    await drive(() => transport.writes[0].resolve());
    await tick();
    expect(heldA.status).toBe("resolved");
    expect(cached("doc-1")?.visibility).toBe("org");
    expect(surface.value()).toBe("private");
    expect(surface.error()).toBeNull();
    expect(transport.shared).not.toHaveBeenCalled();
    expect(transport.reads).toEqual(readsBeforeSuccess);
  });

  // The dialog releases its physical write lock before its background refetch
  // finishes; the button already waits for that refetch before releasing it.
  if (_name === "ShareDialog visibility.transition.request") {
    it("does not clear a newer A override when query removal settles the old background refetch", async () => {
      const initial = cached("doc-1");
      const first = await start(() => surface.request("public"));
      await until(() => transport.writes.length === 1, "the first write");
      transport.pauseReads = true;
      await drive(() => transport.writes[0].resolve());
      await until(() => transport.releaseReads.length === 1, "the old refetch");
      expect(first.status).toBe("resolved");
      let newer!: Outcome;
      await act(async () => {
        queryClient.removeQueries({ queryKey: cacheKey("doc-1"), exact: true });
        queryClient.setQueryData(cacheKey("doc-1"), initial);
        newer = track(surface.request("org"));
        queryClient.setQueryData(cacheKey("doc-1"), initial);
      });
      await until(() => transport.writes.length === 2, "the newer write");
      await tick();
      expect(cached("doc-1")?.visibility).toBe("private");
      expect(surface.value()).toBe("org");
      expect(newer.status).toBe("pending");
      transport.pauseReads = false;
      await drive(() => transport.writes[1].resolve());
      await tick();
      await drive(() => transport.releaseReads[0]());
      await tick();
      expect(newer.status).toBe("resolved");
      expect(surface.value()).toBe("org");
    });

    it("does not let the preceding refetch overwrite a newer saved visibility", async () => {
      const first = await start(() => surface.request("public"));
      await until(() => transport.writes.length === 1, "the first write");
      transport.pauseReads = true;
      await drive(() => transport.writes[0].resolve());
      await until(() => transport.releaseReads.length === 1, "the old refetch");
      expect(first.status).toBe("resolved");
      const newer = await start(() => surface.request("private"));
      await until(() => transport.writes.length === 2, "the newer write");
      transport.pauseReads = false;
      await drive(() => transport.writes[1].resolve());
      await tick();
      expect(newer.status).toBe("resolved");
      expect(surface.value()).toBe("private");
      await drive(() => transport.releaseReads[0]());
      await tick();
      expect(cached("doc-1")?.visibility).toBe("private");
      expect(surface.value()).toBe("private");
    });
  }

  it("refuses a different direct target until the first write persists, then permits retry", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();
    expect(transport.writes.map((w) => w.visibility)).toEqual(["public"]);
    expect(first.status).toBe("pending");
    expect(surface.busy()).toBe(true);
    expect(second.status).toBe("rejected");
    expect(second.reason).toMatchObject({
      name: "ShareVisibilityNotSavedError",
      reason: "ignored",
    });
    expect(surface.value()).toBe("public");
    expect(transport.server.visibility).toBe("private");

    await drive(() => transport.writes[0].resolve());
    await tick();
    expect(surface.busy()).toBe(false);
    const retry = await start(() => surface.request("private"));
    await until(() => transport.writes.length === 2, "the retry write");
    expect(retry.status).toBe("pending");
    await drive(() => transport.writes[1].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(retry.status).toBe("resolved");
    expect(transport.server.visibility).toBe("private");
    expect(surface.value()).toBe("private");
  });

  it("prevents Org to Private to Public writes from committing out of order", async () => {
    const held = await start(() => surface.request("org"));
    await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "the org write");
    await drive(() => transport.writes[0].resolve());
    await tick();
    expect(held.status).toBe("resolved");
    expect(transport.server.visibility).toBe("org");

    const first = await start(() => surface.request("private"));
    await until(() => transport.writes.length === 2, "the private write");
    const second = await start(() => surface.request("public"));
    expect(second.status).toBe("rejected");
    expect(second.reason).toMatchObject({ reason: "ignored" });
    expect(transport.writes.map((write) => write.visibility)).toEqual([
      "org",
      "private",
    ]);
    expect(first.status).toBe("pending");
    expect(surface.value()).toBe("private");
    expect(transport.server.visibility).toBe("org");

    await drive(() => transport.writes[1].resolve());
    await tick();
    expect(first.status).toBe("resolved");
    const retry = await start(() => surface.request("public"));
    await until(() => transport.writes.length === 3, "the public retry");
    await drive(() => transport.writes[2].resolve());
    await tick();
    expect(retry.status).toBe("resolved");
    expect(transport.server.visibility).toBe("public");
    expect(surface.value()).toBe("public");
  });

  it("keeps the actual direct save pending after refusing the newer target", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    expect(transport.writes).toHaveLength(1);
    expect(second.status).toBe("rejected");
    expect(second.reason).toMatchObject({ reason: "ignored" });
    expect(first.status).toBe("pending");
    await drive(() => transport.writes[0].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(surface.value()).toBe("public");
    expect(transport.server.visibility).toBe("public");
  });

  it("reports the actual save failure after refusing a different target and releases the lock", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    const failure = new Error("first save failed");
    await drive(() => transport.writes[0].reject(failure));
    await tick();
    expect(second.status).toBe("rejected");
    expect(second.reason).toMatchObject({ reason: "ignored" });
    expect(transport.writes).toHaveLength(1);
    expect(surface.error()).toBe("first save failed");
    expect(surface.value()).toBe("private");
    const retry = await start(() => surface.request("public"));
    await until(() => transport.writes.length === 2, "the retry write");
    await drive(() => transport.writes[1].resolve());
    await tick();

    expect(first.status).toBe("rejected");
    expect(first.reason).toBe(failure);
    expect(retry.status).toBe("resolved");
    expect(surface.error()).toBeNull();
  });

  it("reports a failed retry after the preceding direct save has settled", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    await drive(() => transport.writes[0].resolve());
    await tick();
    const second = await start(() => surface.request("private"));
    await until(() => transport.writes.length === 2, "the second write");
    const failure = new Error("second save failed");
    await drive(() => transport.writes[1].reject(failure));
    await tick();

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("rejected");
    expect(second.reason).toBe(failure);
    // The newest request failing is what the UI reports.
    expect(surface.error()).not.toBeNull();
  });

  it("keeps the actual pending target after a different void UI request is refused", async () => {
    const older = await start(() => surface.request("public"));
    await tick();
    await drive(() => surface.requestFromUi("private"));
    await tick();
    expect(transport.writes).toHaveLength(1);
    expect(surface.value()).toBe("public");
    expect(surface.error()).toBeNull();
    const failure = new Error("actual save failed");
    await drive(() => transport.writes[0].reject(failure));
    await tick();

    expect(older.status).toBe("rejected");
    expect(older.reason).toBe(failure);
    expect(surface.error()).toBe("actual save failed");
    expect(surface.value()).toBe("private");
    expect(transport.server.visibility).toBe("private");
  });

  it("resolves a write that finishes after the surface unmounted", async () => {
    const saved = await start(() => surface.request("public"));
    await tick();
    expect(transport.writes).toHaveLength(1);

    unmount();
    await drive(() => transport.writes[0].resolve());
    await tick();

    expect(saved.status).toBe("resolved");
  });

  it("rejects a write that fails after the surface unmounted", async () => {
    const saved = await start(() => surface.request("public"));
    await tick();

    unmount();
    const failure = new Error("save failed after unmount");
    await drive(() => transport.writes[0].reject(failure));
    await tick();

    expect(saved.status).toBe("rejected");
    expect(saved.reason).toBe(failure);
  });

  it("settles the actual write after refusing overlap and unmounting", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    unmount();
    await drive(() => transport.writes[0].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("rejected");
    expect(second.reason).toMatchObject({ reason: "ignored" });
    expect(transport.writes).toHaveLength(1);
    expect(transport.server.visibility).toBe("public");
  });

  it("makes a repeat of the optimistic target wait for the save in flight", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    expect(surface.value()).toBe("public");

    const repeat = await start(() => surface.request("public"));
    await tick();

    // Nothing was persisted yet, so the repeat must not read as saved, and it
    // must reuse the write already running rather than start another.
    expect(transport.writes).toHaveLength(1);
    expect(first.status).toBe("pending");
    expect(repeat.status).toBe("pending");

    await drive(() => transport.writes[0].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(repeat.status).toBe("resolved");
    expect(transport.writes).toHaveLength(1);
  });

  it("fails a repeat of the optimistic target when the save in flight fails", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const repeat = await start(() => surface.request("public"));
    await tick();

    const failure = new Error("save failed");
    await drive(() => transport.writes[0].reject(failure));
    await tick();

    expect(first.status).toBe("rejected");
    expect(first.reason).toBe(failure);
    expect(repeat.status).toBe("rejected");
    expect(repeat.reason).toBe(failure);
    expect(transport.writes).toHaveLength(1);
  });

  it("resolves a held organization request whose confirmed save finishes after unmount", async () => {
    const held = await start(() => surface.request("org"));
    await tick();
    expect(transport.writes).toHaveLength(0);

    const confirmed = await start(() => surface.confirm());
    await tick();
    expect(transport.writes.map((w) => w.visibility)).toEqual(["org"]);

    unmount();
    await drive(() => transport.writes[0].resolve());
    await tick();

    expect(confirmed.status).toBe("resolved");
    expect(held.status).toBe("resolved");
  });

  it("rejects a held organization request whose confirmed save fails after unmount", async () => {
    const held = await start(() => surface.request("org"));
    await tick();
    const confirmed = await start(() => surface.confirm());
    await tick();

    unmount();
    const failure = new Error("confirmed save failed");
    await drive(() => transport.writes[0].reject(failure));
    await tick();

    expect(held.status).toBe("rejected");
    expect(held.reason).toBeInstanceOf(ShareVisibilityNotSavedError);
    expect(held.reason).toMatchObject({ reason: "dropped" });
    expect(confirmed.status).toBe("resolved");
  });

  it.each(["API", "UI"])(
    "keeps the resource locked across close/reopen for a conflicting %s choice",
    async (caller) => {
      const held = await start(() => surface.request("org"));
      const confirmed = await start(() => surface.confirm());
      await until(() => transport.writes.length === 1, "the confirmed write");

      await drive(() => surface.setOpen(false));
      await drive(() => surface.setOpen(true));
      let newer: Outcome | undefined;
      if (caller === "API") {
        newer = await start(() => surface.request("private"));
        expect(newer.status).toBe("rejected");
        expect(newer.reason).toMatchObject({
          name: "ShareVisibilityNotSavedError",
          reason: "ignored",
        });
      } else {
        await drive(() => surface.requestFromUi("private"));
      }
      await tick();
      expect(transport.writes.map((write) => write.visibility)).toEqual([
        "org",
      ]);
      expect(transport.server.visibility).toBe("private");
      expect(held.status).toBe("pending");
      expect(confirmed.status).toBe("pending");
      expect(surface.error()).toBeNull();

      await drive(() => transport.writes[0].resolve());
      await tick();
      expect(held.status).toBe("resolved");
      expect(confirmed.status).toBe("resolved");
      expect(transport.server.visibility).toBe("org");
      expect(transport.writes).toHaveLength(1);

      if (caller === "API") {
        newer = await start(() => surface.request("private"));
        expect(newer.status).toBe("pending");
      } else {
        await drive(() => surface.requestFromUi("private"));
      }
      await until(() => transport.writes.length === 2, "the newer write");
      expect(transport.writes.map((write) => write.visibility)).toEqual([
        "org",
        "private",
      ]);
      expect(transport.server.visibility).toBe("org");
      await drive(() => transport.writes[1].resolve());
      await tick();
      if (caller === "API") expect(newer?.status).toBe("resolved");
      expect(transport.server.visibility).toBe("private");
      expect(surface.value()).toBe("private");
    },
  );

  it("reuses the confirmed target after close/reopen until it persists", async () => {
    const held = await start(() => surface.request("org"));
    const confirmed = await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "the confirmed write");
    await drive(() => surface.setOpen(false));
    await drive(() => surface.setOpen(true));
    const repeated = await start(() => surface.request("org"));
    expect(repeated.status).toBe("pending");
    expect(transport.writes).toHaveLength(1);
    await drive(() => transport.writes[0].resolve());
    await tick();
    expect(held.status).toBe("resolved");
    expect(confirmed.status).toBe("resolved");
    expect(repeated.status).toBe("resolved");
  });

  it("types an invalidated confirmed failure and releases its resource lock", async () => {
    const held = await start(() => surface.request("org"));
    const confirmed = await start(() => surface.confirm());
    await until(() => transport.writes.length === 1, "the confirmed write");
    await drive(() => surface.setOpen(false));
    await drive(() => surface.setOpen(true));
    await drive(() =>
      transport.writes[0].reject(new Error("obsolete failure")),
    );
    await tick();
    expect(held.status).toBe("rejected");
    expect(held.reason).toBeInstanceOf(ShareVisibilityNotSavedError);
    expect(held.reason).toMatchObject({ reason: "dropped" });
    expect(confirmed.status).toBe("resolved");
    expect(surface.error()).toBeNull();

    const newer = await start(() => surface.request("public"));
    await until(() => transport.writes.length === 2, "the retry write");
    expect(newer.status).toBe("pending");
    await drive(() => transport.writes[1].resolve());
    await tick();
    expect(newer.status).toBe("resolved");
    expect(transport.server.visibility).toBe("public");
  });

  it("reports an unawaited UI save failure without an unhandled rejection", async () => {
    await drive(() => surface.requestFromUi("public"));
    await until(() => transport.writes.length === 1, "the UI write");
    await drive(() => transport.writes[0].reject(new Error("UI save failed")));
    await tick();
    expect(surface.error()).toBe("UI save failed");
    expect(surface.value()).toBe("private");
  });

  it("cancels an unawaited UI confirmation without reporting a save failure", async () => {
    await drive(() => surface.requestFromUi("org"));
    await drive(() => surface.cancel());
    await tick();
    expect(transport.writes).toHaveLength(0);
    expect(surface.error()).toBeNull();
  });

  it("rejects a request made while a confirmed save runs instead of leaving it hanging", async () => {
    const held = await start(() => surface.request("org"));
    await tick();
    await start(() => surface.confirm());
    await tick();

    const refused = await start(() => surface.request("private"));
    await tick();

    expect(refused.status).toBe("rejected");
    expect(refused.reason).toBeInstanceOf(ShareVisibilityNotSavedError);
    expect(transport.writes).toHaveLength(1);

    await drive(() => transport.writes[0].resolve());
    await tick();
    expect(held.status).toBe("resolved");
  });
});

// The surfaces live below the suite so the table above reads first. A hook
// result only exists during render, so each harness keeps the latest one.
async function until(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (condition()) return;
    await tick(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function buttonSurface(env: Env): Surface {
  let controller: ShareButtonController | undefined;
  let setResource!: (id: string) => void;
  const live = () => controller as ShareButtonController;
  function Harness() {
    const [resourceId, updateResource] = useState("doc-1");
    setResource = updateResource;
    controller = useShareButtonController({
      resourceType: "document",
      resourceId,
      onShareSuccess: transport.shared,
    });
    return null;
  }
  return {
    async mount() {
      await act(async () => {
        env.root().render(
          <QueryClientProvider client={env.queryClient()}>
            <Harness />
          </QueryClientProvider>,
        );
      });
      act(() => live().handleOpenChange(true));
      await until(() => live().canManage, "the share state to load");
    },
    unmount: () => env.root().unmount(),
    request: (next) => live().handleVisibilityChange(next),
    requestFromUi: (next) => live().handleVisibility(next),
    setOpen: (open) => live().handleOpenChange(open),
    setResource: (id) => setResource(id),
    confirm: () => live().visibilityTransition.confirm(),
    cancel: () => live().visibilityTransition.cancel(),
    value: () => live().visibility,
    error: () => live().shareError,
    busy: () => live().visibilityTransition.submitting,
  };
}

function dialogSurface(env: Env): Surface {
  let controller: ShareDialogController | undefined;
  let setOpen!: (open: boolean) => void;
  let setResource!: (id: string) => void;
  const live = () => controller as ShareDialogController;
  function Harness() {
    const [resourceId, updateResource] = useState("doc-1");
    setResource = updateResource;
    const [open, updateOpen] = useState(true);
    setOpen = updateOpen;
    controller = useShareDialogController({
      open,
      onClose: () => undefined,
      resourceType: "document",
      resourceId,
      resourceTitle: "Quarterly plan",
    });
    return null;
  }
  return {
    async mount() {
      await act(async () => {
        env.root().render(
          <QueryClientProvider client={env.queryClient()}>
            <Harness />
          </QueryClientProvider>,
        );
      });
      await until(() => !live().visibility.disabled, "the share state to load");
    },
    unmount: () => env.root().unmount(),
    request: (next) => live().visibility.transition.request(next),
    requestFromUi: (next) => live().visibility.set(next),
    setOpen: (open) => setOpen(open),
    setResource: (id) => setResource(id),
    confirm: () => live().visibility.transition.confirm(),
    cancel: () => live().visibility.transition.cancel(),
    value: () => live().visibility.value,
    error: () => live().error,
    busy: () => live().visibility.disabled,
  };
}
