// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18next from "i18next";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next, I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import { ActionQueryBoundary } from "./action-query-boundary.js";
import {
  ActionError,
  callAction,
  useActionMutation,
  useActionQuery,
} from "./use-action.js";

const roots: ReturnType<typeof createRoot>[] = [];
let container: HTMLDivElement;
async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
}
async function settle(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
}

const catalog = {
  actionErrors: {
    failed: "Please try again.",
    loadFailed: "Unable to load records.",
    retry: "Try again",
    codes: { quota_exceeded: "Your storage is full." },
  },
};
beforeEach(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en-US",
    resources: { "en-US": { translation: catalog } },
    initAsync: false,
  });
});
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
  resetActionFailureCircuits();
  vi.unstubAllGlobals();
});

it("returns catalog copy and typed metadata while keeping diagnostics out of message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Action create-secret-record failed: diagnostic",
          errorCode: "quota_exceeded",
        }),
        {
          status: 422,
          headers: {
            "Retry-After": "2",
            "x-agent-native-request-id": "request-1",
          },
        },
      ),
    ),
  );
  const error = await callAction("create-secret-record").catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ActionError);
  expect(error).toMatchObject({
    message: "Your storage is full.",
    userMessage: "Your storage is full.",
    code: "quota_exceeded",
    status: 422,
    retryAfterMs: 2000,
    requestId: "request-1",
  });
  expect(error).toHaveProperty(
    "cause",
    expect.objectContaining({ message: expect.stringContaining("diagnostic") }),
  );
});

it("surfaces catalog text from mutation errors, including network failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("transport secret")),
  );
  function Form() {
    const mutation = useActionMutation("save-record", { onError: () => {} });
    return (
      <>
        <button onClick={() => mutation.mutate({})}>Save</button>
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
      </>
    );
  }
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <Form />
    </QueryClientProvider>,
  );
  await act(async () => container.querySelector("button")?.click());
  await settle(() =>
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Please try again.",
    ),
  );
  expect(container.textContent).not.toMatch(
    /transport secret|Action save-record/,
  );
});

it("renders a failed read separately from empty and retries into successful empty data", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
    .mockImplementation(() =>
      Promise.resolve(new Response("[]", { status: 200 })),
    );
  vi.stubGlobal("fetch", fetch);
  function List() {
    const query = useActionQuery<string[]>("list-records", undefined, {
      retry: false,
    });
    return (
      <ActionQueryBoundary query={query}>
        {(rows) => (rows.length ? rows.join(",") : <p>No records</p>)}
      </ActionQueryBoundary>
    );
  }
  await render(
    <I18nextProvider i18n={i18next}>
      <QueryClientProvider client={new QueryClient()}>
        <List />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await settle(() =>
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Unable to load records.",
    ),
  );
  expect(container.textContent).not.toContain("No records");
  await act(async () => container.querySelector("button")?.click());
  await settle(() => expect(container.textContent).toBe("No records"));
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("replaces a previously empty result with an error when its refresh fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 500 })),
  );
  function List() {
    const query = useActionQuery<string[]>("list-records-refresh", undefined, {
      retry: false,
    });
    return (
      <>
        <button
          onClick={() => {
            void query.refetch();
          }}
        >
          Refresh
        </button>
        <ActionQueryBoundary query={query}>
          {(rows) => (rows.length ? rows.join(",") : <p>No records</p>)}
        </ActionQueryBoundary>
      </>
    );
  }
  await render(
    <I18nextProvider i18n={i18next}>
      <QueryClientProvider client={new QueryClient()}>
        <List />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await settle(() => expect(container.textContent).toContain("No records"));
  await act(async () => container.querySelector("button")?.click());
  await settle(() =>
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Unable to load records.",
    ),
  );
  expect(container.textContent).not.toContain("No records");
});
