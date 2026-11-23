import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useMemo, type ReactNode } from "react";

import {
  chartSpecSchema,
  type CellOutput,
  type ChartSpec,
} from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";
import {
  resolveChartDataframe,
  useChartSeries,
  type ChartDataframe,
} from "./chart-config";
import { MarkdownCellView } from "./MarkdownCellView";
import { VegaChart, VegaSpecChart } from "./VegaChart";

type CapturedCell = {
  id: string;
  kind: string;
  label: string | null;
  contents: Record<string, unknown>;
  /** The cell had a result that this reader may not see. */
  outputOmitted?: boolean;
  output?: CellOutput;
};

type ComponentResponse = {
  component?: { id: string; name: string; cellCount: number };
  cells?: CapturedCell[];
};

type TableOutput = Extract<CellOutput, { type: "table" }>;

type DisplayTableColumnSpec = {
  name: string;
  header?: string | null;
  hidden?: boolean;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectDisplayTable(
  output: TableOutput,
  rawColumns: unknown,
): TableOutput {
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) return output;
  const specs = rawColumns.filter(
    (entry): entry is DisplayTableColumnSpec =>
      isPlainRecord(entry) && typeof entry.name === "string",
  );
  if (specs.length === 0) return output;
  const selected = specs.flatMap((column) => {
    if (column.hidden) return [];
    const index = output.columns.findIndex(
      (candidate) => candidate.name === column.name,
    );
    const source = output.columns[index];
    return source ? [{ column, index, source }] : [];
  });
  if (selected.length === 0) return output;
  return {
    ...output,
    columns: selected.map(({ column, source }) => ({
      ...source,
      name: column.header ?? column.name,
    })),
    rows: output.rows.map((row) =>
      selected.map(({ index }) => row[index] ?? null),
    ),
  };
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function computeCapturedMetric(
  contents: Record<string, unknown>,
  tablesById: ReadonlyMap<string, TableOutput>,
  tablesByName: ReadonlyMap<string, TableOutput>,
): string | null {
  const config = isPlainRecord(contents.metricConfig)
    ? contents.metricConfig
    : null;
  if (config) {
    const source = isPlainRecord(config.source) ? config.source : null;
    const cellId = typeof source?.cellId === "string" ? source.cellId : null;
    const dfName =
      typeof source?.dataframe === "string" ? source.dataframe.trim() : null;
    const table =
      (cellId ? tablesById.get(cellId) : undefined) ??
      (dfName ? tablesByName.get(dfName) : undefined);
    if (!table) return null;

    const valueSpec = isPlainRecord(config.value) ? config.value : null;
    const fieldName =
      typeof valueSpec?.field === "string" ? valueSpec.field : null;
    const aggregation =
      typeof valueSpec?.aggregation === "string"
        ? valueSpec.aggregation
        : "first";
    const colIndex = fieldName
      ? table.columns.findIndex((column) => column.name === fieldName)
      : 0;
    if (colIndex < 0) return null;

    const rawValues = table.rows
      .map((row) => row[colIndex])
      .filter((value) => value !== null && value !== undefined);
    const numbers = rawValues
      .map(toNumeric)
      .filter((value): value is number => value !== null);

    let computed: string | number | boolean | null = null;
    switch (aggregation) {
      case "sum":
        computed = numbers.reduce((acc, value) => acc + value, 0);
        break;
      case "avg":
      case "mean":
        computed =
          numbers.length > 0
            ? numbers.reduce((acc, value) => acc + value, 0) / numbers.length
            : null;
        break;
      case "min":
        computed = numbers.length > 0 ? Math.min(...numbers) : null;
        break;
      case "max":
        computed = numbers.length > 0 ? Math.max(...numbers) : null;
        break;
      case "count":
        computed = rawValues.length;
        break;
      case "countDistinct":
        computed = new Set(rawValues.map((value) => String(value))).size;
        break;
      case "last":
        computed = rawValues[rawValues.length - 1] ?? null;
        break;
      default:
        computed = rawValues[0] ?? null;
        break;
    }
    if (computed === null) return "—";
    if (typeof computed === "number") {
      const format = isPlainRecord(config.format) ? config.format : null;
      const kind = typeof format?.kind === "string" ? format.kind : "number";
      const decimals =
        typeof format?.decimals === "number" ? format.decimals : undefined;
      if (kind === "percent") {
        return new Intl.NumberFormat(undefined, {
          style: "percent",
          maximumFractionDigits: decimals ?? 1,
        }).format(computed);
      }
      if (kind === "currency") {
        const currency =
          typeof format?.currency === "string" ? format.currency : "USD";
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
          maximumFractionDigits: decimals ?? 2,
        }).format(computed);
      }
      return new Intl.NumberFormat(
        undefined,
        decimals === undefined
          ? undefined
          : {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            },
      ).format(computed);
    }
    return String(computed);
  }

  const variableName =
    typeof contents.valueVariableName === "string"
      ? contents.valueVariableName.trim()
      : "";
  if (!variableName) return null;
  const table = tablesByName.get(variableName);
  if (!table) return null;
  const rowIndex =
    typeof contents.valueRowIndex === "number" ? contents.valueRowIndex : 0;
  const value = table.rows[rowIndex]?.[0];
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  return String(value);
}

