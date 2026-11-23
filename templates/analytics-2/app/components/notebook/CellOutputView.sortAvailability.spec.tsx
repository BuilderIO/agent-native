// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

const allRows = [
  ...Array.from({ length: 50 }, (_, i) => [i + 51]),
  ...Array.from({ length: 50 }, (_, i) => [i + 1]),
];
const columns = [{ name: "value", type: "number" as const }];
const values = (container: HTMLElement) =>
  [...container.querySelectorAll("tbody td")].map((cell) =>
    Number(cell.textContent),
  );
async function open(container: HTMLElement) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Column actions for value"]',
      )
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
}
function sortItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  );
}

it("report B-PROVIDER-SORT-AVAILABILITY: pages an unsorted partial result without repeating rows", async () => {
  const load = vi.fn();
  function View() {
    const [count, setCount] = useState(50);
    return (
      <CellOutputView
        output={{
          type: "table",
          columns,
          rows: allRows.slice(0, count),
          rowCount: count,
          truncated: count < 100,
        }}
        hasNextPage={count < 100}
        totalRows="100"
        onLoadRows={async (required) => {
          load(required);
          setCount(required);
          return required;
        }}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
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
    await open(container);
    expect(sortItem("Sort 1 → 9")?.getAttribute("data-disabled")).toBeNull();
    expect(load).not.toHaveBeenCalled();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    const first = values(container);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
        ?.click(),
    );
    expect(load.mock.calls).toEqual([[100]]);
    const second = values(container);
    expect(first).toEqual(Array.from({ length: 50 }, (_, i) => i + 51));
    expect(second).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(second.filter((value) => first.includes(value))).toEqual([]);
    await open(container);
    expect(sortItem("Sort 1 → 9")?.getAttribute("data-disabled")).toBeNull();
    await act(async () => sortItem("Sort 1 → 9")?.click());
    expect(values(container)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report B-PROVIDER-SORT-AVAILABILITY: discards a sort when a new result is incomplete or loading", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (complete: boolean, loading = false) =>
    act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={{
              type: "table",
              columns,
              rows: allRows.slice(0, complete ? 100 : 50),
              rowCount: complete ? 100 : 50,
              truncated: !complete,
            }}
            hasNextPage={!complete}
            totalRows="100"
            loading={loading}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  try {
    await render(true);
    await open(container);
    await act(async () => sortItem("Sort 1 → 9")?.click());
    expect(values(container)[0]).toBe(1);
    await render(false);
    expect(values(container)[0]).toBe(51);
    // oracle-change: the first th is the row-number header; read the value column's header
    expect(
      container.querySelector("thead th[aria-sort]")?.getAttribute("aria-sort"),
    ).toBe("none");
    await render(true);
    expect(values(container)[0]).toBe(51);
    await open(container);
    await act(async () => sortItem("Sort 1 → 9")?.click());
    await render(true, true);
    expect(values(container)[0]).toBe(51);
    await render(true);
    expect(values(container)[0]).toBe(51);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report B-PROVIDER-SORT-PAGING: sorting a partial result loads every row before ordering across pages", async () => {
  const load = vi.fn();
  function View() {
    const [count, setCount] = useState(50);
    return (
      <CellOutputView
        output={{
          type: "table",
          columns,
          rows: allRows.slice(0, count),
          rowCount: count,
          truncated: count < 100,
        }}
        hasNextPage={count < 100}
        totalRows="100"
        onLoadRows={async (required) => {
          load(required);
          setCount(required);
          return required;
        }}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
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
    await open(container);
    await act(async () => sortItem("Sort 1 → 9")?.click());
    expect(load.mock.calls).toEqual([[100]]);
    const first = values(container);
    expect(first).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
        ?.click(),
    );
    const second = values(container);
    expect(second).toEqual(Array.from({ length: 50 }, (_, i) => i + 51));
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report B-PROVIDER-SORT-PAGING: reports a failed sort load instead of sorting a partial result", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={{
              type: "table",
              columns,
              rows: allRows.slice(0, 50),
              rowCount: 50,
              truncated: true,
            }}
            hasNextPage
            totalRows="100"
            onLoadRows={async () => {
              throw new Error("provider offline");
            }}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    await open(container);
    await act(async () => sortItem("Sort 1 → 9")?.click());
    expect(values(container)[0]).toBe(51);
    expect(container.textContent).toContain("provider offline");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
