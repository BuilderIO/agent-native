// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import {
  SURFACE_HIDDEN_FLAG,
  SURFACE_VISIBILITY_EVENT,
} from "../shared/surface-visibility.js";
import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import { recordSessionIdentity } from "./session-identity.js";
import {
  forgetUiActionCapability,
  useActionMutation,
  useActionQuery,
} from "./use-action.js";

let visibility: DocumentVisibilityState;
const roots: Root[] = [];
const clients: QueryClient[] = [];
const sent: Array<{ name: string; headers: Headers }> = [];
let mutate: () => void;
let refetch: () => Promise<unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  recordSessionIdentity("viewer@example.test");
  forgetUiActionCapability();
  sent.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({
        name:
          new URL(url, "https://app.example.test").pathname.split("/").pop() ??
          "",
        headers: new Headers(init?.headers),
      });
      return Response.json({ ok: true });
    }),
  );
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const client of clients) client.clear();
  roots.length = 0;
  clients.length = 0;
  recordSessionIdentity(undefined);
  forgetUiActionCapability();
  resetActionFailureCircuits();
  delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function requests(name: string) {
  return sent.filter((request) => request.name === name);
}
async function mount(
  name = "synthetic-read",
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  beforeSend?: () => Promise<void>,
  enabled = true,
  interactive = true,
  refetchIntervalInBackground?: boolean,
) {
  if (!clients.includes(client)) clients.push(client);
  function Probe() {
    const query = useActionQuery(
      name,
      {},
      {
        interactive,
        refetchInterval: 60_000,
        refetchIntervalInBackground,
        refetchOnWindowFocus: true,
        batchRefetches: false,
        retry: false,
        beforeSend,
        enabled,
      },
    );
    refetch = query.refetch;
    const mutation = useActionMutation("synthetic-edit", { interactive: true });
    mutate = () => mutation.mutate({});
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await advance(1);
  return client;
}
async function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(1);
}

it("keeps the first visible read interactive and sends each settled interval without the header", async () => {
  await mount();
  await advance(180_100);
  expect(
    requests("synthetic-read").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual(["1", null, null, null]);
});

it("never treats a timer invalidation as a user action", async () => {
  const client = await mount();
  setTimeout(() => {
    void client.invalidateQueries({ queryKey: ["action"] });
  }, 1_000);
  await advance(1_100);
  expect(
    requests("synthetic-read").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual(["1", null]);
});

it("keeps an interactive edit and its readback interactive", async () => {
  await mount();
  await act(async () => {
    mutate();
  });
  await advance(1);
  expect(
    requests("synthetic-edit").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual(["1"]);
  expect(
    requests("synthetic-read").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual(["1", "1"]);
});

it("does not request or mint UI proof for an initially hidden surface", async () => {
  visibility = "hidden";
  const client = await mount();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["action"] });
  });
  await advance(180_100);
  expect(sent).toEqual([]);
});

it("keeps a hidden surface silent through intervals, invalidation, and manual refetch", async () => {
  const client = await mount();
  await setVisibility("hidden");
  const before = sent.length;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["action"] });
    await client.refetchQueries({ queryKey: ["action"] });
  });
  await advance(180_100);
  expect(sent).toHaveLength(before);
});

it("allows exactly one marked return refresh across queries and clients, deduping a following focus", async () => {
  await mount("synthetic-one");
  await mount("synthetic-two");
  await setVisibility("hidden");
  const before = sent.length;
  await setVisibility("visible");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(1_100);
  const returned = sent.slice(before);
  expect(returned.map(({ name }) => name).sort()).toEqual([
    "synthetic-one",
    "synthetic-two",
  ]);
  expect(
    returned.filter(
      ({ headers }) => headers.get("X-Agent-Native-Interactive") === "1",
    ),
  ).toHaveLength(1);
  await advance(60_000);
  expect(
    sent
      .slice(before + returned.length)
      .every(({ headers }) => !headers.has("X-Agent-Native-Interactive")),
  ).toBe(true);
});