function CapturedChart({
  dataframe,
  spec,
  dataframes,
  output,
  fallback,
}: {
  dataframe: string | null;
  spec: ChartSpec;
  dataframes: readonly ChartDataframe[];
  output: Extract<CellOutput, { type: "chart" }> | null;
  fallback: ReactNode;
}) {
  const t = useT();
  const resolution = useMemo(
    () =>
      resolveChartDataframe(dataframe, dataframes, output, spec.sourceCellId),
    [dataframe, dataframes, output, spec.sourceCellId],
  );
  const selected = resolution.status === "ready" ? resolution.dataframe : null;
  const series = useChartSeries(spec, selected);
  if (resolution.status === "error") {
    return (
      <div className="nb-side-panel-error" role="alert">
        {resolution.reason === "sourceUnavailable" ? (
          t("chartData.sourceUnavailable")
        ) : (
          <>
            <p>{t("chartData.invalidTitle")}</p>
            <p>{t("chartData.invalidMessage")}</p>
          </>
        )}
      </div>
    );
  }
  if (!selected) return fallback;
  if (spec.version === 2 && series.rows.length === 0) {
    return (
      <p className="nb-side-panel-note">
        {t(
          series.xField !== null &&
            (spec.mark === "histogram" ||
              (spec.mark === "gantt"
                ? series.yField !== null && spec.endField != null
                : series.yField !== null || spec.countRecords === true))
            ? "chartData.noData"
            : "chartData.chooseAxes",
        )}
      </p>
    );
  }
  return (
    <VegaChart
      columns={series.columns}
      rows={series.rows}
      encoding={series.encoding}
      mark={spec.mark}
      orientation={spec.orientation}
      stackMode={spec.stackMode}
      binCount={spec.binCount}
      funnelOutcomes={spec.funnelOutcomes}
      stacked={spec.stacked}
      colors={series.colors ?? spec.colors}
      yFormatter={spec.yFormatter}
      seriesLabels={spec.seriesLabels}
      legend={spec.legend}
      tooltipChannels={spec.tooltipChannels}
      title={spec.title}
    />
  );
}

/**
 * A component import cell shows the cells a component captured - text as text, a
 * table as a table, a chart as a chart - read-only. The snapshot is what renders,
 * not the source project, so every importer sees the same thing the creator
 * captured (the source's component import holds a component version for exactly
 * that reason).
 */
