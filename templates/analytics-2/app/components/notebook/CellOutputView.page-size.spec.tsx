// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

it("report A2-BQ-V3-TABLE-PAGINATION: pages complete results and changes page size", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (count: number) =>
    act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            initialPageSize={25}
            output={{
              type: "table",
              columns: [{ name: "value", type: "string" }],
              rows: Array.from({ length: count }, (_, i) => [String(i + 1)]),
              rowCount: count,
              truncated: false,
            }}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  const click = async (label: string) =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
        ?.click(),
    );
  const rows = () =>
    [...container.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent).join(""),
    );
  await render(34);
  expect(rows()).toHaveLength(25);
  await click("Next page");
  expect(rows()).toEqual(Array.from({ length: 9 }, (_, i) => String(i + 26)));
  expect(container.textContent).toContain("Rows 26–34 of 34");
  await click("Previous page");
  expect(rows()).toHaveLength(25);
  await click("Next page");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rows per page"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "50 rows")
      ?.click(),
  );
  expect(rows()).toHaveLength(34);
  expect(container.textContent).toContain("Rows 1–34 of 34");
  expect(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous page"]',
    )?.disabled,
  ).toBe(true);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rows per page"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "25 rows")
      ?.click(),
  );
  await click("Next page");
  expect(rows()).toHaveLength(9);
  await render(7);
  expect(rows()).toHaveLength(7);
  expect(container.textContent).toContain("7 rows");
  expect(container.querySelector(".nb-table-pagination")).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

it("ignores an old provider page failure after changing page size", async () => {
  let rejectOld: (error: Error) => void = () => {};
  const requests: number[] = [];
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
          initialPageSize={25}
          output={{
            type: "table",
            columns: [{ name: "value", type: "string" }],
            rows: Array.from({ length: 25 }, (_, i) => [String(i)]),
            rowCount: 25,
            truncated: true,
          }}
          hasNextPage
          onLoadRows={(required) => {
            requests.push(required);
            if (requests.length === 1)
              return new Promise((_resolve, reject) => {
                rejectOld = reject;
              });
            return Promise.reject(new Error("Current failure"));
          }}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const next = () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
      ?.click();
  await act(async () => next());
  expect(requests).toEqual([50]);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rows per page"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "50 rows")
      ?.click(),
  );
  // oracle-change: the cell is busy until the old load settles, so the current load starts afterward
  expect(requests).toEqual([50]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => rejectOld(new Error("Stale failure")));
  expect(requests).toEqual([50, 50]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Current failure",
  );
  await act(async () => next());
  expect(requests).toEqual([50, 50, 100]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Current failure",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(
    "Stale failure",
  );
  await act(async () => root.unmount());
  container.remove();
});
