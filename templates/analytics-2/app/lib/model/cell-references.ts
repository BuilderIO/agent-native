import { metricTitleInputs } from "../../../shared/metric-title.js";
import { cellKindDefinition } from "./cell-types.js";
import type { CellContents } from "./contracts.js";

/**
 * Cell labels and the variables a cell reads and produces.
 *
 * A cell shows its own label when the person gave it one. Otherwise the label
 * is the kind's noun plus the cell's position, so renaming stays predictable
 * even after cells move.
 */

/** Turns a variable name into a friendly label ("order_total" → "Order total"). */
export function inputNameToLabel(name: string): string {
  if (name === "") return name;
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toLocaleUpperCase() + spaced.substring(1);
}

/**
 * The label a cell shows. `cellIndex` is zero-based; the label counts from one.
 */
export function resolveCellLabel(
  cell: { contents: CellContents; label: string | null } | null,
  cellIndex: number,
): string {
  const position = cellIndex + 1;
  if (cell === null) return `Cell ${position}`;
  if (cell.label !== null && cell.label.trim() !== "") return cell.label;

  const contents = cell.contents;
  if (contents.kind === "input") return inputNameToLabel(contents.name);
  if (contents.kind === "component-import" && contents.title !== null) {
    return contents.title;
  }
  if (contents.kind === "explore") {
    return contents.visualizationType === "chart"
      ? `Chart ${position}`
      : `Pivot ${position}`;
  }
  return `${cellKindDefinition(contents.kind).labelNoun} ${position}`;
}

function dataframeName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value;
}

function isInlineJsonDataframe(value: string): boolean {
  return value.trimStart().startsWith("[");
}

/**
 * The variables a cell reads. Text-based cells reference variables in their
 * own source, so they contribute nothing here.
 */
export function cellInputParams(contents: CellContents): string[] {
  const params: string[] = [];
  switch (contents.kind) {
    case "chart": {
      const name = dataframeName(contents.dataframe);
      if (name !== null && !isInlineJsonDataframe(name)) params.push(name);
      break;
    }
    case "pivot":
    case "filter":
    case "display-table": {
      const name = dataframeName(contents.dataframe);
      if (name !== null) params.push(name);
      if (contents.kind === "display-table") {
        params.push(...contents.columns.map((column) => column.name));
      }
      break;
    }
    case "metric": {
      if (contents.metricConfig) {
        params.push(...metricTitleInputs(contents.metricConfig.title));
        break;
      }
      const name = dataframeName(contents.valueVariableName);
      if (name !== null) params.push(name);
      break;
    }
    case "writeback": {
      const name = dataframeName(contents.dataframeName);
      if (name !== null) params.push(name);
      break;
    }
    case "map": {
      for (const layer of contents.layers) {
        const name = dataframeName(layer.dataframeName);
        if (name !== null) params.push(name);
      }
      break;
    }
    case "explore": {
      const name = dataframeName(contents.input);
      if (name !== null) params.push(name);
      break;
    }
    // Text-based cells and container kinds reference variables in their own
    // body, which the editor resolves from the cell text.
    case "code":
    case "sql":
    case "text":
    case "markdown":
    case "input":
    case "component-import":
    case "collapsible":
    case "dbt-metric":
    case "vega-chart":
    case "cell-group":
    case "block":
      break;
  }
  return [...new Set(params)];
}

/**
 * The variables a cell produces: the input it declares, the result it exposes,
 * and any names it binds alongside its result.
 */
export function cellOutputParams(contents: CellContents): string[] {
  const params: string[] = [];
  if (contents.kind === "input" && contents.name !== "") {
    params.push(contents.name);
  }
  switch (contents.kind) {
    case "sql":
    case "code":
    case "metric": {
      if (contents.kind === "metric" && contents.metricConfig) break;
      const hidden = contents.outputResult === false;
      if (contents.resultVariable !== null && !hidden) {
        params.push(contents.resultVariable);
      }
      break;
    }
    default:
      break;
  }
  return [...new Set(params)];
}

export type CellReference = { cellId: string; param: string };

/**
 * Links cells that produce a variable to the cells that read it. Each name is
 * bound by the nearest producer above the reading cell, so a later cell can
 * shadow an earlier one without breaking the cells that came before it.
 */
export function resolveCellReferences(
  cells: readonly { id: string; contents: CellContents }[],
): CellReference[] {
  const bound = new Map<string, string>();
  const references: CellReference[] = [];
  for (const cell of cells) {
    for (const param of cellInputParams(cell.contents)) {
      const producer = bound.get(param);
      if (producer !== undefined) {
        references.push({ cellId: producer, param });
      }
    }
    for (const param of cellOutputParams(cell.contents)) {
      bound.set(param, cell.id);
    }
  }
  return references;
}

/**
 * The names a cell reads that nothing above it produces. The editor shows
 * these as unresolved so the person can fix the chain.
 */
export function unresolvedInputParams(
  cells: readonly { id: string; contents: CellContents }[],
): string[] {
  const bound = new Set<string>();
  const missing: string[] = [];
  for (const cell of cells) {
    for (const param of cellInputParams(cell.contents)) {
      if (!bound.has(param)) missing.push(param);
    }
    for (const param of cellOutputParams(cell.contents)) bound.add(param);
  }
  return [...new Set(missing)];
}
