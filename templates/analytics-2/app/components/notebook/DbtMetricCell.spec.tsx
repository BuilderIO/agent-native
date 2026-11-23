// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import { DbtMetricCell } from "./DbtMetricCell";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));

type Contents = Extract<Cell["contents"], { kind: "dbt-metric" }>;

const catalog = {
  connectionId: "conn-1",
  items: [
    {
      name: "revenue",
      description: "Total revenue",
      type: "SIMPLE",
      queryableGranularities: ["DAY", "MONTH", "YEAR"],
      dimensions: [
        {
          name: "metric_time",
          description: null,
          type: "TIME",
          queryableGranularities: ["DAY", "MONTH", "YEAR"],
        },
        {
          name: "region",
          description: null,
          type: "CATEGORICAL",
          queryableGranularities: [],
        },
        {
          name: "plan",
          description: null,
          type: "CATEGORICAL",
          queryableGranularities: [],
        },
      ],
    },
    {
      name: "orders",
      description: null,
      type: "SIMPLE",
      queryableGranularities: ["DAY", "MONTH"],
      dimensions: [
        {
          name: "metric_time",
          description: null,
          type: "TIME",
          queryableGranularities: ["DAY", "MONTH"],
        },
        {
          name: "region",
          description: null,
          type: "CATEGORICAL",
          queryableGranularities: [],
        },
      ],
    },
  ],
  pageNum: 1,
  pageSize: 100,
  totalItems: 2,
  totalPages: 1,
};

const queryResult = {
  connectionId: "conn-1",
  queryId: "q-1",
  status: "SUCCESSFUL",
  pageNum: 1,
  totalPages: 1,
  sql: "select date_trunc('month', ordered_at) as metric_time__month, region, sum(amount) as revenue from orders group by 1, 2",
  fields: [
    { name: "metric_time__month", type: "DATETIME" },
    { name: "region", type: "STRING" },
    { name: "revenue", type: "NUMBER" },
  ],
  rows: [
    { metric_time__month: "2026-01-01", region: "emea", revenue: 1200 },
    { metric_time__month: "2026-01-01", region: "amer", revenue: 3400 },
  ],
  hasMore: false,
};

const baseContents: Contents = {
  id: "cell-1",
  kind: "dbt-metric",
  order: "a",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  dataConnectionId: "conn-1",
  metrics: [],
  selectedTimegrain: null,
  selectedDimensions: [],
  useRichDisplay: true,
};

const connections = [{ id: "conn-1", name: "Warehouse", type: "bigquery" }];

let container: HTMLDivElement;
let root: Root | undefined;
let posted: unknown[];
let queryResponse: () => Response;
let listPage: ((pageNum: number) => unknown) | null = null;
let pendingRequests = 0;

function stubFetch() {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    pendingRequests += 1;
    try {
      return await answer(input, init);
    } finally {
      pendingRequests -= 1;
    }
  });
}

