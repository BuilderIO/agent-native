// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

async function mount(
  semanticModels?: React.ComponentProps<
    typeof ProjectDataBrowserPanel
  >["semanticModels"],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ items: [], endCursor: null, hasNextPage: false }),
    ),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectDataBrowserPanel
          connections={[{ id: "sample", name: "Sample" }]}
          semanticModels={semanticModels}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  return () => {
    act(() => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  };
}

const tab = (name: string) =>
  [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent === name,
  );

it("report QA-1795063839 semantic models: lists models beside tables and shows the selected model schema", async () => {
  const cleanup = await mount([
    {
      id: "model:orders",
      name: "Orders model",
      description: "One row per order",
      fields: [
        { name: "order_date", kind: "dimension", type: "date" },
        { name: "revenue", kind: "measure", type: "number" },
      ],
    },
  ]);
  try {
    expect(tab("Warehouse")).toBeDefined();
    const models = tab("Semantic models");
    expect(models).toBeDefined();
    await act(async () => models?.click());
    const item = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Orders model"),
    );
    expect(item).toBeDefined();
    await act(async () => item?.click());
    const detail = document.body.querySelector(".nb-data-browser-detail");
    expect(detail?.textContent).toContain("One row per order");
    expect(detail?.textContent).toContain("order_date");
    expect(detail?.textContent).toContain("revenue");
    expect(detail?.textContent).toContain("Measures");
    expect(detail?.textContent).toContain("Dimensions");
  } finally {
    cleanup();
  }
});

it("report QA-1795063839 semantic models: shows an empty state when no models are available", async () => {
  const cleanup = await mount();
  try {
    await act(async () => tab("Semantic models")?.click());
    expect(document.body.textContent).toContain(
      "No data models are available.",
    );
    expect(document.body.textContent).toContain(
      "Select a model to view details",
    );
  } finally {
    cleanup();
  }
});
