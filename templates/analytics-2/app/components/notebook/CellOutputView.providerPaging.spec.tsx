// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

it("indexes SQL rows and seeks the requested durable page without rerunning the query", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const seek = vi.fn();
  function Result() {
    const [page, setPage] = useState(1);
    const rows = Array.from({ length: 50 }, (_, index) => [
      (page - 1) * 50 + index + 1,
      42,
    ]);
    return (
      <CellOutputView
        queryTableControls
        artifactPage={page}
        queryRequestId="durable-result"
        output={{
          type: "table",
          columns: [
            { name: "row_id", type: "number" },
            { name: "sentinel", type: "number" },
          ],
          rows,
          rowCount: 50,
          truncated: true,
          totalRows: "20000",
        }}
        hasNextPage
        onLoadPage={async (offset, result) => {
          seek(offset, result);
          setPage(offset / 50 + 1);
          return rows;
        }}
      />
    );
  }

  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <Result />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(container.querySelector('tbody th[scope="row"]')?.textContent).toBe(
      "0",
    );
    expect(
      [...container.querySelectorAll('thead th[scope="col"]')].map(
        (header) =>
          header.getAttribute("aria-label") ??
          header.querySelector("span")?.textContent,
      ),
    ).toEqual(["Row number", "row_id", "sentinel"]);
    const labels = [...container.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(
      expect.arrayContaining(["View", "Format", "Columns", "Totals"]),
    );
    const jump = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to page"]',
    );
    assert(jump);
    for (const page of [5, 400]) {
      await act(async () => jump.click());
      const input = document.querySelector<HTMLInputElement>(
        'input[type="number"][aria-label="Go to page"]',
      );
      assert(input?.form);
      input.value = String(page);
      const form = input.form;
      await act(async () =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
      expect(container.querySelector("tbody td")?.textContent).toBe(
        String((page - 1) * 50 + 1),
      );
    }
    expect(seek.mock.calls).toEqual([
      [200, "durable-result"],
      [19950, "durable-result"],
    ]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each([
  { result: 50, message: "More rows are not available." },
  { result: null, message: "Could not load more rows." },
])(
  "A2-PAGER-EMPTY-CONTINUATION: releases the pager when the load returns $result",
  async ({ result, message }) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const load = vi.fn().mockResolvedValue(result);
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={{
              type: "table",
              columns: [{ name: "value", type: "string" }],
              rows: Array.from({ length: 50 }, (_, i) => [String(i)]),
              rowCount: 50,
              truncated: true,
            }}
            hasNextPage
            totalRows={null}
            onLoadRows={load}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
        ?.click(),
    );
    expect(load).toHaveBeenCalledWith(100);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      message,
    );
    expect(
      [...container.querySelectorAll("tbody tr td")].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(Array.from({ length: 50 }, (_, i) => String(i)));
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Next page"]',
      )?.disabled,
    ).toBe(false);
    await act(async () => root.unmount());
    container.remove();
  },
);

it("report B-RESULT-FILTER-PAGING (563): loads later provider pages when filtering leaves the current page short", async () => {
  const allRows = Array.from({ length: 150 }, (_, i) => [
    i === 0 || i === 120 ? `match-${i}` : `other-${i}`,
  ]);
  const load = vi.fn();
  function View() {
    const [count, setCount] = useState(50);
    return (
      <CellOutputView
        output={{
          type: "table",
          columns: [{ name: "value", type: "string" }],
          rows: allRows.slice(0, count),
          rowCount: count,
          truncated: count < allRows.length,
        }}
        hasNextPage={count < allRows.length}
        onLoadRows={async (required) => {
          load(required);
          const next = Math.min(required, allRows.length);
          setCount(next);
          return next;
        }}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <View />
      </AgentNativeI18nProvider>,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Column actions for value"]',
      )
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "Filter...")
      ?.click(),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Filter value"]',
  );
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "match");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
      ?.click(),
  );
  expect(load.mock.calls.map(([count]) => count)).toEqual([100, 150]);
  expect(
    [...container.querySelectorAll("tbody tr td")].map(
      (cell) => cell.textContent,
    ),
  ).toEqual(["match-0", "match-120"]);
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
      ?.disabled,
  ).toBe(true);
  await act(async () => root.unmount());
  container.remove();
});

it("report B-RESULT-FILTER-PAGING: a filter change releases a pending load and reports a new failure", async () => {
  let rejectOld: (error: Error) => void = () => {};
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    )
    .mockRejectedValueOnce(new Error("Provider unavailable"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          output={{
            type: "table",
            columns: [{ name: "value", type: "string" }],
            rows: Array.from({ length: 50 }, (_, i) => [
              i === 0 ? "match" : "other",
            ]),
            rowCount: 50,
            truncated: true,
          }}
          hasNextPage
          onLoadRows={load}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Column actions for value"]',
      )
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "Filter...")
      ?.click(),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Filter value"]',
  );
  expect(input).not.toBeNull();
  const setFilter = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await setFilter("match");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
      ?.click(),
  );
  expect(load).toHaveBeenCalledTimes(1);
  await setFilter("other");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
      ?.click(),
  );
  // oracle-change: the cell is busy until the old load settles, so the new filter load starts afterward
  expect(load).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => rejectOld(new Error("Stale failure")));
  expect(load).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Provider unavailable",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(
    "Stale failure",
  );
  await act(async () => root.unmount());
  container.remove();
});

