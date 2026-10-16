// @vitest-environment happy-dom

import {
  useShareButtonController,
  type ShareButtonController,
} from "@agent-native/core/client/sharing/useShareButtonController";
import {
  useShareDialogController,
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
    visibility: "private" | "org" | "public";
    resolve: () => void;
    reject: (error: Error) => void;
  }
  return {
    server: { visibility: "private" as "private" | "org" | "public" },
    writes: [] as WriteCall[],
  };
});

vi.mock("@agent-native/core/client/use-action", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    useActionQuery: (
      name: string,
      params: unknown,
      options?: { enabled?: boolean; staleTime?: number },
    ) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: async () =>
          name === "list-resource-shares"
            ? {
                ownerEmail: "owner@example.test",
                orgId: "org-1",
                visibility: transport.server.visibility,
                role: "owner",
                shares: [],
                policy: { allowPublic: true },
              }
            : [],
        ...options,
      }),
    useActionMutation: (name: string) =>
      useMutation({
        mutationFn: (variables: { visibility: ShareVisibility }) => {
          if (name !== "set-resource-visibility") {
            return Promise.reject(new Error(`Unexpected write: ${name}`));
          }
          return new Promise<{ visibility: ShareVisibility }>(
            (resolve, reject) => {
              transport.writes.push({
                visibility: variables.visibility,
                resolve: () => {
                  transport.server.visibility = variables.visibility;
                  resolve({ visibility: variables.visibility });
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
  confirm: () => Promise<void>;
  cancel: () => void;
  value: () => ShareVisibility;
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

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  const unmount = () => {
    act(() => surface.unmount());
    mounted = false;
  };

  it("settles every write when overlapping direct writes finish in order", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();
    expect(transport.writes.map((w) => w.visibility)).toEqual([
      "public",
      "private",
    ]);

    await drive(() => transport.writes[0].resolve());
    await tick();
    await drive(() => transport.writes[1].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    expect(surface.value()).toBe("private");
  });

  it("settles every write when the newer write finishes first", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    await drive(() => transport.writes[1].resolve());
    await tick();
    await drive(() => transport.writes[0].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
  });

  it("rejects a superseded write that fails while the newer one saves", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    const failure = new Error("first save failed");
    await drive(() => transport.writes[0].reject(failure));
    await tick();
    await drive(() => transport.writes[1].resolve());
    await tick();

    expect(first.status).toBe("rejected");
    expect(first.reason).toBe(failure);
    expect(second.status).toBe("resolved");
  });

  it("rejects the newest write when it fails and still resolves the earlier one", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    const failure = new Error("second save failed");
    await drive(() => transport.writes[0].resolve());
    await tick();
    await drive(() => transport.writes[1].reject(failure));
    await tick();

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("rejected");
    expect(second.reason).toBe(failure);
    // The newest request failing is what the UI reports.
    expect(surface.error()).not.toBeNull();
  });

  it("keeps the shown error clean when an older write fails after a newer one saved", async () => {
    const older = await start(() => surface.request("public"));
    await tick();
    const newer = await start(() => surface.request("private"));
    await tick();

    await drive(() => transport.writes[1].resolve());
    await tick();
    const failure = new Error("older save failed");
    await drive(() => transport.writes[0].reject(failure));
    await tick();

    // The caller of the superseded write still learns it failed...
    expect(older.status).toBe("rejected");
    expect(older.reason).toBe(failure);
    expect(newer.status).toBe("resolved");
    // ...but the UI describes the write the person last asked for, which saved.
    expect(surface.error()).toBeNull();
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

  it("settles both an overlapped and an unmounted write in one run", async () => {
    const first = await start(() => surface.request("public"));
    await tick();
    const second = await start(() => surface.request("private"));
    await tick();

    unmount();
    await drive(() => transport.writes[0].resolve());
    await drive(() => transport.writes[1].resolve());
    await tick();

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
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
  const live = () => controller as ShareButtonController;
  function Harness() {
    controller = useShareButtonController({
      resourceType: "document",
      resourceId: "doc-1",
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
    confirm: () => live().visibilityTransition.confirm(),
    cancel: () => live().visibilityTransition.cancel(),
    value: () => live().visibility,
    error: () => live().shareError,
  };
}

function dialogSurface(env: Env): Surface {
  let controller: ShareDialogController | undefined;
  let setOpen!: (open: boolean) => void;
  const live = () => controller as ShareDialogController;
  function Harness() {
    const [open, updateOpen] = useState(true);
    setOpen = updateOpen;
    controller = useShareDialogController({
      open,
      onClose: () => undefined,
      resourceType: "document",
      resourceId: "doc-1",
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
    confirm: () => live().visibility.transition.confirm(),
    cancel: () => live().visibility.transition.cancel(),
    value: () => live().visibility.value,
    error: () => live().error,
  };
}
