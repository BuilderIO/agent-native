// oracle-change: failure diagnostics moved from message to ActionError.cause.
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import { resetActionGetBatchForTests } from "./action-get-batch.js";
import { recordSessionIdentity } from "./session-identity.js";
import {
  callAction,
  defaultActionQueryRetry,
  forgetUiActionCapability,
  useActionQuery,
} from "./use-action.js";

const MINT = "/_agent-native/ui-capability";
const BATCH = "/_agent-native/actions/get-actions-batch";
const roots: Root[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(names: string[], uiOnly = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Probe({ name }: { name: string }) {
    useActionQuery(name, undefined, { uiOnly, retry: false });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {names.map((name) => (
          <Probe key={name} name={name} />
        ))}
      </QueryClientProvider>,
    ),
  );
  return { client, root };
}
const state = (client: QueryClient, name: string) =>
  client.getQueryState(["action", name, undefined]);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  recordSessionIdentity("synthetic-user-a");
  forgetUiActionCapability();
});
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  recordSessionIdentity(undefined);
  forgetUiActionCapability();
  resetActionFailureCircuits();
  resetActionGetBatchForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("waits for a capability before sending the first synthetic uiOnly GET", async () => {
  const mint = deferred();
  let minted = false;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === MINT) {
      const response = await mint.promise;
      minted = response.ok;
      return response;
    }
    return minted
      ? json({ ok: true })
      : json({ error: "missing capability" }, 403);
  });
  vi.stubGlobal("fetch", fetchMock);
  const { client } = await mount(["synthetic-ui-read"]);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
  await act(async () => {
    mint.resolve(json({ ok: true }));
  });
  await vi.waitFor(() =>
    expect(state(client, "synthetic-ui-read")?.status).toBe("success"),
  );
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    MINT,
    "/_agent-native/actions/synthetic-ui-read",
  ]);
  expect(state(client, "synthetic-ui-read")?.data).toEqual({ ok: true });
});

it.each(["failure", "abort", "user change"])(
  "does not send a uiOnly GET on mint %s",
  async (outcome) => {
    const mint = deferred();
    const fetchMock = vi.fn((url: string) =>
      url === MINT ? mint.promise : Promise.resolve(json({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { client } = await mount(["synthetic-ui-read"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
    if (outcome === "abort")
      await act(() => client.cancelQueries({ queryKey: ["action"] }));
    if (outcome === "user change") recordSessionIdentity("synthetic-user-b");
    await act(async () => {
      mint.resolve(json({}, outcome === "failure" ? 401 : 200));
    });
    if (outcome !== "abort")
      await vi.waitFor(() =>
        expect(state(client, "synthetic-ui-read")?.status).toBe("error"),
      );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
  },
);

it("keeps ordinary GETs immediate and without a capability mint", async () => {
  const fetchMock = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  const { client } = await mount(["synthetic-ordinary-read"], false);
  await vi.waitFor(() =>
    expect(state(client, "synthetic-ordinary-read")?.status).toBe("success"),
  );
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/_agent-native/actions/synthetic-ordinary-read",
  ]);
});

it("uses the minted browser evidence for simultaneous batched refetches", async () => {
  let minted = false;
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === MINT) {
        minted = true;
        return json({ ok: true });
      }
      if (!minted) return json({ error: "missing capability" }, 403);
      if (url === BATCH) {
        const requests = JSON.parse(String(init?.body)).requests;
        return json({
          results: requests.map(() => ({ status: 200, body: { ok: true } })),
        });
      }
      return json({ ok: true });
    }),
  );
  const names = ["synthetic-ui-a", "synthetic-ui-b"];
  const { client } = await mount(names);
  await vi.waitFor(() =>
    expect(names.map((name) => state(client, name)?.status)).toEqual([
      "success",
      "success",
    ]),
  );
  calls.length = 0;
  await act(() => client.invalidateQueries({ queryKey: ["action"] }));
  expect(calls.map((call) => call.url)).toEqual([BATCH]);
  expect(calls[0].init?.method).toBe("POST");
  expect(
    new Headers(calls[0].init?.headers).get("x-agent-native-frontend"),
  ).toBe("1");
  expect(names.map((name) => state(client, name)?.status)).toEqual([
    "success",
    "success",
  ]);
});

it("holds another identity's read while a mint is pending, then mints for it", async () => {
  const mintA = deferred();
  const mintB = deferred();
  let mintCount = 0;
  const fetchMock = vi.fn((url: string) => {
    if (url === MINT) return ++mintCount === 1 ? mintA.promise : mintB.promise;
    return Promise.resolve(json({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const first = await mount(["synthetic-user-a-read"]);
  recordSessionIdentity("synthetic-user-b");
  const second = await mount(["synthetic-user-b-read"]);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
  expect(state(second.client, "synthetic-user-b-read")?.status).toBe("pending");
  await act(async () => {
    mintA.resolve(json({ ok: true }));
  });
  await vi.waitFor(() =>
    expect(state(first.client, "synthetic-user-a-read")?.status).toBe("error"),
  );
  await vi.waitFor(() => expect(mintCount).toBe(2));
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, MINT]);
  await act(async () => {
    mintB.resolve(json({ ok: true }));
  });
  await vi.waitFor(() =>
    expect(state(second.client, "synthetic-user-b-read")?.status).toBe(
      "success",
    ),
  );
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    MINT,
    MINT,
    "/_agent-native/actions/synthetic-user-b-read",
  ]);
});

it.each([null, undefined])(
  "does not send a uiOnly GET when identity changes from %s during mint",
  async (identity) => {
    recordSessionIdentity(identity);
    const mint = deferred();
    const fetchMock = vi.fn((url: string) =>
      url === MINT ? mint.promise : Promise.resolve(json({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { client } = await mount(["synthetic-unknown-user-read"]);
    recordSessionIdentity("synthetic-user-b");
    await act(async () => {
      mint.resolve(json({ ok: true }));
    });
    await vi.waitFor(() =>
      expect(state(client, "synthetic-unknown-user-read")?.status).toBe(
        "error",
      ),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
  },
);

it("holds an ordinary write behind another identity's mint and sends it after its own", async () => {
  const mintA = deferred();
  let mintCount = 0;
  const fetchMock = vi.fn((url: string) => {
    if (url === MINT) {
      return ++mintCount === 1 ? mintA.promise : Promise.resolve(json({}));
    }
    return Promise.resolve(json({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const first = await mount(["synthetic-user-a-read"]);
  recordSessionIdentity("synthetic-user-b");
  const write = callAction("synthetic-write", {});
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
  await act(async () => {
    mintA.resolve(json({ ok: true }));
  });
  await expect(write).resolves.toEqual({ ok: true });
  await vi.waitFor(() =>
    expect(state(first.client, "synthetic-user-a-read")?.status).toBe("error"),
  );
  expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
    "/_agent-native/actions/synthetic-write",
  );
  expect(mintCount).toBe(2);
});

it("keeps one network retry available when capability mint transport fails", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetchMock);
  const error = await callAction(
    "synthetic-ui-read",
    {},
    { uiOnly: true },
  ).catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "network_error" });
  expect(defaultActionQueryRetry(0, error)).toBe(true);
  expect(defaultActionQueryRetry(1, error)).toBe(false);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
});