async function answer(input: string, init?: RequestInit) {
  {
    const url = new URL(input, window.location.href);
    const action = url.pathname.split("/").at(-1);
    if (action === "get-actions-batch")
      return new Response(action, { status: 404 });
    if (action === "list-dbt-semantic-metrics" && listPage)
      return Response.json(
        listPage(Number(url.searchParams.get("pageNum") ?? "1")),
      );
    if (action === "list-dbt-semantic-metrics") {
      const search = url.searchParams.get("search") ?? "";
      return Response.json({
        ...catalog,
        items: catalog.items.filter((metric) => metric.name.includes(search)),
      });
    }
    if (action === "query-dbt-semantic-metrics") {
      posted.push(JSON.parse(String(init?.body)));
      return queryResponse();
    }
    throw new Error(`Unexpected action: ${String(action)}`);
  }
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
  await vi.waitFor(() => {
    expect(pendingRequests).toBe(0);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function Harness({
  initial = baseContents,
  canEdit = true,
  onSave,
  holdSave,
  onDuplicateAsSql,
}: {
  initial?: Contents;
  canEdit?: boolean;
  onSave?: (next: Contents) => void;
  holdSave?: () => Promise<unknown>;
  onDuplicateAsSql?: (sql: string, connectionId: string) => void;
}) {
  const [contents, setContents] = useState(initial);
  return (
    <DbtMetricCell
      cell={{
        id: contents.id,
        projectId: "project",
        versionId: "version",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        contents,
      }}
      contents={contents}
      canEdit={canEdit}
      connections={connections}
      onSaveContents={(next) => {
        const saved = next as Contents;
        onSave?.(saved);
        if (holdSave) return holdSave();
        setContents(saved);
      }}
      onDuplicateAsSql={onDuplicateAsSql}
    />
  );
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <Harness {...props} />
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function byText<T extends Element>(selector: string, text: string): T {
  const found = [...container.querySelectorAll<T>(selector)].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`No ${selector} with text "${text}"`);
  return found;
}

function checkbox(name: string): HTMLInputElement {
  const label = byText<HTMLLabelElement>("label", name);
  const input = label.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!input) throw new Error(`No checkbox in label "${name}"`);
  return input;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await settle();
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  posted = [];
  listPage = null;
  queryResponse = () => Response.json(queryResult);
  stubFetch();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe("DbtMetricCell", () => {
  it("lists the connection's Semantic Layer metrics and saves the choice", async () => {
    const onSave = vi.fn();
    await render({ onSave });
    expect(container.textContent).toContain("revenue");
    expect(container.textContent).toContain("orders");
    expect(container.textContent).toContain("Total revenue");

    await click(checkbox("revenue"));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ metrics: ["revenue"] }),
    );
    expect(checkbox("revenue").checked).toBe(true);
  });

  it("offers only the dimensions and time grains every chosen metric supports", async () => {
    await render();
    await click(checkbox("revenue"));
    expect(container.textContent).toContain("plan");

    await click(checkbox("orders"));
    expect(container.textContent).not.toContain("plan");
    const grain = container.querySelector<HTMLSelectElement>(
      "select[aria-label='Time grain']",
    );
    expect([...(grain?.options ?? [])].map((option) => option.value)).toEqual([
      "",
      "DAY",
      "MONTH",
    ]);
  });

  it("keeps a chosen metric and its dimensions while a search hides it from the list", async () => {
    await render();
    await click(checkbox("revenue"));
    await click(checkbox("region"));

    const search = container.querySelector<HTMLInputElement>(
      "input[aria-label='Search metrics']",
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "orders");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(container.textContent).not.toContain("Total revenue"),
    );
    expect(checkbox("region").checked).toBe(true);

    await click(byText("button", "Run"));
    expect(posted).toEqual([
      expect.objectContaining({
        metrics: [{ name: "revenue" }],
        groupBy: [{ name: "region" }],
      }),
    ]);
  });

  it("runs the metric query with the chosen grain and dimensions, then shows rows and SQL", async () => {
    await render();
    await click(checkbox("revenue"));
    await click(checkbox("region"));
    await choose(
      container.querySelector<HTMLSelectElement>(
        "select[aria-label='Time grain']",
      )!,
      "MONTH",
    );

    await click(byText("button", "Run"));

    expect(posted).toEqual([
      {
        connectionId: "conn-1",
        metrics: [{ name: "revenue" }],
        groupBy: [{ name: "metric_time", grain: "MONTH" }, { name: "region" }],
        limit: 1000,
      },
    ]);
    expect(container.textContent).toContain("emea");
    expect(container.textContent).toContain("3400");
    expect(container.textContent).toContain("sum(amount) as revenue");
  });

  it("duplicates the generated SQL into a SQL cell on the same connection", async () => {
    const onDuplicateAsSql = vi.fn();
    await render({ onDuplicateAsSql });
    await click(checkbox("revenue"));
    expect(byText<HTMLButtonElement>("button", "Run").disabled).toBe(false);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Duplicate as SQL",
      ),
    ).toBe(false);

    await click(byText("button", "Run"));
    await click(byText("button", "Duplicate as SQL"));

    expect(onDuplicateAsSql).toHaveBeenCalledWith(queryResult.sql, "conn-1");
  });

  it("explains why a query cannot run when the connection has no Semantic Layer", async () => {
    queryResponse = () =>
      Response.json(
        {
          error: "Enable dbt 1.6+ on the selected connection first.",
          errorCode: "dbt_semantic_configuration_invalid",
        },
        { status: 409 },
      );
    await render();
    await click(checkbox("revenue"));
    await click(byText("button", "Run"));
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Turn on dbt 1.6+ for this connection to query its Semantic Layer.",
    );
  });

  it("explains a connection that cannot serve metrics instead of a generic failure", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      const action = new URL(input, window.location.href).pathname
        .split("/")
        .at(-1);
      if (action === "get-actions-batch")
        return new Response(action, { status: 404 });
      return Response.json(
        {
          error: "Data connection not found.",
          errorCode: "data_connection_not_found",
        },
        { status: 404 },
      );
    });
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "This connection can’t be used for dbt metrics. Choose a connection with dbt 1.6+ turned on.",
    );
  });

  it("drops the result and its SQL once the selection no longer matches the run", async () => {
    await render();
    await click(checkbox("revenue"));
    await click(byText("button", "Run"));
    expect(container.textContent).toContain("emea");

    await click(checkbox("orders"));

    expect(container.textContent).not.toContain("emea");
    expect(container.textContent).not.toContain("Duplicate as SQL");
  });

  it("drops a failed run's error once the selection changes", async () => {
    queryResponse = () =>
      Response.json(
        { error: "Nope.", errorCode: "dbt_semantic_query_failed" },
        { status: 502 },
      );
    await render();
    await click(checkbox("revenue"));
    await click(byText("button", "Run"));
    expect(container.querySelector("[role=alert]")).not.toBeNull();

    await click(checkbox("orders"));
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("keeps the saved grain and dimensions when a chosen metric is not in the listed page", async () => {
    await render({
      initial: {
        ...baseContents,
        metrics: ["hidden_metric"],
        selectedTimegrain: "MONTH",
        selectedDimensions: ["region"],
      },
    });
    await click(byText("button", "Run"));
    expect(posted).toEqual([
      expect.objectContaining({
        metrics: [{ name: "hidden_metric" }],
        groupBy: [{ name: "metric_time", grain: "MONTH" }, { name: "region" }],
      }),
    ]);
  });

  it("keeps a saved connection that is no longer listed selected instead of showing the placeholder", async () => {
    await render({
      initial: { ...baseContents, dataConnectionId: "removed-1" },
    });
    const select = container.querySelector<HTMLSelectElement>(
      "select[aria-label='Connection']",
    )!;
    expect(select.value).toBe("removed-1");
  });

  it("shows a choice at once while it saves, then rolls it back if the save fails", async () => {
    let fail: (error: Error) => void = () => {};
    await render({
      holdSave: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    const input = checkbox("revenue");
    await act(async () => {
      input.click();
    });
    expect(checkbox("revenue").checked).toBe(true);
    expect(checkbox("orders").disabled).toBe(true);

    await act(async () => {
      fail(new Error("save failed"));
    });
    await settle();
    expect(checkbox("revenue").checked).toBe(false);
    expect(checkbox("orders").disabled).toBe(false);
  });

  it("sends a metric or dimension saved twice only once", async () => {
    await render({
      initial: {
        ...baseContents,
        metrics: ["revenue", "revenue"],
        selectedDimensions: ["region", "region"],
      },
    });
    await click(byText("button", "Run"));
    expect(posted).toEqual([
      expect.objectContaining({
        metrics: [{ name: "revenue" }],
        groupBy: [{ name: "region" }],
      }),
    ]);
  });

  it("loads further catalog pages instead of stopping at the first hundred", async () => {
    const metric = (name: string) => ({ ...catalog.items[1]!, name });
    listPage = (pageNum) => ({
      ...catalog,
      items: pageNum === 1 ? [metric("first_page")] : [metric("second_page")],
      pageNum,
      totalItems: 101,
      totalPages: 2,
    });
    await render();
    expect(container.textContent).toContain("first_page");
    expect(container.textContent).not.toContain("second_page");

    await click(byText("button", "Show more metrics"));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("first_page");
      expect(container.textContent).toContain("second_page");
      expect(
        [...container.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Show more metrics",
        ),
      ).toBe(false);
    });
  });

  it("keeps the choices read-only when the person cannot edit", async () => {
    await render({
      canEdit: false,
      initial: { ...baseContents, metrics: ["revenue"] },
    });
    expect(checkbox("revenue").disabled).toBe(true);
    expect(byText<HTMLButtonElement>("button", "Run").disabled).toBe(false);
  });
});
