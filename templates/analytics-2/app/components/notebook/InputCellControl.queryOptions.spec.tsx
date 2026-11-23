// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import enUS from "@/i18n/en-US";
import { resolveOptions } from "@/lib/model/input-options";

import type { ChartDataframe } from "./chart-config";
import { InputCellControl, type InputCellContents } from "./InputCellControl";

const frame = (over: Partial<ChartDataframe> = {}): ChartDataframe => ({
  name: "regions",
  cellId: "cel_q",
  columns: [
    { name: "code", type: "string" },
    { name: "title", type: "string" },
  ],
  rows: [
    ["us", "United States"],
    ["eu", "Europe"],
    ["us", "United States"],
    [null, "No code"],
  ],
  truncated: false,
  ...over,
});

const input = (over: Partial<InputCellContents> = {}): InputCellContents => ({
  id: "cel_input",
  order: "a0",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  kind: "input",
  name: "region",
  inputType: "DROPDOWN",
  defaultValueString: "us",
  options: ["static"],
  optionsSource: {
    dataframe: "regions",
    valueColumn: "code",
    labelColumn: "title",
  },
  ...over,
});

async function render(
  root: Root,
  contents: InputCellContents,
  value: string,
  dataframes: readonly ChartDataframe[],
  onCommit = vi.fn(),
  onChangeContents?: (
    contents: InputCellContents,
    expectedUpdatedAt?: string,
  ) => void,
) {
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <InputCellControl
          contents={contents}
          value={value}
          disabled={false}
          dataframes={dataframes}
          updatedAt="revision"
          onChange={() => {}}
          onCommit={onCommit}
          onChangeContents={onChangeContents}
        />
      </AgentNativeI18nProvider>,
    ),
  );
}

async function pressEnter(element: HTMLElement) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

function dropdown() {
  const trigger = document.querySelector<HTMLElement>(
    '[role="combobox"][aria-label="Value for region"]',
  );
  assert(trigger);
  return trigger;
}