it("jumps directly to a partial last page and remembers it after remount and replacement", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rowsFor = (prefix: string) =>
    Array.from({ length: 240 }, (_, i) => [`${prefix} ${i + 1}`]);
  const key = "result-page-jump-test";
  const load = vi.fn();
  const render = async (prefix: string, instance: string) =>
    act(async () =>
      root.render(
        <CellOutputView
          key={instance}
          pageStorageKey={key}
          output={{
            type: "table",
            columns: [{ name: "Order", type: "string" }],
            rows: rowsFor(prefix),
            rowCount: 240,
            truncated: false,
          }}
          onLoadRows={load}
        />,
      ),
    );
  try {
    await render("Order", "first");
    const last = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "5",
    );
    expect(last).toBeDefined();
    await act(async () => last?.click());
    expect(host.querySelector("tbody td")?.textContent).toBe("Order 201");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(40);
    expect(load).not.toHaveBeenCalled();
    await render("Order", "reload");
    expect(host.querySelector("tbody td")?.textContent).toBe("Order 201");
    await render("New order", "reload");
    expect(host.querySelector("tbody td")?.textContent).toBe("New order 201");
  } finally {
    await act(async () => root.unmount());
    localStorage.removeItem(key);
    host.remove();
  }
});

it("seeks page 400 once per query and restores it after reload and rerun", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const key = "provider-result-page-jump-test";
  const onLoadPage = vi.fn(async (_offset: number, _requestId: string) =>
    Array.from({ length: 50 }, (_, i) => [`Order ${19951 + i}`]),
  );
  const loadSequentially = vi.fn().mockResolvedValue(null);
  const render = (instance: string, queryRequestId: string) =>
    act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            key={instance}
            pageStorageKey={key}
            queryRequestId={queryRequestId}
            output={{
              type: "table",
              columns: [{ name: "Order", type: "string" }],
              rows: [["Order 1"]],
              rowCount: 1,
              truncated: true,
            }}
            hasNextPage
            totalRows="20000"
            onLoadRows={loadSequentially}
            onLoadPage={onLoadPage}
          />
        </AgentNativeI18nProvider>,
      );
    });
  try {
    await render("initial", "first-query");
    const last = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "400",
    );
    expect(last).toBeDefined();
    await act(async () => last?.click());
    expect(host.querySelector("tbody td")?.textContent).toBe("Order 19951");
    expect(host.querySelector('tbody th[scope="row"]')?.textContent).toBe(
      "19,950",
    );
    expect(host.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(host.textContent).toContain("20,000 rows");
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
        ?.disabled,
    ).toBe(true);
    await render("reload", "first-query");
    expect(host.querySelector("tbody td")?.textContent).toBe("Order 19951");
    await render("reload", "new-query");
    expect(host.querySelector("tbody td")?.textContent).toBe("Order 19951");
    expect(onLoadPage.mock.calls).toEqual([
      [19950, "first-query"],
      [19950, "first-query"],
      [19950, "new-query"],
    ]);
    expect(loadSequentially).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    localStorage.removeItem(key);
    host.remove();
  }
});

it.each(["legacy", "artifact"])(
  "renders complete row counts and refuses to advertise an exact clipped count for a %s result",
  async (kind) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    async function render(rows: string[][], truncated = false) {
      await act(async () =>
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <CellOutputView
              output={{
                type: "table",
                columns: [{ name: "Region", type: "string" }],
                rows,
                rowCount: truncated ? 5000 : rows.length,
                truncated,
              }}
              artifactPage={kind === "artifact" ? 1 : undefined}
              hasNextPage={false}
              totalRows={truncated ? "5000" : null}
            />
          </AgentNativeI18nProvider>,
        ),
      );
    }
    const rowCount = () =>
      host.querySelector('.nb-result-footer [role="status"]')?.textContent;
    try {
      await render([]);
      expect(host.textContent).toContain("No data");
      expect(rowCount()).toBe("0 rows");
      expect(
        [...host.querySelectorAll(".nb-output-footer, .nb-result-footer")].map(
          (footer) => footer.textContent,
        ),
      ).toEqual(["No data", "0 rows"]);
      expect(host.querySelector(".nb-table-pagination")).toBeNull();
      await render([["North"]]);
      expect(rowCount()).toBe("1 row");
      expect(host.textContent).not.toContain("No data");
      expect(
        [...host.querySelectorAll(".nb-output-footer, .nb-result-footer")].map(
          (footer) => footer.textContent,
        ),
      ).toEqual(["1 row"]);
      await render([["North"], ["South"]]);
      expect(rowCount()).toBe("2 rows");
      await render([["North"]], true);
      expect(rowCount()).toBe("1+ rows");
      expect(host.textContent).not.toContain("5,000 rows");
      expect(host.querySelector(".nb-table-pagination")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