it("gives a host-hidden surface one return allowance, even when document visibility never changed", async () => {
  await mount("synthetic-one");
  await mount("synthetic-two");
  (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = true;
  await act(async () => {
    window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
  });
  const before = sent.length;
  await advance(180_100);
  expect(sent).toHaveLength(before);
  (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = false;
  await act(async () => {
    window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
    window.dispatchEvent(new Event("focus"));
  });
  await advance(1_100);
  const returned = sent.slice(before);
  expect(returned).toHaveLength(2);
  expect(
    returned.filter(
      ({ headers }) => headers.get("X-Agent-Native-Interactive") === "1",
    ),
  ).toHaveLength(1);
});

it("polls a shared query once per interval with observers mounted 700 ms apart", async () => {
  const client = await mount();
  await advance(700);
  await mount("synthetic-read", client);
  const before = requests("synthetic-read").length;
  await advance(180_100);
  expect(requests("synthetic-read")).toHaveLength(before + 3);
  expect(
    requests("synthetic-read")
      .slice(before)
      .every(({ headers }) => !headers.has("X-Agent-Native-Interactive")),
  ).toBe(true);
});

it("does not send a visible read whose pre-send gate finishes after the surface hides", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mount("synthetic-gated", undefined, () => gate);
  await setVisibility("hidden");
  release();
  await advance(1_100);
  expect(requests("synthetic-gated")).toHaveLength(0);
  expect(sent.map(({ name }) => name)).toEqual(["ui-capability"]);
});

it("does not give a disabled query's first timer-driven refetch an initial-load allowance", async () => {
  await mount("synthetic-disabled", undefined, undefined, false);
  setTimeout(() => {
    void refetch();
  }, 1_000);
  await advance(1_100);
  expect(
    requests("synthetic-disabled").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual([null]);
});

it.each(["document", "host"] as const)(
  "keeps an initially %s-hidden background observer completely silent",
  async (kind) => {
    if (kind === "document") visibility = "hidden";
    else
      (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] =
        true;
    await mount("synthetic-background", undefined, undefined, true, false);
    await advance(180_100);
    expect(sent).toEqual([]);
  },
);

it("keeps a host-hidden background observer silent through timers and invalidations, then resumes", async () => {
  const client = await mount(
    "synthetic-background",
    undefined,
    undefined,
    true,
    false,
  );
  (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = true;
  await act(async () => {
    window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
  });
  const before = sent.length;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["action"] });
  });
  await advance(180_100);
  expect(sent).toHaveLength(before);
  (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = false;
  await act(async () => {
    window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
  });
  await advance(1_100);
  expect(requests("synthetic-background")).toHaveLength(2);
  expect(
    requests("synthetic-background").every(
      ({ headers }) => !headers.has("X-Agent-Native-Interactive"),
    ),
  ).toBe(true);
  await advance(60_000);
  expect(requests("synthetic-background")).toHaveLength(3);
});

it.each(["document", "host"] as const)(
  "honors caller background polling while %s-hidden without interactive headers",
  async (kind) => {
    for (const background of [true, false, undefined]) {
      await mount(
        `synthetic-poll-${background}`,
        undefined,
        undefined,
        true,
        true,
        background,
      );
    }
    if (kind === "document") await setVisibility("hidden");
    else {
      (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] =
        true;
      await act(async () =>
        window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT)),
      );
      await advance(1);
    }
    const before = sent.length;
    await advance(180_100);
    expect(
      sent
        .slice(before)
        .map(({ name, headers }) => [
          name,
          headers.get("X-Agent-Native-Interactive"),
        ]),
    ).toEqual(Array.from({ length: 3 }, () => ["synthetic-poll-true", null]));
    for (const background of [false, undefined]) {
      expect(requests(`synthetic-poll-${background}`)).toHaveLength(1);
    }
  },
);

it("allows an opted-in hidden initial read and a polling send that crosses into hidden state", async () => {
  visibility = "hidden";
  await mount(
    "synthetic-hidden-opt-in",
    undefined,
    undefined,
    true,
    true,
    true,
  );
  await advance(60_100);
  expect(
    requests("synthetic-hidden-opt-in").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual([null, null]);
  await setVisibility("visible");
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sends = 0;
  await mount(
    "synthetic-crossing-opt-in",
    undefined,
    () => (++sends === 1 ? Promise.resolve() : gate),
    true,
    true,
    true,
  );
  await advance(60_000);
  await setVisibility("hidden");
  release();
  await advance(1_100);
  expect(
    requests("synthetic-crossing-opt-in").map(({ headers }) =>
      headers.get("X-Agent-Native-Interactive"),
    ),
  ).toEqual(["1", null]);
});

it("refreshes exactly the live Query after removal and same-hash remount", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const key = ["action", "synthetic-replaced", {}];
  function Probe({ revision }: { revision: number }) {
    useActionQuery(
      "synthetic-replaced",
      {},
      {
        interactive: true,
        refetchOnWindowFocus: true,
        batchRefetches: false,
        retry: false,
      },
    );
    return <span>{revision}</span>;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  async function render(revision: number) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe revision={revision} />
        </QueryClientProvider>,
      ),
    );
    await advance(10);
  }
  await render(0);
  const removed = client.getQueryCache().find({ queryKey: key, exact: true });
  expect(removed).toBeDefined();
  await act(async () => client.removeQueries({ queryKey: key, exact: true }));
  await render(1);
  const live = client.getQueryCache().find({ queryKey: key, exact: true });
  expect(live).toBeDefined();
  expect(live).not.toBe(removed);
  const removedUpdated = removed?.state.dataUpdatedAt;
  const liveUpdated = live?.state.dataUpdatedAt;
  await setVisibility("hidden");
  const before = requests("synthetic-replaced").length;
  await setVisibility("visible");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(1_100);
  expect(
    requests("synthetic-replaced")
      .slice(before)
      .map(({ headers }) => headers.get("X-Agent-Native-Interactive")),
  ).toEqual(["1"]);
  expect(removed?.state.dataUpdatedAt).toBe(removedUpdated);
  expect(live?.state.dataUpdatedAt).toBeGreaterThan(liveUpdated ?? 0);
  expect(live?.state.fetchStatus).toBe("idle");
});
