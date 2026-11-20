// @vitest-environment happy-dom
import {
  dehydrate,
  hydrate,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import { SURFACE_HIDDEN_FLAG } from "../shared/surface-visibility.js";
import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import { resetActionGetBatchForTests } from "./action-get-batch.js";
import { invalidateForegroundActionQueries } from "./hooks/index.js";
import { recordSessionIdentity } from "./session-identity.js";
import {
  forgetUiActionCapability,
  useActionMutation,
  useActionQuery,
} from "./use-action.js";

const INTERACTIVE = "x-agent-native-interactive";
let root: Root;
let rootHost: HTMLDivElement;
let client: QueryClient;
let mutate: () => void;
const sent: Array<{ url: string; headers: Headers }> = [];
// A provider paused to foreground-only mode answers only reads that carry the
// interactive marker; every other read is refused.
const statuses: number[] = [];

function foregroundOnlyServer(body: unknown = { ok: true }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url, headers });
    if (!url.startsWith("/_agent-native/actions/")) return Response.json({});
    const status = headers.get(INTERACTIVE) === "1" ? 200 : 503;
    statuses.push(status);
    return Response.json(
      status === 200 ? body : { errorCode: "provider_paused" },
      { status },
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  recordSessionIdentity("viewer@example.test");
  forgetUiActionCapability();
  sent.length = 0;
  statuses.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, headers: new Headers(init?.headers) });
      return Response.json({ ok: true });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rootHost = document.createElement("div");
  root = createRoot(rootHost);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  recordSessionIdentity(undefined);
  forgetUiActionCapability();
  resetActionFailureCircuits();
  resetActionGetBatchForTests();
  delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(node: React.ReactNode) {
  return act(async () =>
    root.render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
  );
}

async function mountRange() {
  function Probe() {
    useActionQuery("synthetic-range", undefined, { interactive: true });
    const mutation = useActionMutation("synthetic-edit", { interactive: true });
    mutate = () => mutation.mutate({});
    return null;
  }
  await render(<Probe />);
  await vi.waitFor(() =>
    expect(
      client.getQueryState(["action", "synthetic-range", undefined])?.status,
    ).toBe("success"),
  );
}

const reads = (name: string) =>
  sent.filter(({ url }) =>
    new URL(url, "https://app.example.test").pathname.endsWith(`/${name}`),
  );

it("an opted-in explicit refetch of a foreground query is interactive; a background one is not", async () => {
  for (const interactive of [true, false]) {
    let refetch: () => Promise<unknown> = async () => undefined;
    function Probe() {
      const query = useActionQuery(
        "synthetic-retry",
        { interactive },
        { interactive, foregroundRefetch: true },
      );
      refetch = query.refetch;
      return null;
    }
    await render(<Probe />);
    await vi.waitFor(() =>
      expect(
        client.getQueryState(["action", "synthetic-retry", { interactive }])
          ?.status,
      ).toBe("success"),
    );
    sent.length = 0;
    await act(async () => {
      await refetch();
    });
    const retried = reads("synthetic-retry");
    expect(retried).toHaveLength(1);
    expect(retried[0]?.headers.get(INTERACTIVE)).toBe(interactive ? "1" : null);
  }
});

it("keeps one refetch identity across renders for an opted-in query", async () => {
  const seen = new Set<unknown>();
  let rerender: () => void = () => undefined;
  function Probe() {
    const [, setTick] = useState(0);
    rerender = () => setTick((tick) => tick + 1);
    const query = useActionQuery(
      "synthetic-retry",
      { stable: true },
      { interactive: true, foregroundRefetch: true },
    );
    seen.add(query.refetch);
    return null;
  }
  await render(<Probe />);
  await vi.waitFor(() =>
    expect(
      client.getQueryState(["action", "synthetic-retry", { stable: true }])
        ?.status,
    ).toBe("success"),
  );
  await act(async () => rerender());
  await act(async () => rerender());
  expect(seen.size).toBe(1);
});