export function ComponentImportBody({
  componentId,
  title,
  onChoose,
}: {
  componentId: string | null;
  title: string | null;
  /** Saves the cell's reference to the component the reader picked. */
  onChoose?: ((componentId: string, name: string) => void) | undefined;
}) {
  const t = useT();
  const query = useActionQuery<ComponentResponse>(
    "list-components",
    { componentId },
    { enabled: componentId != null },
  );
  const available = useActionQuery<{
    components?: Array<{ id: string; name: string; cellCount: number }>;
  }>("list-components", {}, { enabled: componentId == null });

  if (componentId == null) {
    const options = available.data?.components ?? [];
    // A cell with no component is a chooser, not a dead end: the reader picks
    // one from what this workspace actually has.
    if (options.length === 0) {
      return (
        <p className="nb-panel-empty">
          No components yet. Select cells in a project and create a component to
          show it here.
        </p>
      );
    }
    return (
      <label className="nb-component-choose">
        <span>Component</span>
        <select
          aria-label="Component to show"
          defaultValue=""
          onChange={(event) => {
            const picked = options.find(
              (option) => option.id === event.target.value,
            );
            if (picked) onChoose?.(picked.id, picked.name);
          }}
        >
          <option value="" disabled>
            Choose the component this cell should show
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} (
              {option.cellCount === 1 ? "1 cell" : `${option.cellCount} cells`})
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (query.isPending)
    return <p className="nb-panel-empty">Loading component…</p>;
  if (query.error || !query.data) {
    return (
      <p className="nb-panel-empty" role="alert">
        This component could not be read. It may have been removed from this
        workspace.
      </p>
    );
  }

  const cells = query.data.cells ?? [];
  const capturedDataframes: ChartDataframe[] = [];
  const capturedTablesById = new Map<string, TableOutput>();
  const capturedTablesByName = new Map<string, TableOutput>();
  const capturedInputs = new Map<string, string>();

  for (const cell of cells) {
    if (cell.kind === "input" && typeof cell.contents.name === "string") {
      capturedInputs.set(
        cell.contents.name,
        String(cell.contents.defaultValueString ?? ""),
      );
    }
    if (cell.output?.type === "table") {
      capturedTablesById.set(cell.id, cell.output);
      const variable =
        typeof cell.contents.resultVariable === "string"
          ? cell.contents.resultVariable.trim()
          : "";
      if (variable !== "") {
        capturedTablesByName.set(variable, cell.output);
        capturedDataframes.push({
          name: variable,
          cellId: cell.id,
          columns: cell.output.columns,
          rows: cell.output.rows,
          truncated: cell.output.truncated,
        });
      }
    }
  }

  return (
    <section className="nb-component-import" aria-label={title ?? "Component"}>
      {cells.length === 0 ? (
        <p className="nb-panel-empty">This component has no cells.</p>
      ) : (
        cells.map((cell) => {
          const label =
            cell.label ??
            (typeof cell.contents.label === "string"
              ? cell.contents.label
              : null);
          const emptyNote = (
            <p className="nb-panel-empty">
              {cell.outputOmitted
                ? t("notebook.component.outputHidden")
                : "This cell captured no result."}
            </p>
          );

          if (cell.kind === "markdown" || cell.kind === "text") {
            const raw = String(
              cell.contents.markdown ?? cell.contents.text ?? "",
            );
            const interpolated = raw.replace(
              /{{\s*([A-Za-z_][A-Za-z_0-9]*)\s*}}/g,
              (token, name: string) => capturedInputs.get(name) ?? token,
            );
            return (
              <div key={cell.id} className="nb-component-cell">
                {label ? (
                  <h4 className="nb-component-cell-title">{label}</h4>
                ) : null}
                <MarkdownCellView markdown={interpolated} />
              </div>
            );
          }

          if (cell.kind === "input") {
            const name = String(cell.contents.name ?? "");
            return (
              <div key={cell.id} className="nb-component-cell">
                <h4 className="nb-component-cell-title">{label ?? name}</h4>
                <p className="nb-component-text">
                  {name}: {String(cell.contents.defaultValueString ?? "")}
                </p>
              </div>
            );
          }

          if (cell.kind === "vega-chart" && isPlainRecord(cell.contents.spec)) {
            return (
              <div key={cell.id} className="nb-component-cell">
                {label ? (
                  <h4 className="nb-component-cell-title">{label}</h4>
                ) : null}
                <VegaSpecChart spec={cell.contents.spec} />
              </div>
            );
          }

          if (cell.kind === "chart") {
            const parsedSpec = chartSpecSchema.safeParse(
              cell.contents.chartSpec,
            );
            const dataframe =
              typeof cell.contents.dataframe === "string"
                ? cell.contents.dataframe
                : null;
            return (
              <div key={cell.id} className="nb-component-cell">
                {label ? (
                  <h4 className="nb-component-cell-title">{label}</h4>
                ) : null}
                {parsedSpec.success ? (
                  <CapturedChart
                    dataframe={dataframe}
                    spec={parsedSpec.data}
                    dataframes={capturedDataframes}
                    output={cell.output?.type === "chart" ? cell.output : null}
                    fallback={emptyNote}
                  />
                ) : cell.output ? (
                  <CellOutputView output={cell.output} />
                ) : (
                  emptyNote
                )}
              </div>
            );
          }

          if (cell.kind === "display-table") {
            const tableConfig = isPlainRecord(cell.contents.tableConfig)
              ? cell.contents.tableConfig
              : null;
            const source = isPlainRecord(tableConfig?.source)
              ? tableConfig.source
              : null;
            const sourceCellId =
              typeof source?.cellId === "string" ? source.cellId : null;
            const dataframeName =
              typeof cell.contents.dataframe === "string"
                ? cell.contents.dataframe.trim()
                : typeof source?.dataframe === "string"
                  ? source.dataframe.trim()
                  : "";
            const boundTable =
              cell.output?.type === "table"
                ? cell.output
                : ((sourceCellId
                    ? capturedTablesById.get(sourceCellId)
                    : undefined) ??
                  (dataframeName !== ""
                    ? capturedTablesByName.get(dataframeName)
                    : undefined));
            return (
              <div key={cell.id} className="nb-component-cell">
                {label ? (
                  <h4 className="nb-component-cell-title">{label}</h4>
                ) : null}
                {boundTable ? (
                  <CellOutputView
                    output={projectDisplayTable(
                      boundTable,
                      cell.contents.columns,
                    )}
                  />
                ) : cell.output ? (
                  <CellOutputView output={cell.output} />
                ) : (
                  emptyNote
                )}
              </div>
            );
          }

          if (cell.kind === "metric") {
            const metricValue =
              cell.output?.type === "metric"
                ? cell.output.formatted
                : computeCapturedMetric(
                    cell.contents,
                    capturedTablesById,
                    capturedTablesByName,
                  );
            return (
              <div key={cell.id} className="nb-component-cell">
                {label ? (
                  <h4 className="nb-component-cell-title">{label}</h4>
                ) : null}
                {metricValue !== null ? (
                  <p
                    data-component-metric-value=""
                    className="text-2xl font-semibold tracking-tight text-foreground"
                  >
                    {metricValue}
                  </p>
                ) : cell.output ? (
                  <CellOutputView output={cell.output} />
                ) : (
                  emptyNote
                )}
              </div>
            );
          }

          const output = cell.output;
          return (
            <div key={cell.id} className="nb-component-cell">
              {label ? (
                <h4 className="nb-component-cell-title">{label}</h4>
              ) : null}
              {output ? <CellOutputView output={output} /> : emptyNote}
            </div>
          );
        })
      )}
    </section>
  );
}