function menuOptions() {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

const asFrame = (candidate: ChartDataframe) => ({
  columns: candidate.columns,
  rows: candidate.rows,
  complete: candidate.truncated !== true,
});

const source = {
  dataframe: "regions",
  valueColumn: "code",
  labelColumn: "title",
};

describe("query-driven input options", () => {
  it("reads distinct non-null strings and numbers with their labels", () => {
    const resolved = resolveOptions(
      source,
      asFrame(
        frame({
          rows: [
            ["us", "United States"],
            [7, "Seven"],
            ["us", "x"],
            [null, "n"],
            [true, "b"],
          ],
        }),
      ),
    );
    expect(resolved).toEqual({
      status: "ready",
      options: [
        { value: "us", text: "us", label: "United States" },
        { value: 7, text: "7", label: "Seven" },
      ],
      incomplete: false,
    });
  });

  it("keeps values named like inherited properties", () => {
    const resolved = resolveOptions(
      { dataframe: "regions", valueColumn: "code" },
      asFrame(
        frame({
          rows: [
            ["constructor", "a"],
            ["__proto__", "b"],
            ["toString", "c"],
          ],
        }),
      ),
    );
    expect(
      resolved.status === "ready" && resolved.options.map((o) => o.text),
    ).toEqual(["constructor", "__proto__", "toString"]);
  });

  it("refuses to conflate the number 7 with the text 7", () => {
    expect(
      resolveOptions(
        { dataframe: "regions", valueColumn: "code" },
        asFrame(
          frame({
            rows: [
              [7, "n"],
              ["7", "s"],
            ],
          }),
        ),
      ),
    ).toEqual({ status: "ambiguous", text: "7" });
  });

  it("is pending, not empty, before the query has a saved result", () => {
    expect(resolveOptions(source, null)).toEqual({
      status: "pending",
    });
  });

  it("names a missing column instead of showing no choices", () => {
    expect(
      resolveOptions(
        { dataframe: "regions", valueColumn: "nope" },
        asFrame(frame()),
      ),
    ).toEqual({ status: "missingColumn", column: "nope" });
  });
});

describe("query-driven input controls", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders the query's choices with labels and never the typed list", async () => {
    const commit = vi.fn();
    await render(root, input(), "us", [frame()], commit);
    expect(dropdown().textContent).toBe("United States");
    await pressEnter(dropdown());
    const options = menuOptions();
    expect(options.map((option) => option.textContent)).toEqual([
      "United States",
      "Europe",
    ]);
    const europe = options.find((option) => option.textContent === "Europe");
    assert(europe);
    await pressEnter(europe);
    expect(commit).toHaveBeenCalledExactlyOnceWith("eu");
  });

  it("refreshes when the dependency result changes", async () => {
    await render(root, input(), "us", [frame()]);
    await pressEnter(dropdown());
    expect(menuOptions().map((option) => option.textContent)).toContain(
      "Europe",
    );
    await render(root, input(), "us", [
      frame({
        rows: [
          ["ap", "Asia Pacific"],
          ["us", "United States"],
        ],
      }),
    ]);
    expect(menuOptions().map((option) => option.textContent)).toEqual([
      "Asia Pacific",
      "United States",
    ]);
  });

  it("keeps the current selection while the result is pending and says why", async () => {
    await render(root, input(), "us", []);
    expect(dropdown().textContent).toBe("us");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Run regions to load the choices",
    );
    await pressEnter(dropdown());
    expect(menuOptions().map((option) => option.textContent)).toEqual([
      "static",
      "us",
    ]);
  });

  it("keeps a selection that is no longer in the result", async () => {
    await render(root, input(), "gone", [frame()]);
    expect(dropdown().textContent).toBe("gone");
    await pressEnter(dropdown());
    expect(menuOptions().map((option) => option.textContent)).toEqual([
      "United States",
      "Europe",
      "gone",
    ]);
  });

  it("does not present a partial result as the complete list", async () => {
    await render(root, input(), "us", [frame({ truncated: true })]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "some choices may be missing",
    );
  });

  it("feeds a multiselect the same way and keeps selected values", async () => {
    await render(
      root,
      input({ inputType: "MULTISELECT" }),
      JSON.stringify(["eu", "gone"]),
      [frame()],
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Values for region"]',
    );
    assert(trigger);
    expect(trigger.textContent).toBe("Europe, gone");
    await act(async () => trigger.click());
    const labels = document.querySelectorAll(
      '[role="group"][aria-label="region"] label',
    );
    expect(
      [...labels].map((label) => [
        label.textContent,
        label.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
      ]),
    ).toEqual([
      ["United States", "false"],
      ["Europe", "true"],
      ["gone", "true"],
    ]);
  });

  it("configures choices from an earlier result and can return to typed values", async () => {
    const contents = input({ order: "a1", optionsSource: undefined });
    const dataframes = [
      frame({ sourceOrder: "a0" }),
      frame({ name: "later", cellId: "cel_later", sourceOrder: "a2" }),
    ];
    const save = vi.fn<(next: InputCellContents, revision?: string) => void>();
    const commit = vi.fn();
    await render(root, contents, "us", dataframes, commit, save);
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Choices from"]',
    );
    assert(trigger);
    await act(async () => trigger.click());

    async function openEditorSelect(label: string) {
      const select = document.querySelector<HTMLElement>(
        `[role="combobox"][aria-label="${label}"]`,
      );
      assert(select);
      await pressEnter(select);
      return menuOptions().map((option) => option.textContent);
    }

    async function choose(label: string) {
      const option = menuOptions().find(
        (option) => option.textContent === label,
      );
      assert(option);
      await pressEnter(option);
      const saved = save.mock.lastCall?.[0];
      assert(saved);
      await render(root, saved, "us", dataframes, commit, save);
    }

    expect(await openEditorSelect("Choices from")).toEqual([
      "Typed values",
      "regions",
    ]);
    await choose("regions");
    expect(save).toHaveBeenLastCalledWith(
      {
        ...contents,
        optionsSource: {
          dataframe: "regions",
          valueColumn: "code",
          labelColumn: null,
        },
      },
      "revision",
    );
    expect(await openEditorSelect("Label column")).toEqual([
      "No label",
      "code",
      "title",
    ]);
    await choose("title");
    expect(dropdown().textContent).toBe("United States");
    expect(await openEditorSelect("Value column")).toEqual(["code", "title"]);
    await choose("title");
    expect(save.mock.lastCall?.[0].optionsSource).toEqual({
      dataframe: "regions",
      valueColumn: "title",
      labelColumn: "title",
    });
    await openEditorSelect("Choices from");
    await choose("Typed values");
    expect(save.mock.lastCall?.[0].optionsSource).toBeUndefined();
    expect(save.mock.lastCall?.[0].options).toEqual(["static"]);
  });
});