it("an explicit refetch stays background unless the query opts in", async () => {
  let refetch: () => Promise<unknown> = async () => undefined;
  function Probe() {
    refetch = useActionQuery("synthetic-retry", undefined, {
      interactive: true,
    }).refetch;
    return null;
  }
  await render(<Probe />);
  await vi.waitFor(() => expect(reads("synthetic-retry")).toHaveLength(1));
  sent.length = 0;
  await act(async () => {
    await refetch();
  });
  expect(
    reads("synthetic-retry").map(({ headers }) => headers.get(INTERACTIVE)),
  ).toEqual([null]);
});

it("a foreground refetch recovers a read the paused provider refused", async () => {
  vi.stubGlobal("fetch", foregroundOnlyServer());
  client.setQueryData(["action", "synthetic-retry", undefined], { ok: false });
  let refetch: () => Promise<unknown> = async () => undefined;
  function Probe() {
    refetch = useActionQuery("synthetic-retry", undefined, {
      interactive: true,
      foregroundRefetch: true,
      staleTime: Infinity,
    }).refetch;
    return null;
  }
  await render(<Probe />);
  expect(statuses).toEqual([]);
  await act(async () => {
    await refetch();
  });
  expect(statuses).toEqual([200]);
});

it("a duplicate own-write invalidation keeps the pending foreground readback", async () => {
  await mountRange();
  const readbacks: Array<{
    signal: AbortSignal | null | undefined;
    headers: Headers;
    release: () => void;
  }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("synthetic-edit")) return Response.json({ ok: true });
      if (!url.endsWith("synthetic-range"))
        throw new Error(`Unexpected own-write request: ${url}`);
      return new Promise<Response>((resolve) => {
        readbacks.push({
          signal: init?.signal,
          headers: new Headers(init?.headers),
          release: () => resolve(Response.json({ ok: true })),
        });
      });
    }),
  );
  try {
    await act(async () => mutate());
    await vi.waitFor(() => expect(readbacks).toHaveLength(1));
    const dataOnlyKey = ["action", "synthetic-range", "data-only"];
    client.setQueryData(dataOnlyKey, { ok: true });
    let invalidation: Promise<void> | undefined;
    act(() => {
      invalidation = invalidateForegroundActionQueries(
        client,
        { queryKey: ["action", "synthetic-range"] },
        true,
        { cancelRefetch: false },
      );
    });
    expect(readbacks).toHaveLength(1);
    expect(readbacks[0]?.signal?.aborted).toBe(false);
    expect(readbacks[0]?.headers.get(INTERACTIVE)).toBe("1");
    expect(client.getQueryState(dataOnlyKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(dataOnlyKey)?.error).toBeNull();
    await act(async () => {
      readbacks[0]?.release();
      await invalidation;
    });
    expect(readbacks).toHaveLength(1);
  } finally {
    for (const readback of readbacks) readback.release();
  }
});

it("an inactive data-only cache waits for its reader before the foreground readback", async () => {
  const queryKey = ["action", "synthetic-range", undefined];
  const untouchedKey = ["action", "synthetic-range", "other"];
  client.setQueryData(queryKey, { ok: true });
  client.setQueryData(untouchedKey, { ok: true });
  await act(async () => {
    await invalidateForegroundActionQueries(
      client,
      {
        queryKey: ["action", "synthetic-range"],
        predicate: (candidate) => candidate.queryKey[2] === undefined,
        refetchType: "all",
      },
      true,
      { cancelRefetch: false },
    );
  });
  expect(sent).toHaveLength(0);
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKey)?.error).toBeNull();
  expect(client.getQueryState(untouchedKey)?.isInvalidated).toBe(false);
  await mountRange();
  expect(
    reads("synthetic-range").map(({ headers }) => headers.get(INTERACTIVE)),
  ).toEqual(["1"]);
});

