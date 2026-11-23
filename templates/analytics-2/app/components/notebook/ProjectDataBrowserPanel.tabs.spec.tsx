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

const sales = {
  id: "schema:p:sales",
  name: "sales",
  kind: "schema",
  hasChildren: true,
};
const orders = {
  id: "table:p:sales:orders",
  name: "orders",
  kind: "table",
  hasChildren: false,
};

function mount(): HTMLElement {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const params = Object.fromEntries(
        new URL(String(input), "http://localhost").searchParams,
      );
      requests.push(params);
      const page = (items: unknown[]) => ({
        items,
        endCursor: null,
        hasNextPage: false,
      });
      if (params.parentId === sales.id) return Response.json(page([orders]));
      return Response.json(
        page(!params.search || "sales".includes(params.search) ? [sales] : []),
      );
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
          semanticModels={[
            {
              id: "model:revenue",
              name: "Revenue model",
              fields: [{ name: "revenue", kind: "measure" }],
            },
          ]}
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

const button = (host: HTMLElement, text: string) => {
  const found = [...host.querySelectorAll<HTMLElement>("button")].find((el) =>
    el.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};

function type(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]');
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

it("report QA-1795064308.979369: a semantic-model search does not collapse or filter the warehouse folder tree", async () => {
  const host = mount();
  await until(() => expect(host.textContent).toContain("sales"));
  act(() => button(host, "sales").click());
  await until(() => expect(host.textContent).toContain("orders"));

  const tab = (name: string) =>
    [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (el) => el.textContent === name,
    ) as HTMLElement;
  act(() => tab("Semantic models").click());
  vi.useFakeTimers();
  type(host, "zzz");
  act(() => {
    vi.advanceTimersByTime(500);
  });
  vi.useRealTimers();
  act(() => tab("Warehouse").click());
  await until(() => expect(host.textContent).toContain("orders"));

  expect(
    host.querySelector<HTMLInputElement>('input[type="search"]')?.value,
  ).toBe("");
  expect(requests.some((request) => request.search === "zzz")).toBe(false);
});
