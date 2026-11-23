import {
  parameterCellContentsSchema,
  withoutPendingCellEdit,
  type CellContents,
} from "../app/lib/model/contracts.js";
import type { NotebookCell, NotebookChange } from "./notebook-operations.js";

type CellEdit = Extract<
  NotebookChange,
  { type: `set-${string}`; cellId: string }
>;
type Gap = { afterCellId: string | null; beforeCellId: string | null };

export function gapPosition(cells: NotebookCell[], gap: Gap): number | null {
  const position =
    gap.afterCellId === null
      ? 0
      : cells.findIndex(({ id }) => id === gap.afterCellId) + 1;
  if (
    (gap.afterCellId !== null && position === 0) ||
    (cells[position]?.id ?? null) !== gap.beforeCellId
  )
    return null;
  return position;
}

export function editContents(
  contents: CellContents,
  change: CellEdit,
): CellContents | null {
  switch (change.type) {
    case "set-code":
      if (contents.kind === "sql" || contents.kind === "code")
        return { ...contents, source: change.source };
      break;
    case "set-source":
      if (contents.kind === "sql") {
        if (
          change.connectionMode === "dataframes" &&
          change.dataConnectionId !== null
        )
          break;
        const {
          connectionMode: _mode,
          warehouseTable: _warehouseTable,
          ...previous
        } = contents;
        return {
          ...previous,
          dataConnectionId: change.dataConnectionId,
          databaseSchema:
            change.databaseSchema === undefined
              ? contents.databaseSchema
              : change.databaseSchema,
          ...(change.connectionMode === "dataframes"
            ? { connectionMode: "dataframes" }
            : {}),
        };
      }
      break;
    case "set-text":
      if (contents.kind === "text") return { ...contents, text: change.text };
      if (contents.kind === "markdown")
        return { ...contents, markdown: change.text };
      break;
    case "set-label":
      return { ...contents, label: change.label };
    case "set-output-name":
      if ("resultVariable" in contents)
        return { ...contents, resultVariable: change.name };
      break;
    case "set-input-default":
      if (contents.kind === "input")
        return { ...contents, defaultValueString: change.defaultValueString };
      break;
    case "set-input-config":
      if (contents.kind === "input") {
        const next = { ...contents, ...change.config };
        for (const key of [
          "options",
          "optionValueType",
          "optionLabels",
          "dynamicOptions",
          "optional",
          "sliderOptions",
        ] as const) {
          if (next[key] === null) delete next[key];
        }
        const parsed = parameterCellContentsSchema.safeParse(next);
        if (parsed.success) return parsed.data;
      }
      break;
    case "set-chart-config":
      if (contents.kind === "chart") {
        const { chartSpec, dataframe } = change.config;
        return {
          ...contents,
          chartSpec: chartSpec ?? contents.chartSpec,
          dataframe: dataframe === undefined ? contents.dataframe : dataframe,
        };
      }
      break;
    case "set-metric-config":
      if (contents.kind === "metric")
        return { ...contents, metricConfig: change.config };
      break;
    case "set-section":
      if (contents.kind === "collapsible") {
        const { title, collapsed, headingStyle } = change.config;
        return {
          ...contents,
          title: title === undefined ? contents.title : title,
          collapsed: collapsed ?? contents.collapsed,
          ...(headingStyle === undefined ? {} : { headingStyle }),
        };
      }
      break;
  }
  return null;
}

export function notebookCellSymbol(contents: CellContents): string | null {
  if (contents.kind === "input") return contents.name;
  return "resultVariable" in contents ? contents.resultVariable : null;
}

export function symbolNames(cells: NotebookCell[]) {
  return cells.flatMap(({ contents }) => notebookCellSymbol(contents) ?? []);
}

function nextInputSymbol(names: string[]) {
  const occupied = new Set(names.map((name) => name.toLowerCase()));
  let suffix = 1;
  while (occupied.has(`input_${suffix}`)) suffix++;
  return `input_${suffix}`;
}

export function duplicateContents(
  source: CellContents,
  names: string[],
): CellContents {
  const copy = withoutPendingCellEdit(source);
  if (copy.kind === "input") return { ...copy, name: nextInputSymbol(names) };
  if ("resultVariable" in copy && copy.resultVariable !== null)
    return {
      ...copy,
      resultVariable: uniqueResultVariable(copy.resultVariable, names),
    };
  return copy;
}

export function insertContents(
  draft: Extract<NotebookChange, { type: "insert" }>["contents"],
  id: string,
  order: string,
  names: string[],
): CellContents {
  const placement = {
    id,
    order,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
  };
  if (draft.kind === "input")
    return {
      ...draft,
      ...placement,
      name: draft.name ?? nextInputSymbol(names),
    };
  if (draft.kind === "sql")
    return {
      ...draft,
      ...placement,
      resultVariable:
        draft.resultVariable === undefined
          ? uniqueResultVariable("dataframe", names)
          : draft.resultVariable,
    };
  return { ...draft, ...placement };
}

const ENDING_DIGITS = /_?\d+$/;

export function uniqueResultVariable(
  baseName: string,
  existingNames: readonly string[],
): string {
  const names = existingNames.map((name) => name.toLowerCase());
  if (!names.includes(baseName.toLowerCase())) return baseName;
  const digits = baseName.match(ENDING_DIGITS);
  const realBase =
    digits?.index === undefined ? baseName : baseName.slice(0, digits.index);
  const escapedBase = realBase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedBase}(_?(\\d+))?$`);
  const matches = names
    .map((name) => name.match(matcher))
    .filter((match): match is RegExpMatchArray => match !== null);
  const numbers = matches
    .map((match) => match[2])
    .filter((value): value is string => value !== undefined)
    .map((value) => BigInt(value));
  if (numbers.length === 0) return `${realBase}_2`;
  const separator = matches.some((match) => match[1]?.startsWith("_"))
    ? "_"
    : "";
  const highest = numbers.reduce(
    (max, suffix) => (suffix > max ? suffix : max),
    0n,
  );
  return `${realBase}${separator}${highest + 1n}`;
}
