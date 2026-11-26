// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18next from "i18next";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next, I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ActionError } from "./action-error.js";

vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
import { resetActionFailureCircuits } from "./action-failure-circuit.js";
import { ActionQueryBoundary } from "./action-query-boundary.js";
import {
  actionErrorMessage,
  callActionBlob,
  defaultActionQueryRetry,
  isNetworkLevelFailure,
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
      <ActionQueryBoundary query={{ ...query }}>
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

it("keeps loaded records visible with a failure notice when their refresh fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response('["Saved record"]', { status: 200 }))
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
  await settle(() => expect(container.textContent).toContain("Saved record"));
  await act(async () => container.querySelector("button")?.click());
  await settle(() =>
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Unable to load records.",
    ),
  );
  expect(container.textContent).toContain("Saved record");
});

it("localizes failures using each active provider when isolated app catalogs coexist", async () => {
  const english = i18next.createInstance();
  const french = i18next.createInstance();
  await english.use(initReactI18next).init({
    lng: "en",
    resources: {
      en: {
        translation: { actionErrors: { failed: "English app failure" } },
      },
    },
    initAsync: false,
  });
  await french.use(initReactI18next).init({
    lng: "fr",
    resources: {
      fr: {
        translation: { actionErrors: { failed: "Échec de l’application" } },
      },
    },
    initAsync: false,
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("failure", { status: 500 })),
      ),
  );
  function Form({ id }: { id: string }) {
    const mutation = useActionMutation(`save-${id}`, { onError: () => {} });
    return (
      <section data-app={id}>
        <button onClick={() => mutation.mutate({})}>Save</button>
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
      </section>
    );
  }
  await render(
    <>
      <I18nextProvider i18n={english}>
        <QueryClientProvider client={new QueryClient()}>
          <Form id="english" />
        </QueryClientProvider>
      </I18nextProvider>
      <I18nextProvider i18n={french}>
        <QueryClientProvider client={new QueryClient()}>
          <Form id="french" />
        </QueryClientProvider>
      </I18nextProvider>
    </>,
  );
  await act(async () => {
    for (const button of container.querySelectorAll("button")) button.click();
  });
  await settle(() => {
    expect(
      container.querySelector('[data-app="english"] [role="alert"]')
        ?.textContent,
    ).toBe("English app failure");
    expect(
      container.querySelector('[data-app="french"] [role="alert"]')
        ?.textContent,
    ).toBe("Échec de l’application");
  });
});

it("preserves the caller's catalog fallback for an unmapped refusal code", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Internal provider detail",
          errorCode: "unmapped_refusal",
        }),
        { status: 422 },
      ),
    ),
  );
  const error = await callAction("save-with-refusal").catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ActionError);
  expect(actionErrorMessage(error, "Check the form and save again.")).toBe(
    "Check the form and save again.",
  );
  expect(error).toHaveProperty("message", "Please try again.");
});

it("distinguishes actual transport rejection from a status-less invalid response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  const network = await callAction("save-record").catch(
    (error: unknown) => error,
  );
  expect(network).toHaveProperty(
    "cause.message",
    expect.stringContaining("Failed to fetch"),
  );
  expect(network).toMatchObject({ code: "network_error" });
  expect(isNetworkLevelFailure(network)).toBe(true);

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  const invalid = await callActionBlob("download-record").catch(
    (error: unknown) => error,
  );
  expect(invalid).toBeInstanceOf(ActionError);
  expect(invalid).toMatchObject({ code: "request_failed" });
  expect(isNetworkLevelFailure(invalid)).toBe(false);
  expect(defaultActionQueryRetry(0, invalid)).toBe(false);
});

it.each(["text", "blob"] as const)(
  "retries a failed %s stream while retaining response metadata",
  async (kind) => {
    const response = new Response("partial", {
      headers: { "x-agent-native-request-id": "stream-request" },
    });
    vi.spyOn(response, kind).mockRejectedValue(
      new TypeError("Stream interrupted"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const run = kind === "blob" ? callActionBlob : callAction;
    const error = await run("read-record").catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "network_error",
      status: 200,
      requestId: "stream-request",
    });
    expect(isNetworkLevelFailure(error)).toBe(true);
    expect(defaultActionQueryRetry(0, error)).toBe(true);
    expect(defaultActionQueryRetry(1, error)).toBe(false);
  },
);

it("preserves an HTTP refusal even when its response body cannot be read", async () => {
  const response = new Response("denied", { status: 403 });
  vi.spyOn(response, "text").mockRejectedValue(
    new TypeError("Stream interrupted"),
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const error = await callAction("read-record").catch(
    (error: unknown) => error,
  );
  expect(error).toMatchObject({ status: 403, code: "request_failed" });
  expect(isNetworkLevelFailure(error)).toBe(false);
  expect(defaultActionQueryRetry(0, error)).toBe(false);
});

it("keeps readState enumerable for app query wrappers and feature detection", async () => {
  function Probe() {
    const query = useActionQuery<string[]>(
      "read-spread-fixture",
      {},
      { enabled: false },
    );
    const copy = { ...query };
    return (
      <output
        data-own={String(Object.hasOwn(query, "readState"))}
        data-has={String("readState" in query)}
      >
        {copy.readState.status}
      </output>
    );
  }
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
  expect(container.querySelector("output")?.textContent).toBe("pending");
  expect(container.querySelector("output")?.getAttribute("data-own")).toBe(
    "true",
  );
  expect(container.querySelector("output")?.getAttribute("data-has")).toBe(
    "true",
  );
});
