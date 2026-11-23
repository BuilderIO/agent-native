// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requests: Array<Record<string, string>> = [];
let cleanup = () => {};
afterEach(() => {
  cleanup();
  requests.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const row = (name: string) => ({
  id: `schema:p:${name}`,
  name,
  kind: "schema",
  hasChildren: true,
});

function mount(
  answer: (params: Record<string, string>) => unknown,
): HTMLElement {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const params = Object.fromEntries(
        new URL(String(input), "http://localhost").searchParams,
      );
      requests.push(params);
      return Response.json(answer(params));
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectDataBrowserPanel
          connections={[{ id: "one", name: "One" }]}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    client.clear();
    host.remove();
  };
  return document.body;
}

async function until(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 4000, interval: 50 },
  );
}

function type(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Search tables"]',
  );
  if (!input) throw new Error("Missing search input");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("report QA-1795064308.979369: empty advancing pages show datasets without a click", async () => {
  const host = mount((params) =>
    params.after === "second"
      ? { items: [row("visible")], endCursor: null, hasNextPage: false }
      : {
          items: [],
          endCursor: params.after ? "second" : "first",
          hasNextPage: true,
        },
  );
  await until(() => expect(host.textContent).toContain("visible"));
  expect(requests.map((request) => request.after)).toEqual([
    undefined,
    "first",
    "second",
  ]);
  expect(host.textContent).not.toContain("No datasets here.");
  expect(host.textContent).not.toContain("Load more");
});

it("report QA-1795064725.728079: search advances empty pages without a click", async () => {
  const host = mount((params) =>
    params.search === "america"
      ? params.after
        ? { items: [row("america_sales")], endCursor: null, hasNextPage: false }
        : { items: [], endCursor: "next", hasNextPage: true }
      : { items: [row("alpha")], endCursor: null, hasNextPage: false },
  );
  await until(() => expect(host.textContent).toContain("alpha"));
  for (const text of ["a", "am", "ame", "amer", "americ", "america"])
    type(host, text);
  await until(() => expect(host.textContent).toContain("america_sales"));
  expect(requests.map(({ search, after }) => [search, after])).toEqual([
    [undefined, undefined],
    ["america", undefined],
    ["america", "next"],
  ]);
  expect(host.textContent).not.toContain("Load more");
});

it("keeps manual pagination once items are visible", async () => {
  const host = mount((params) =>
    params.after
      ? { items: [row("second")], endCursor: null, hasNextPage: false }
      : { items: [row("first")], endCursor: "next", hasNextPage: true },
  );
  await until(() => expect(host.textContent).toContain("Load more"));
  expect(requests).toHaveLength(1);
  const button = [...host.querySelectorAll("button")].find(
    (el) => el.textContent === "Load more",
  );
  if (!button) throw new Error("Missing Load more button");
  act(() => button.click());
  await until(() => expect(host.textContent).toContain("second"));
  expect(host.textContent).toContain("first");
  expect(requests.map((request) => request.after)).toEqual([undefined, "next"]);
});

it.each([
  ["null", [null]],
  ["stuck", ["first", "first"]],
  ["repeated", ["first", "second", "first"]],
])(
  "reports a %s continuation without endless requests",
  async (_name, cursors) => {
    const host = mount(() => ({
      items: [],
      endCursor: cursors[requests.length - 1],
      hasNextPage: true,
    }));
    await until(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Datasets could not be loaded.",
      ),
    );
    expect(requests).toHaveLength(cursors.length);
    expect(host.textContent).not.toContain("Load more");
  },
);

it("report 1795064725.728079: a search with no match anywhere says so", async () => {
  const host = mount((params) =>
    params.search
      ? { items: [], endCursor: null, hasNextPage: false }
      : { items: [row("alpha")], endCursor: null, hasNextPage: false },
  );
  await until(() => expect(host.textContent).toContain("alpha"));
  type(host, "zzz");
  await until(() => expect(host.textContent).toContain("No datasets here."));
});

it("report QA-1795064308 auto-loads first page", async () => {
  const host = mount((params) =>
    params.after
      ? { items: [row("later")], endCursor: null, hasNextPage: false }
      : { items: [row("first_page")], endCursor: "next", hasNextPage: true },
  );
  await until(() => expect(host.textContent).toContain("first_page"));
  expect(requests).toHaveLength(1);
  expect(requests[0]?.after).toBeUndefined();
});

it("report QA-1795064725 search without load more", async () => {
  const host = mount((params) =>
    params.search === "sales"
      ? { items: [row("sales_eu")], endCursor: "more", hasNextPage: true }
      : { items: [row("alpha")], endCursor: null, hasNextPage: false },
  );
  await until(() => expect(host.textContent).toContain("alpha"));
  type(host, "sales");
  await until(() => expect(host.textContent).toContain("sales_eu"));
  expect(requests.at(-1)).toMatchObject({ search: "sales" });
  expect(requests.at(-1)?.after).toBeUndefined();
});

it("offers Retry after a failed dataset request and loads the datasets on retry", async () => {
  let failing = true;
  const host = mount(() => {
    if (failing) throw new Error("upstream unavailable");
    return { items: [row("recovered")], endCursor: null, hasNextPage: false };
  });
  await until(() =>
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Datasets could not be loaded.",
    ),
  );
  failing = false;
  const retry = [...host.querySelectorAll("button")].find(
    (el) => el.textContent === "Retry",
  );
  if (!retry) throw new Error("Missing Retry button");
  act(() => retry.click());
  await until(() => expect(host.textContent).toContain("recovered"));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
