// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { CellOutput } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

type Table = Extract<CellOutput, { type: "table" }>;
const table = (columns: Table["columns"], rows: Table["rows"]): Table => ({
  type: "table",
  columns,
  rows,
  rowCount: rows.length,
  truncated: false,
});
const initial = table(
  [
    { name: "country", type: "string" },
    { name: "city", type: "string" },
  ],
  [
    ["US", "Boston"],
    ["UK", "London"],
  ],
);

function setup() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (
    output: Table,
    onLoadRows?: (count: number) => Promise<number | null>,
    hasNextPage = false,
  ) => {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={output}
            onLoadRows={onLoadRows}
            hasNextPage={hasNextPage}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  };
  const choose = async (column: string, action: string) => {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Column actions for ${column}"]`,
        )!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((item) => item.textContent === action)!
        .click(),
    );
  };
  const filter = async () => {
    await choose("country", "Filter...");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter country"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "US");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  // oracle-change: each row leads with a row-number th; compare its data cells only
  const rows = () =>
    [...container.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent).join(""),
    );
  const close = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, render, choose, filter, rows, close };
}

it.each([
  [
    "reordered",
    table(
      [
        { name: "city", type: "string" },
        { name: "country", type: "string" },
      ],
      [
        ["London", "UK"],
        ["Boston", "US"],
      ],
    ),
  ],
  [
    "renamed",
    table(
      [
        { name: "place", type: "string" },
        { name: "city", type: "string" },
      ],
      [
        ["London", "UK"],
        ["Boston", "US"],
      ],
    ),
  ],
  [
    "removed",
    table([{ name: "city", type: "string" }], [["London"], ["Boston"]]),
  ],
  [
    "retyped",
    table(
      [
        { name: "country", type: "number" },
        { name: "city", type: "string" },
      ],
      [
        [2, "London"],
        [1, "Boston"],
      ],
    ),
  ],
])(
  "report B-RESULT-SCHEMA-STATE: clears a filter when columns are %s",
  async (_name, changed) => {
    const view = setup();
    await view.render(initial);
    await view.filter();
    expect(view.rows()).toEqual(["USBoston"]);
    await view.render(changed);
    expect(view.rows()).toEqual(changed.rows.map((row) => row.join("")));
    expect(
      view.container.querySelector('input[aria-label^="Filter "]'),
    ).toBeNull();
    await view.close();
  },
);

it("report B-RESULT-SCHEMA-STATE: clears sorting when the result schema changes", async () => {
  const view = setup();
  await view.render(initial);
  await view.choose("country", "Sort A → Z");
  expect(view.rows()).toEqual(["UKLondon", "USBoston"]);
  await view.render(
    table(
      [
        { name: "city", type: "string" },
        { name: "country", type: "string" },
      ],
      [
        ["London", "UK"],
        ["Boston", "US"],
      ],
    ),
  );
  expect(view.rows()).toEqual(["LondonUK", "BostonUS"]);
  await view.close();
});

it("report B-RESULT-SCHEMA-STATE: preserves filtering and sorting when rows change under the same schema", async () => {
  const view = setup();
  await view.render(initial);
  await view.filter();
  await view.choose("city", "Sort Z → A");
  await view.render(
    table(initial.columns, [
      ["US", "Austin"],
      ["UK", "York"],
      ["US", "Seattle"],
    ]),
  );
  expect(view.rows()).toEqual(["USSeattle", "USAustin"]);
  expect(
    view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter country"]',
    )?.value,
  ).toBe("US");
  await view.close();
});

it("report B-RESULT-SCHEMA-STATE: ignores a paging failure from the previous schema", async () => {
  let rejectPage!: (error: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<number | null>((_resolve, reject) => {
        rejectPage = reject;
      }),
  );
  const view = setup();
  await view.render(
    table(
      initial.columns,
      Array.from({ length: 50 }, (_, i) => [String(i), "city"]),
    ),
    load,
    true,
  );
  await act(async () =>
    view.container
      .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!
      .click(),
  );
  expect(load).toHaveBeenCalledOnce();
  await view.render(table([{ name: "new", type: "string" }], [["fresh"]]));
  await act(async () => rejectPage(new Error("stale failure")));
  expect(view.rows()).toEqual(["fresh"]);
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  await view.close();
});

it.each([
  [
    "Sort 1 → 9",
    [
      "-9007199254740993",
      "-9007199254740992",
      "2",
      "9007199254740992",
      "9007199254740993",
    ],
  ],
  [
    "Sort 9 → 1",
    [
      "9007199254740993",
      "9007199254740992",
      "2",
      "-9007199254740992",
      "-9007199254740993",
    ],
  ],
])(
  "report B-RESULT-INTEGER-SORT: sorts signed integer strings precisely with %s",
  async (action, expected) => {
    const view = setup();
    await view.render(
      table(
        [{ name: "country", type: "number" }],
        [...expected].reverse().map((value) => [value]),
      ),
    );
    await view.choose("country", action);
    expect(view.rows()).toEqual(expected);
    await view.close();
  },
);

it("report B-RESULT-INTEGER-SORT: sorts decimal numbers numerically", async () => {
  const view = setup();
  await view.render(
    table(
      [{ name: "country", type: "number" }],
      [["2.5"], ["-3.5"], ["10.25"]],
    ),
  );
  await view.choose("country", "Sort 1 → 9");
  expect(view.rows()).toEqual(["-3.5", "2.5", "10.25"]);
  await view.close();
});
