// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
import { recordSessionIdentity } from "./session-identity.js";
import {
  callAction,
  callActionBlob,
  forgetUiActionCapability,
  useActionMutation,
  useActionQuery,
} from "./use-action.js";

const MINT = "/_agent-native/ui-capability";
const ACTION = "/_agent-native/actions/save-private-record";
const roots: Root[] = [];
const clients: QueryClient[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function refusingFetch(status = 403) {
  const fetchMock = vi.fn(async (url: string) =>
    url === MINT
      ? json({ ok: true })
      : json(
          { errorCode: status === 403 ? "ui_capability_required" : "refused" },
          status,
        ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
async function mount(Probe: () => null, queryRetry: boolean | number = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: queryRetry },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return client;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  recordSessionIdentity("synthetic-private-user");
  forgetUiActionCapability();
});
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const client of clients) client.clear();
  roots.length = clients.length = 0;
  forgetUiActionCapability();
  recordSessionIdentity(undefined);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(["json", "blob"])(
  "does not resend a refused %s action when capability retry is disabled",
  async (kind) => {
    const fetchMock = refusingFetch();
    const call = kind === "json" ? callAction : callActionBlob;
    await expect(
      call(
        "save-private-record",
        { value: "synthetic-input" },
        { uiOnly: true, retryUiCapability: false },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, ACTION]);
  },
);

it("keeps the first capability proof mandatory when retry is disabled", async () => {
  const fetchMock = vi.fn(async () => json({ error: "refused" }, 403));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    callAction(
      "save-private-record",
      {},
      { uiOnly: true, retryUiCapability: false },
    ),
  ).rejects.toThrow("Could not establish the browser UI capability.");
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT]);
});

it.each([401, 403])(
  "does not resend an ordinary %i refusal",
  async (status) => {
    const fetchMock = refusingFetch(status);
    await expect(
      callAction(
        "save-private-record",
        {},
        { uiOnly: true, retryUiCapability: false },
      ),
    ).rejects.toMatchObject({ status });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, ACTION]);
  },
);

it("passes the no-resend option through a mutation even with React Query retry disabled", async () => {
  const fetchMock = refusingFetch();
  let mutation: ReturnType<typeof useActionMutation> | undefined;
  function Probe() {
    mutation = useActionMutation("save-private-record", {
      uiOnly: true,
      retryUiCapability: false,
      retry: false,
    });
    return null;
  }
  await mount(Probe);
  await act(async () => {
    await expect(
      mutation!.mutateAsync({ value: "synthetic-input" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, ACTION]);
});

it("passes the no-resend option through a protected query", async () => {
  const fetchMock = refusingFetch();
  function Probe() {
    useActionQuery("save-private-record", undefined, {
      uiOnly: true,
      retryUiCapability: false,
      retry: false,
    });
    return null;
  }
  const client = await mount(Probe);
  await vi.waitFor(() =>
    expect(
      client.getQueryState(["action", "save-private-record", undefined])
        ?.status,
    ).toBe("error"),
  );
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, ACTION]);
});

it("forgets a refused capability without resending and proves a later distinct action afresh", async () => {
  const laterAction = "/_agent-native/actions/read-own-session-health";
  const fetchMock = vi.fn(async (url: string) =>
    url === ACTION
      ? json({ errorCode: "ui_capability_required" }, 403)
      : json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    callAction(
      "save-private-record",
      {},
      { uiOnly: true, retryUiCapability: false },
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, ACTION]);
  await expect(
    callAction(
      "read-own-session-health",
      {},
      { uiOnly: true, retryUiCapability: false },
    ),
  ).resolves.toEqual({ ok: true });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    MINT,
    ACTION,
    MINT,
    laterAction,
  ]);
});

it("keeps a capability refusal terminal under the native query retry default", async () => {
  const fetchMock = refusingFetch();
  function Probe() {
    useActionQuery("save-private-record", undefined, {
      uiOnly: true,
      retryUiCapability: false,
    });
    return null;
  }
  const client = await mount(Probe, 3);
  await vi.waitFor(() =>
    expect(
      client.getQueryState(["action", "save-private-record", undefined])
        ?.status,
    ).toBe("error"),
  );
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MINT, ACTION]);
});
