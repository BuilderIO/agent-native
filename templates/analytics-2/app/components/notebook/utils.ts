import {
  actionErrorCode,
  actionErrorMessage,
} from "@agent-native/core/client/hooks";
import type { useT } from "@agent-native/core/client/i18n";
import {
  IconBraces,
  IconCalendar,
  IconHash,
  IconLetterCase,
  IconToggleLeft,
} from "@tabler/icons-react";

import { inputNameToLabel } from "@/lib/model/cell-references";
import { cellKindDefinition, type CellKind } from "@/lib/model/cell-types";
import type { CellContents, CellOutput } from "@/lib/model/contracts";

import type { ResultField } from "../../../shared/notebook-result-contract";
import { tableResultCoverage } from "./result-pagination";
import type { NotebookActionError, NotebookConnection } from "./types";

type Translate = ReturnType<typeof useT>;
type TableOutput = Extract<CellOutput, { type: "table" }>;

export function isNumericResultColumn(type: ResultField["type"]): boolean {
  return type === "number" || type === "integer" || type === "decimal";
}

export function resultColumnIcon(type: ResultField["type"]) {
  if (isNumericResultColumn(type)) return IconHash;
  if (type === "string") return IconLetterCase;
  if (type === "boolean") return IconToggleLeft;
  if (type === "date" || type === "datetime" || type === "time")
    return IconCalendar;
  return IconBraces;
}

/** The editable text a cell stores, or null for kinds without a text body. */
export function editableCellText(contents: CellContents): string | null {
  switch (contents.kind) {
    case "sql":
    case "code":
      return contents.source;
    case "markdown":
      return contents.markdown;
    case "text":
      return contents.text;
    case "input":
      return contents.defaultValueString;
    default:
      return null;
  }
}

/** Replaces only the text key that belongs to the cell kind. */
export function cellContentsWithText(
  contents: CellContents,
  text: string,
): CellContents {
  switch (contents.kind) {
    case "sql":
    case "code":
      return { ...contents, source: text };
    case "markdown":
      return { ...contents, markdown: text };
    case "text":
      return { ...contents, text };
    case "input":
      return { ...contents, defaultValueString: text };
    default:
      return contents;
  }
}

/**
 * A cell title the person typed. A blank field clears the custom title, so the
 * generated "SQL 1" style name comes back rather than an empty header.
 */
export function cellLabelFromInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function defaultCellTitle(kind: CellKind, ordinal: number): string {
  return `${cellKindDefinition(kind).labelNoun} ${ordinal}`;
}

export function inputDisplayLabel({
  label,
  name,
}: Extract<CellContents, { kind: "input" }>): string {
  return label ?? (/^input_\d+$/.test(name) ? inputNameToLabel(name) : name);
}

