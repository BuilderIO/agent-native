// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

// A reader changes what a result shows without editing the query: the source
// offers Sort A → Z, Sort Z → A and Filter... from a column header.
const output = {
  type: "table" as const,
  columns: [{ name: "region" }, { name: "orders" }],
  rows: [
    ["EMEA", 42],
    ["AMER", 7],
    ["APAC", 110],
  ],
  rowCount: 3,
};

function render(shown: unknown = output) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView output={shown as never} />
      </AgentNativeI18nProvider>,
    ),
  );
  return { container, root };
}

function firstColumnText(container: HTMLElement) {
  return [...container.querySelectorAll("tbody tr td:first-of-type")].map(
    (cell) => cell.textContent,
  );
}

it("report ASK84-NUMERIC-ALIGN: aligns numeric column headers and cells while keeping text columns left aligned", () => {
  const { container, root } = render({
    type: "table",
    columns: [
      { name: "number", type: "number" },
      { name: "decimal", type: "decimal" },
      { name: "integer", type: "int" },
      { name: "text", type: "string" },
      { name: "inferred" },
    ],
    rows: [[42, "123.45", null, "123", 7]],
    rowCount: 1,
  });
  const controls = [
    ...container.querySelectorAll<HTMLButtonElement>("thead th button"),
  ];
  const cells = [
    ...container.querySelectorAll<HTMLTableCellElement>("tbody td"),
  ];
  expect(controls.map((control) => control.style.justifyContent)).toEqual([
    "end",
    "end",
    "end",
    "",
    "end",
  ]);
  expect(cells.map((cell) => cell.style.textAlign)).toEqual([
    "right",
    "right",
    "right",
    "",
    "right",
  ]);
  expect(cells.map((cell) => cell.textContent)).toEqual([
    "42",
    "123.45",
    // oracle-change: result grids render SQL NULL as the literal null
    "null",
    "123",
    "7",
  ]);
  act(() => root.unmount());
  container.remove();
});

it("sorts a column ascending and descending from its header menu", () => {
  const { container } = render();
  expect(firstColumnText(container)).toEqual(["EMEA", "AMER", "APAC"]);

  const open = () =>
    container
      .querySelector('button[aria-label="Column actions for region"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  act(open);
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  const ascending = items.find(
    (item) => item.textContent === "Sort A → Z",
  ) as HTMLElement;
  act(() =>
    ascending.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(firstColumnText(container)).toEqual(["AMER", "APAC", "EMEA"]);
  const header = container.querySelector("th[aria-sort]")!;
  expect(header.getAttribute("aria-sort")).toBe("ascending");

  act(open);
  const descending = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Sort Z → A",
  ) as HTMLElement;
  act(() =>
    descending.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(firstColumnText(container)).toEqual(["EMEA", "APAC", "AMER"]);
});

it.each([
  ["Sort A → Z", ["AMER", "APAC", "EMEA"]],
  ["Sort Z → A", ["EMEA", "APAC", "AMER"]],
])(
  "report B-RESULT-SORT-TOGGLE: selecting %s again clears the sort",
  (label, sorted) => {
    const { container, root } = render();
    const choose = () => {
      act(() =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Column actions for region"]',
          )
          ?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          ),
      );
      act(() =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
          .find((item) => item.textContent === label)
          ?.click(),
      );
    };
    choose();
    expect(firstColumnText(container)).toEqual(sorted);
    choose();
    expect(firstColumnText(container)).toEqual(["EMEA", "AMER", "APAC"]);
    act(() => root.unmount());
    container.remove();
  },
);

it("filters a column's rows from its header menu", () => {
  const { container } = render();
  act(() =>
    container
      .querySelector('button[aria-label="Column actions for region"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  const filterItem = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Filter...",
  ) as HTMLElement;
  act(() =>
    filterItem.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  const input = container.querySelector(
    'input[aria-label="Filter region"]',
  ) as HTMLInputElement;
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    // "ap" matches APAC only: EMEA also contains an "a", so a one-letter
    // filter would have matched every row and proved nothing.
    setter.call(input, "ap");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(firstColumnText(container)).toEqual(["APAC"]);
});

// Numeric strings above 2^53 or with fractions cannot survive Number(); the
// sort compares their exact decimal value. Equivalent spellings keep input order.
const decimalRows = [
  "9007199254740993",
  "9007199254740992.5",
  "9007199254740992",
  "-1.25",
  "-1.5",
  "1e3",
  "1000",
  "1.0",
  "+1",
  "0.1E1",
  "1e400",
  "-0",
  "0",
];

it.each([
  [
    "Sort 1 → 9",
    [
      "-1.5",
      "-1.25",
      "-0",
      "0",
      "1.0",
      "+1",
      "0.1E1",
      "1e3",
      "1000",
      "9007199254740992",
      "9007199254740992.5",
      "9007199254740993",
      "1e400",
    ],
  ],
  [
    "Sort 9 → 1",
    [
      "1e400",
      "9007199254740993",
      "9007199254740992.5",
      "9007199254740992",
      "1e3",
      "1000",
      "1.0",
      "+1",
      "0.1E1",
      "-0",
      "0",
      "-1.25",
      "-1.5",
    ],
  ],
])(
  "report B-RESULT-DECIMAL-SORT: %s orders exact decimal values",
  (label, expected) => {
    const { container, root } = render({
      type: "table",
      columns: [{ name: "amount", type: "decimal" }],
      rows: decimalRows.map((value) => [value]),
      rowCount: decimalRows.length,
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Column actions for amount"]',
        )
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    );
    act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((item) => item.textContent === label)
        ?.click(),
    );
    expect(firstColumnText(container)).toEqual(expected);
    act(() => root.unmount());
    container.remove();
  },
);