async function mountCached(options: {
  initialData?: unknown;
  refetchInterval?: number;
  interactive?: boolean;
  staleTime?: number;
  refetchOnReconnect?: "always";
}) {
  function Probe() {
    useActionQuery("synthetic-list", undefined, {
      interactive: options.interactive ?? true,
      initialData: options.initialData,
      initialDataUpdatedAt: 0,
      refetchInterval: options.refetchInterval ?? false,
      staleTime: options.staleTime,
      refetchOnReconnect: options.refetchOnReconnect,
      retry: false,
    });
    return null;
  }
  await render(<Probe />);
}

it("admits a visible first read that holds only cached initialData", async () => {
  vi.stubGlobal("fetch", foregroundOnlyServer());
  await mountCached({ initialData: { rows: ["cached"] } });
  await vi.waitFor(() => expect(statuses).toEqual([200]));
  expect(
    reads("synthetic-list").map(({ headers }) => headers.get(INTERACTIVE)),
  ).toEqual(["1"]);
});

it("keeps the polling refetches of that query background", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", foregroundOnlyServer());
  await mountCached({ initialData: { rows: [] }, refetchInterval: 60_000 });
  await vi.advanceTimersByTimeAsync(1);
  expect(statuses).toEqual([200]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_100);
  });
  const polls = statuses.slice(1);
  expect(polls.length).toBeGreaterThan(0);
  expect(polls.every((status) => status === 503)).toBe(true);
});

it("keeps a background hook read that holds initialData background", async () => {
  vi.stubGlobal("fetch", foregroundOnlyServer());
  await mountCached({ initialData: { rows: [] }, interactive: false });
  await vi.waitFor(() => expect(statuses).toEqual([503]));
});

it("admits the first current-document read of a restored answered query", async () => {
  const previous = new QueryClient();
  previous.setQueryData(["action", "synthetic-list", undefined], {
    rows: ["restored"],
  });
  hydrate(client, dehydrate(previous));
  previous.clear();
  vi.stubGlobal("fetch", foregroundOnlyServer());
  await mountCached({});
  await vi.waitFor(() => expect(statuses).toEqual([200]));
});

it.each(["timer", "reconnect"] as const)(
  "keeps a fresh cached opening's first later %s read background",
  async (trigger) => {
    vi.useFakeTimers();
    client.setQueryData(["action", "synthetic-list", undefined], {
      rows: ["fresh"],
    });
    vi.stubGlobal("fetch", foregroundOnlyServer());
    try {
      await mountCached({
        staleTime: Infinity,
        ...(trigger === "timer"
          ? { refetchInterval: 60_000 }
          : { refetchOnReconnect: "always" as const }),
      });
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(statuses).toEqual([]);
      await act(async () => {
        if (trigger === "reconnect") {
          onlineManager.setOnline(false);
          onlineManager.setOnline(true);
        }
        await vi.advanceTimersByTimeAsync(trigger === "timer" ? 60_100 : 100);
      });
      expect(statuses).toEqual([503]);
    } finally {
      onlineManager.setOnline(true);
    }
  },
);

it("admits an opening read deferred until cached content has painted", async () => {
  client.setQueryData(["action", "synthetic-list", undefined], {
    rows: ["cached-day"],
  });
  vi.stubGlobal("fetch", foregroundOnlyServer({ rows: ["fresh-day"] }));
  let enable: (() => void) | undefined;
  function Probe() {
    const [enabled, setEnabled] = React.useState(false);
    enable = () => setEnabled(true);
    const query = useActionQuery<{ rows: string[] }>(
      "synthetic-list",
      undefined,
      { enabled, interactive: true, retry: false },
    );
    return <div>{query.data?.rows.join(",")}</div>;
  }
  await render(<Probe />);
  expect(rootHost.textContent).toBe("cached-day");
  expect(statuses).toEqual([]);
  await act(async () => enable?.());
  await vi.waitFor(() => expect(rootHost.textContent).toBe("fresh-day"));
  expect(statuses).toEqual([200]);
});