export function cellTitleAtPosition(
  contents: CellContents,
  ordinal: number,
): string {
  if (contents.kind === "input") return contents.name;
  if (contents.kind === "collapsible" && contents.title?.trim())
    return contents.title;
  if (contents.label?.trim()) return contents.label;
  if (
    contents.kind === "sql" &&
    contents.resultVariable &&
    !/^dataframe(?:_\d+)?$/.test(contents.resultVariable)
  ) {
    const name = contents.resultVariable.replaceAll("_", " ").trim();
    if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return defaultCellTitle(contents.kind, ordinal);
}

export function cellIsRunnable(contents: {
  kind: CellKind;
  language?: "python" | "r";
}): boolean {
  return (
    contents.kind === "sql" ||
    (contents.kind === "code" && contents.language === "python")
  );
}

export function cellUsesConnection(kind: CellKind): boolean {
  return kind === "sql";
}

/** A derived, read-only description of a cell kind without a text editor. */
export function describeCell(t: Translate, contents: CellContents): string {
  switch (contents.kind) {
    case "sql":
    case "code":
      return contents.source;
    case "markdown":
      return contents.markdown;
    case "text":
      return contents.text;
    case "chart":
      return [
        `Chart · ${contents.chartSpec.mark}`,
        contents.chartSpec.xField == null
          ? null
          : `x: ${contents.chartSpec.xField}`,
        contents.chartSpec.yField == null
          ? null
          : `y: ${contents.chartSpec.yField}`,
        contents.chartSpec.title == null
          ? null
          : `title: ${contents.chartSpec.title}`,
      ]
        .filter((part): part is string => part != null)
        .join(" · ");
    case "display-table":
      return `Table · ${contents.dataframe ?? "No dataframe"} · ${
        contents.columns.length
      } ${contents.columns.length === 1 ? "column" : "columns"}`;
    case "metric":
      return `Single value · ${contents.valueVariableName ?? "No value selected"}`;
    case "pivot":
      return t("pivot.cellSummary", {
        rows: t("pivot.rowCount", { count: contents.rows.length }),
        columns: t("pivot.columnCount", { count: contents.columns.length }),
        values: t("pivot.valueCount", { count: contents.values.length }),
      });
    case "filter":
      return `Filter · ${contents.dataframe ?? "No dataframe"} · ${
        contents.filters.length
      } ${contents.filters.length === 1 ? "filter" : "filters"}`;
    case "writeback":
      return `Writeback · ${contents.targetTable ?? "No target table"}`;
    case "input":
      return `Input · ${contents.name} · ${contents.inputType}`;
    case "map":
      return `Map · ${contents.layers.length} ${
        contents.layers.length === 1 ? "layer" : "layers"
      }`;
    case "explore":
      return `Explore · ${contents.visualizationType}`;
    case "component-import":
      return contents.title == null
        ? "Component"
        : `Component · ${contents.title}`;
    case "collapsible":
      return contents.title == null ? "Section" : `Section · ${contents.title}`;
    case "dbt-metric":
      return contents.metrics.length === 0
        ? "Metric · No metric selected"
        : `Metric · ${contents.metrics.join(", ")}`;
    case "vega-chart":
      return "Vega chart";
    case "cell-group":
      return contents.title == null ? "Group" : `Group · ${contents.title}`;
    case "block":
      return "Block";
  }
}

export function connectionName(
  connections: readonly NotebookConnection[],
  connectionId: string | null,
): string {
  if (connectionId == null) return "Dataframes";
  return (
    connections.find((connection) => connection.id === connectionId)?.name ??
    "Unknown connection"
  );
}

export function formatCellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function formatTableRowCount(
  t: Translate,
  output: TableOutput,
  locale: string,
  totalRows: string | null = null,
  hasNextPage = false,
): string {
  const { count, exact } = tableResultCoverage(output, totalRows, hasNextPage);
  const formattedCount = count.toLocaleString(locale);
  return exact === null
    ? t("queryPaging.partialRows", { formattedCount })
    : t("queryPaging.rows", { count: Number(count), formattedCount });
}

export function formatResultDimensions(
  t: Translate,
  rows: string,
  columns: number,
) {
  return t("notebook.resultDimensions", {
    rows,
    columns: t("notebook.resultColumnCount", { count: columns }),
  });
}

export function formatOutputSummary(
  t: Translate,
  output: CellOutput | null | undefined,
  locale: string,
  totalRows: string | null = null,
  hasNextPage = false,
): string {
  if (output == null) return "Output";
  if (output.type === "table")
    return formatResultDimensions(
      t,
      formatTableRowCount(t, output, locale, totalRows, hasNextPage),
      output.columns.length,
    );
  if (output.type === "chart") {
    const count = output.rows.length;
    return `${count} ${count === 1 ? "item" : "items"}`;
  }
  if (output.type === "error") return "Output";
  return "Output";
}

export function isRunningStatus(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

export function isConnectionRequiredError(error: unknown): boolean {
  return actionErrorCode(error) === "project_connection_required";
}

export function isPersistedQueryError(error: unknown): boolean {
  const code = actionErrorCode(error);
  return (
    code === "project_connection_required" ||
    code === "project_sample_query_unsupported" ||
    code === "project_sample_query_failed" ||
    code === "project_sample_query_timeout" ||
    code === "project_sample_query_busy" ||
    code === "project_dataframes_unavailable" ||
    code === "project_dataframes_ambiguous"
  );
}

export function toNotebookError(error: unknown): NotebookActionError {
  const candidateMessage =
    typeof error === "string"
      ? error
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";
  const localMessage =
    /^Action \S+ (?:failed|was called|returned|did not return|timed out|requires a refreshed)\b/.test(
      candidateMessage,
    )
      ? ""
      : candidateMessage.trim();
  const message =
    actionErrorMessage(error)?.trim() || localMessage || "The request failed.";
  let details: string | null = null;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { details?: unknown; cause?: unknown };
    if (typeof candidate.details === "string" && candidate.details !== "") {
      details = candidate.details;
    } else if (typeof candidate.cause === "string" && candidate.cause !== "") {
      details = candidate.cause;
    }
  }
  return { message, details };
}
