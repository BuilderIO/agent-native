import { beforeEach, describe, expect, it, vi } from "vitest";

const { readProjectOutputs } = vi.hoisted(() => ({
  readProjectOutputs: vi.fn(),
}));
vi.mock("./project-output-access.js", () => ({
  readAccessibleProjectOutputs: readProjectOutputs,
}));

import type { CellContents } from "../../app/lib/model/contracts.js";
import {
  assertSelectionAllowed,
  typedSelection,
  createInputChoiceResolver,
} from "./input-options.js";

type Input = Extract<CellContents, { kind: "input" }>;
const base = {
  order: "a0",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
const input = (over: Partial<Input> = {}): Input => ({
  ...base,
  id: "cel_in",
  kind: "input",
  name: "region",
  inputType: "DROPDOWN",
  defaultValueString: "",
  options: ["typed"],
  optionsSource: { dataframe: "regions", valueColumn: "code" },
  ...over,
});
const sourceCell = (source = "select code from t") => ({
  id: "cel_q",
  contents: {
    ...base,
    id: "cel_q",
    kind: "sql",
    source,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: "regions",
    outputResult: true,
  } as CellContents,
});
const table = (rows: (string | number | null)[][], truncated = false) => ({
  cel_q: {
    status: "complete",
    ranAt: "2026-11-18T00:00:00.000Z",
    sourceConnectionId: null,
    output: {
      type: "table",
      columns: [{ name: "code", type: "string" }],
      rows,
      rowCount: rows.length,
      truncated,
    },
  },
});
const resolver = (cells = [sourceCell()]) =>
  createInputChoiceResolver({
    scope: { ownerEmail: "a@b.c", orgId: "org" } as never,
    projectId: "prj",
    cells,
  });

beforeEach(() => readProjectOutputs.mockReset());

describe("server input choices", () => {
  it("keeps static options as they are", async () => {
    const { optionsSource: _s, ...rest } = input();
    expect(
      (await resolver()(rest as Input)).options.map((o) => o.text),
    ).toEqual(["typed"]);
    expect(readProjectOutputs).not.toHaveBeenCalled();
  });

  it("allows exactly the complete result's values, never the typed list", async () => {
    readProjectOutputs.mockResolvedValue(
      table([["us"], ["eu"], ["us"], [null]]),
    );
    const allowed = await resolver()(input());
    expect(allowed.options.map((o) => o.text)).toEqual(["us", "eu"]);
    expect(() => assertSelectionAllowed(["typed"], allowed)).toThrow();
    expect(() => assertSelectionAllowed(["us", ""], allowed)).not.toThrow();
  });

  it("treats inherited property names as ordinary values", async () => {
    readProjectOutputs.mockResolvedValue(table([["constructor"]]));
    const allowed = await resolver()(input());
    expect(() =>
      assertSelectionAllowed(["constructor"], allowed),
    ).not.toThrow();
    expect(() => assertSelectionAllowed(["toString"], allowed)).toThrow();
  });

  it("refuses a partial saved result instead of trusting its preview", async () => {
    readProjectOutputs.mockResolvedValue(table([["us"]], true));
    await expect(resolver()(input())).rejects.toMatchObject({
      errorCode: "project_input_options_incomplete",
    });
  });

  it("refuses when the source has not run, was removed, or lost its column", async () => {
    readProjectOutputs.mockResolvedValue({});
    await expect(resolver()(input())).rejects.toMatchObject({
      errorCode: "project_input_options_pending",
    });
    await expect(resolver([])(input())).rejects.toMatchObject({
      errorCode: "project_input_options_source_missing",
    });
    readProjectOutputs.mockResolvedValue(table([["us"]]));
    await expect(
      resolver()(
        input({ optionsSource: { dataframe: "regions", valueColumn: "x" } }),
      ),
    ).rejects.toMatchObject({
      errorCode: "project_input_options_column_missing",
    });
  });

  it("refuses a number and a string that print the same", async () => {
    readProjectOutputs.mockResolvedValue(table([[7], ["7"]]));
    await expect(resolver()(input())).rejects.toMatchObject({
      errorCode: "project_input_options_ambiguous",
    });
  });

  it("refuses a dependency cycle where the source query uses the input", async () => {
    readProjectOutputs.mockResolvedValue(table([["us"]]));
    await expect(
      resolver([sourceCell("select code from t where r = {{ region }}")])(
        input(),
      ),
    ).rejects.toMatchObject({ errorCode: "project_input_options_cycle" });
  });

  it("keeps a number a number so it binds typed, and text stays text", async () => {
    readProjectOutputs.mockResolvedValue(table([[7], ["east"]]));
    const choices = await resolver()(input());
    expect(typedSelection(["7", "east", ""], choices)).toEqual([7, "east", ""]);
  });

  it("changes identity when the source result or its query changes", async () => {
    readProjectOutputs.mockResolvedValue(table([["us"]]));
    const first = (await resolver()(input())).identity;
    readProjectOutputs.mockResolvedValue({
      cel_q: { ...table([["us"]]).cel_q, ranAt: "2026-11-18T01:00:00.000Z" },
    });
    expect((await resolver()(input())).identity).not.toBe(first);
    readProjectOutputs.mockResolvedValue(table([["us"]]));
    expect(
      (await resolver([sourceCell("select code from t2")])(input())).identity,
    ).not.toBe(first);
  });

  it("finds a transitive cycle through another query-driven input", async () => {
    readProjectOutputs.mockResolvedValue(table([["us"]]));
    const other = input({
      id: "cel_in2",
      name: "country",
      optionsSource: { dataframe: "countries", valueColumn: "code" },
    });
    const countries = {
      ...sourceCell("select code from c where r = {{ region }}"),
      id: "cel_c",
      contents: {
        ...sourceCell().contents,
        id: "cel_c",
        resultVariable: "countries",
        source: "select code from c where r = {{ region }}",
      } as CellContents,
    };
    const regions = sourceCell("select code from t where c = {{country}}");
    const cells = [
      regions,
      countries,
      { id: "cel_in", contents: input() },
      { id: "cel_in2", contents: other },
    ];
    await expect(resolver(cells)(input())).rejects.toMatchObject({
      errorCode: "project_input_options_cycle",
    });
  });
});
