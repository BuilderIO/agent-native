// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    callAction: mockCallAction,
  };
});

import { CellOutputView } from "./CellOutputView";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockCallAction.mockReset();
});

const allRows = Array.from({ length: 120 }, (_, i) => [
  120 - i,
  i === 2 || i === 105 || i === 118 ? "vip" : "standard",
]);
const fields = [
  { name: "amount", type: "integer" as const },
  { name: "tier", type: "string" as const },
];
const columns = [
  { name: "amount", type: "number" as const, schemaType: "integer" as const },
  { name: "tier", type: "string" as const, schemaType: "string" as const },
];

function readyPage(resultId: string, page: number) {
  const start = (page - 1) * 50;
  return {
    status: "ready" as const,
    resultId,
    page,
    view: { page, viewRevision: 1 },
    rows: allRows.slice(start, start + 50),
    manifest: {
      status: "complete" as const,
      rowCount: "120",
      fields,
    },
  };
}

async function openColumnMenu(container: HTMLElement, column: string) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `button[aria-label="Column actions for ${column}"]`,
      )
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
}

function menuItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  );
}

function columnValues(container: HTMLElement, columnIndex: number) {
  return [...container.querySelectorAll("tbody tr")].map(
    (row) => row.querySelectorAll("td")[columnIndex]?.textContent ?? "",
  );
}

it("enables global sort across all pages of a >50-row durable artifact result without mutating saved page view", async () => {
  mockCallAction.mockImplementation(
    async (action: string, input: { resultId: string; page?: number }) => {
      expect(action).toBe("get-notebook-result-page");
      return readyPage(input.resultId, input.page ?? 1);
    },
  );
  const seek = vi.fn();
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
            queryTableControls
            artifactPage={1}
            queryRequestId="res-120"
            output={{
              type: "table",
              columns,
              rows: allRows.slice(0, 50),
              rowCount: 120,
              totalRows: "120",
              truncated: true,
            }}
            hasNextPage
            totalRows="120"
            onLoadPage={async (offset, id) => {
              seek(offset, id);
              return allRows.slice(offset, offset + 50);
            }}
          />
        </AgentNativeI18nProvider>,
      ),
    );

    await openColumnMenu(container, "amount");
    const sortAsc = menuItem("Sort 1 → 9");
    expect(sortAsc).toBeDefined();
    expect(sortAsc?.getAttribute("data-disabled")).toBeNull();

    await act(async () => sortAsc?.click());

    expect(seek).not.toHaveBeenCalled();
    expect(
      mockCallAction.mock.calls.map(
        ([, input]) => (input as { page: number }).page,
      ),
    ).toEqual([2, 3]);

    expect(columnValues(container, 0).slice(0, 5)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
        ?.click(),
    );
    expect(columnValues(container, 0).slice(0, 5)).toEqual([
      "51",
      "52",
      "53",
      "54",
      "55",
    ]);
    expect(mockCallAction).toHaveBeenCalledTimes(2);

    await openColumnMenu(container, "amount");
    await act(async () => menuItem("Sort 1 → 9")?.click());
    expect(columnValues(container, 0)[0]).toBe("120");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
        ?.click(),
    );
    expect(seek).toHaveBeenCalledWith(50, "res-120");

    await openColumnMenu(container, "amount");
    await act(async () => menuItem("Sort 1 → 9")?.click());
    expect(columnValues(container, 0).slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(mockCallAction).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("filters across every page of a >50-row durable artifact result even when started from page 2", async () => {
  mockCallAction.mockImplementation(
    async (action: string, input: { resultId: string; page?: number }) => {
      expect(action).toBe("get-notebook-result-page");
      return readyPage(input.resultId, input.page ?? 1);
    },
  );
  const seek = vi.fn();
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
            queryTableControls
            artifactPage={2}
            queryRequestId="res-120-p2"
            output={{
              type: "table",
              columns,
              rows: allRows.slice(50, 100),
              rowCount: 120,
              totalRows: "120",
              truncated: true,
            }}
            hasNextPage
            totalRows="120"
            onLoadPage={async (offset, id) => {
              seek(offset, id);
              return allRows.slice(offset, offset + 50);
            }}
          />
        </AgentNativeI18nProvider>,
      ),
    );

    await openColumnMenu(container, "tier");
    await act(async () => menuItem("Filter...")?.click());
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter tier"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "vip");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(seek).not.toHaveBeenCalled();
    expect(
      mockCallAction.mock.calls.map(
        ([, arg]) => (arg as { page: number }).page,
      ),
    ).toEqual([1, 3]);

    expect(columnValues(container, 0)).toEqual(["118", "15", "2"]);
    expect(columnValues(container, 1)).toEqual(["vip", "vip", "vip"]);
    expect(container.textContent).toContain("3 shown of 120 rows (unfiltered)");
    expect(container.textContent).toContain("1–3 of 3");
    expect(container.textContent).not.toContain("1–3 of 3+");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Next page"]',
      )?.disabled,
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("sorts and filters published page-backed results via read-only onLoadPage", async () => {
  const readPages = vi.fn(async (offset: number) =>
    allRows.slice(offset, offset + 50),
  );
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
            queryRequestId="pub-120"
            output={{
              type: "table",
              columns,
              rows: allRows.slice(0, 50),
              rowCount: 120,
              totalRows: "120",
              truncated: true,
            }}
            hasNextPage
            totalRows="120"
            onLoadPage={readPages}
          />
        </AgentNativeI18nProvider>,
      ),
    );

    await openColumnMenu(container, "amount");
    const sortAsc = menuItem("Sort 1 → 9");
    expect(sortAsc?.getAttribute("data-disabled")).toBeNull();
    await act(async () => sortAsc?.click());

    expect(readPages.mock.calls.map(([offset]) => offset)).toEqual([50, 100]);
    expect(columnValues(container, 0).slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(mockCallAction).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("reports a read failure instead of sorting a partial artifact page and keeps >10k-row sort disabled", async () => {
  mockCallAction.mockRejectedValueOnce(new Error("Artifact storage offline"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [big, setBig] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setBig(true)}>
          switch-big
        </button>
        <CellOutputView
          artifactPage={1}
          queryRequestId={big ? "res-20000" : "res-fail"}
          output={{
            type: "table",
            columns,
            rows: allRows.slice(0, 50),
            rowCount: big ? 20000 : 120,
            totalRows: big ? "20000" : "120",
            truncated: true,
          }}
          hasNextPage
          totalRows={big ? "20000" : "120"}
          onLoadPage={async () => allRows.slice(0, 50)}
        />
      </>
    );
  }
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <Harness />
        </AgentNativeI18nProvider>,
      ),
    );

    await openColumnMenu(container, "amount");
    await act(async () => menuItem("Sort 1 → 9")?.click());
    expect(columnValues(container, 0)[0]).toBe("120");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Artifact storage offline",
    );

    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")?.click(),
    );
    await openColumnMenu(container, "amount");
    expect(menuItem("Sort 1 → 9")?.getAttribute("data-disabled")).toBe("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
