import { metricTitleInputs } from "../../../shared/metric-title";
import type { CellContents } from "./contracts";
import { sqlTemplateInputNames } from "./sql-template-names";

type CellLike = { id: string; contents: CellContents };

export type CellRelation = "upstream" | "downstream" | "both";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Read = {
  name: string;
  /** Only a cell before the reader can supply it: SQL runs read earlier results as tables. */
  earlierOnly: boolean;
};

const named = (names: ReadonlyArray<string | null | undefined>): Read[] =>
  names.flatMap((name) => (name == null ? [] : [{ name, earlierOnly: false }]));

/**
 * What a cell reads. Inputs and dataframes are looked up by name from any cell
 * of the project, so those reads carry no position; a SQL cell reading an
 * earlier result as a table is the one read that needs it to come first.
 * Python and R cells are not traced.
 */
function readsOf(
  contents: CellContents,
  resultNames: readonly string[],
): Read[] {
  switch (contents.kind) {
    case "chart":
    case "display-table":
    case "pivot":
    case "filter":
      return named([contents.dataframe]);
    case "metric":
      return named(
        contents.metricConfig
          ? metricTitleInputs(contents.metricConfig.title)
          : [contents.valueVariableName],
      );
    case "writeback":
      return named([contents.dataframeName]);
    case "explore":
      return named([contents.input]);
    case "map":
      return named(contents.layers.map((layer) => layer.dataframeName));
    case "input":
      return named([contents.optionsSource?.dataframe]);
    case "sql": {
      const text = contents.source.replace(/--[^\n]*/g, " ");
      const tables = resultNames.filter((name) =>
        new RegExp(
          `\\b(?:from|join)\\s+"?${escapeRegExp(name)}"?(?![\\w.])`,
          "i",
        ).test(text),
      );
      return [
        ...named(sqlTemplateInputNames(contents.source)),
        ...tables.map((name) => ({ name, earlierOnly: true })),
      ];
    }
    case "block":
    case "cell-group":
    case "code":
    case "collapsible":
    case "component-import":
    case "dbt-metric":
    case "markdown":
    case "text":
    case "vega-chart":
      return [];
  }
}

/** What a cell makes available to the cells after it. */
function providesOf(contents: CellContents): string[] {
  if (contents.kind === "input") return [contents.name];
  if (contents.kind === "metric" && contents.metricConfig) return [];
  if (
    "resultVariable" in contents &&
    typeof contents.resultVariable === "string" &&
    contents.resultVariable !== ""
  ) {
    return [contents.resultVariable];
  }
  return [];
}

/**
 * The cells a cell depends on or feeds, by what they provide and read, in
 * notebook order. A reader may only use what an earlier cell provides, and a
 * cell never relates to itself.
 */
export function relatedCellIds(
  cells: readonly CellLike[],
  cellId: string,
  relation: CellRelation,
): string[] {
  const start = cells.findIndex((cell) => cell.id === cellId);
  if (start < 0) return [];
  const resultNames = cells.flatMap((cell) =>
    cell.contents.kind === "sql" || cell.contents.kind === "code"
      ? providesOf(cell.contents)
      : [],
  );
  const providers = new Map<string, number[]>();
  const readers = new Map<number, Read[]>();
  const positions = new Map(cells.map(({ id }, position) => [id, position]));
  cells.forEach((cell, position) => {
    for (const name of providesOf(cell.contents)) {
      providers.set(name, [...(providers.get(name) ?? []), position]);
    }
    readers.set(position, readsOf(cell.contents, resultNames));
  });
  const upstream = (position: number): number[] => {
    const contents = cells[position]?.contents;
    const source =
      contents?.kind === "metric" ? contents.metricConfig?.source : null;
    const producer = source ? positions.get(source.cellId) : undefined;
    const namedSources = (readers.get(position) ?? []).flatMap((read) =>
      (providers.get(read.name) ?? []).filter(
        (provider) =>
          provider !== position && (!read.earlierOnly || provider < position),
      ),
    );
    return producer !== undefined && producer < position
      ? [...namedSources, producer]
      : namedSources;
  };
  const downstream = (position: number): number[] =>
    cells.flatMap((_cell, other) =>
      other !== position && upstream(other).includes(position) ? [other] : [],
    );
  const walk = (start: number, next: (position: number) => number[]) => {
    const seen = new Set<number>();
    const queue = [start];
    for (const position of queue) {
      for (const neighbour of next(position)) {
        if (neighbour === start || seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    return seen;
  };
  const picked = new Set<number>([start]);
  if (relation !== "downstream") {
    for (const position of walk(start, upstream)) picked.add(position);
  }
  if (relation !== "upstream") {
    for (const position of walk(start, downstream)) picked.add(position);
  }
  return [...picked]
    .sort((a, b) => a - b)
    .flatMap((position) => {
      const cell = cells[position];
      return cell === undefined ? [] : [cell.id];
    });
}
