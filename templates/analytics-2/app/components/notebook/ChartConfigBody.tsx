import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  chartAggregationSchema,
  chartTimeUnitSchema,
  type CellOutput,
  type ChartSpec,
} from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";
import {
  chartAggregationFor,
  chartAggregationsForType,
  chartColumnNames,
  chartTimeUnitFor,
  chartTypeGroups,
  resolveChartDataframe,
  useChartSeries,
  type ChartDataframe,
} from "./chart-config";
import { InputSelect } from "./InputSelect";
import { VegaChart } from "./VegaChart";

const countRecordsOption = "count";
const savedResultOption = "Saved result";

function chartTypeItemLabel(
  item: (typeof chartTypeGroups)[number]["items"][number],
  t: (key: string) => string,
) {
  return item.mark === "sankey"
    ? t("notebook.sankey.label")
    : item.mark === "funnel"
      ? t("notebook.funnel")
      : item.mark === "gantt"
        ? t("visualization.charts.types.gantt")
        : item.mark === "heatmap"
          ? t("visualization.charts.types.heatMap")
          : item.label;
}

/**
 * A chart's configuration, in the notebook where the source puts it. The source
 * edits a chart in its cell panel (chart/editor/LayeredChartEditor.tsx): a chart
 * type selector at the top, then the data tab with the dataframe and its
 * X-axis and Y-axis column choices (chart/editor/ChartDataEditor.tsx,
 * fields/ChartAxisWithDataGroup.tsx). This build shows the same choices in the
 * cell body, because the notebook has no per-cell editor panel, and draws the
 * chart from the dataframe the choices name.
 *
 * Every control here writes through `onChange`, which saves the cell: there is
 * no configuration a person can set that the cell forgets.
 */
export function ChartConfigBody({
  dataframe,
  spec,
  dataframes,
  output,
  disabled = false,
  onChange,
  renderResult,
}: {
  dataframe: string | null;
  spec: ChartSpec;
  dataframes: readonly ChartDataframe[];
  output?: Extract<CellOutput, { type: "chart" }> | null;
  disabled?: boolean;
  renderResult?: (table: boolean) => ReactNode;
  onChange?:
    | ((next: {
        dataframe?: string | null;
        chartSpec?: Partial<ChartSpec>;
      }) => void)
    | undefined;
}) {
  const t = useT();
  const [table, setTable] = useState(false);
  const [binsText, setBinsText] = useState<string | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const typeToggleRef = useRef<HTMLButtonElement>(null);
  const typePanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!typePickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTypePickerOpen(false);
      typeToggleRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (typeToggleRef.current?.contains(target) ||
          typePanelRef.current?.contains(target))
      )
        return;
      setTypePickerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [typePickerOpen]);
  const fullResult = renderResult !== undefined;
  const explicitAxes = spec.version === 2 || fullResult;
  const aggregates =
    spec.mark === "line" ||
    (explicitAxes &&
      (spec.mark === "bar" ||
        spec.mark === "area" ||
        spec.mark === "combo" ||
        spec.mark === "heatmap"));
  const colorLabel = t(
    explicitAxes ? "chartData.colorBy" : "notebook.chartSeries",
  );
  const resolution = useMemo(
    () =>
      resolveChartDataframe(
        dataframe,
        dataframes,
        output,
        spec.sourceCellId,
        fullResult ? spec.sourceExportId : undefined,
      ),
    [
      dataframe,
      dataframes,
      output,
      spec.sourceCellId,
      spec.sourceExportId,
      fullResult,
    ],
  );
  const selected = resolution.status === "ready" ? resolution.dataframe : null;
  const showingSaved = selected != null && !dataframes.includes(selected);
  const columns = selected?.columns ?? [];
  const columnNames = chartColumnNames(columns);
  const fieldLabel = (name: string) =>
    columns.find((column) => column.name === name)?.label ?? name;
  const columnOptions = columnNames.map((value) => ({
    value,
    label: fieldLabel(value),
  }));
  const series = useChartSeries(spec, selected);
  const shownX = fullResult
    ? spec.xField
    : (series.xField ?? (explicitAxes ? null : (series.columns[0] ?? null)));
  const countRecords = aggregates && spec.countRecords === true;
  const shownY = fullResult
    ? spec.yField
    : (series.yField ?? (explicitAxes ? null : (series.columns[1] ?? null)));
  const timeUnit = aggregates
    ? chartTimeUnitFor(
        spec,
        columns.find((column) => column.name === shownX)?.type,
      )
    : null;
  const aggregation =
    aggregates && !countRecords && shownY !== null
      ? (series.encoding?.aggregation ??
        chartAggregationFor(
          spec,
          columns.some(
            (column) =>
              column.name === shownY &&
              ["number", "decimal", "integer"].includes(column.type),
          ),
        ))
      : null;
  const measureOption = (name: string) =>
    explicitAxes ? `field:${name}` : name;
  const targetField =
    spec.seriesField != null && columnNames.includes(spec.seriesField)
      ? spec.seriesField
      : null;
  const shownSecondaryY =
    spec.secondaryYField != null && columnNames.includes(spec.secondaryYField)
      ? spec.secondaryYField
      : null;
  const shownEnd =
    spec.endField != null && columnNames.includes(spec.endField)
      ? spec.endField
      : null;
  const multipleMeasures = fullResult && (spec.yFields?.length ?? 0) > 1;
  const additionalMeasures = columns.filter(
    ({ name, type }) =>
      name !== shownX &&
      name !== shownY &&
      (fullResult
        ? ["number", "integer", "decimal"].includes(type)
        : type === "number"),
  );
  const optionValue = (frame: ChartDataframe) => {
    if (fullResult) return JSON.stringify([frame.cellId, frame.exportId]);
    return explicitAxes ? frame.cellId : frame.name;
  };
  const dataframeKey = showingSaved
    ? savedResultOption
    : selected
      ? optionValue(selected)
      : fullResult && spec.sourceCellId
        ? JSON.stringify([spec.sourceCellId, spec.sourceExportId])
        : explicitAxes
          ? (spec.sourceCellId ?? "")
          : (dataframe ?? "");
  const readOnly = disabled || onChange == null;
  const legendAlwaysDrawn = spec.mark === "pie" || spec.mark === "heatmap";
  const showLegend =
    spec.legend ??
    (legendAlwaysDrawn
      ? true
      : fullResult
        ? Boolean(targetField || multipleMeasures)
        : Boolean(series.encoding?.colorField) || series.columns.length > 2);

  return (
    <div className="nb-chart-config">
      <div className="nb-chart-config-row">
        <ChartSelect
          label={t("notebook.chartDataframe")}
          value={dataframeKey}
          disabled={readOnly || (showingSaved && dataframes.length === 0)}
          options={[
            { value: "", label: t("notebook.chartChooseDataframe") },
            ...(showingSaved &&
            !dataframes.some(({ name }) => name === savedResultOption)
              ? [
                  {
                    value: savedResultOption,
                    label: t("notebook.chartSavedResult"),
                  },
                ]
              : []),
            ...dataframes.map((frame) => ({
              value: optionValue(frame),
              label: frame.name,
            })),
          ]}
          onChange={(value) => {
            if (explicitAxes) {
              const next = dataframes.find(
                (candidate) => optionValue(candidate) === value,
              );
              onChange?.({
                dataframe: next?.name ?? null,
                chartSpec: {
                  sourceCellId: next?.cellId ?? null,
                  ...(fullResult
                    ? {
                        sourceExportId: next?.exportId ?? null,
                        filters: [],
                        excludedMarks: [],
                      }
                    : {}),
                  xField: null,
                  yField: null,
                  yFields: [],
                  seriesField: null,
                  ...(spec.endField !== undefined ? { endField: null } : {}),
                  ...(spec.secondaryYField !== undefined
                    ? { secondaryYField: null }
                    : {}),
                  yAggregation: undefined,
                  countRecords: false,
                },
              });
            } else {
              onChange?.({ dataframe: value || null });
            }
          }}
        />
      </div>

      <div className="nb-chart-config-row">
        <label className="nb-chart-config-field">
          <span className="nb-chart-config-label">Chart type</span>
          <button
            ref={typeToggleRef}
            type="button"
            className="nb-chart-type-toggle flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            aria-label="Chart type"
            aria-expanded={typePickerOpen}
            disabled={readOnly}
            onClick={() => setTypePickerOpen((open) => !open)}
          >
            <span>
              {(() => {
                const activeItem = chartTypeGroups
                  .flatMap((group) => group.items)
                  .find((item) => item.isActive(spec));
                return activeItem
                  ? chartTypeItemLabel(activeItem, t)
                  : spec.mark;
              })()}
            </span>
            {typePickerOpen ? (
              <IconChevronUp size={14} aria-hidden="true" />
            ) : (
              <IconChevronDown size={14} aria-hidden="true" />
            )}
          </button>
        </label>
      </div>

      {typePickerOpen ? (
        <div
          ref={typePanelRef}
          className="nb-chart-types"
          role="group"
          aria-label="Chart type"
        >
          {chartTypeGroups.map((group) => (
            <div className="nb-chart-type-group" key={group.name}>
              <span className="nb-chart-config-label">{group.name}</span>
              <div className="nb-chart-type-buttons">
                {group.items
                  .filter(
                    (item) =>
                      !fullResult ||
                      (item.mark !== "sankey" && item.mark !== "funnel"),
                  )
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="nb-chart-type"
                      aria-pressed={item.isActive(spec)}
                      disabled={readOnly}
                      onClick={() => {
                        onChange?.({
                          chartSpec: {
                            ...item.patch,
                            ...(countRecords &&
                            item.mark !== "bar" &&
                            item.mark !== "line" &&
                            item.mark !== "area" &&
                            item.mark !== "heatmap"
                              ? { countRecords: false, yAggregation: undefined }
                              : {}),
                          },
                        });
                        setTypePickerOpen(false);
                      }}
                    >
                      {chartTypeItemLabel(item, t)}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="nb-chart-config-row">
        <ChartSelect
          label={t(
            spec.mark === "sankey"
              ? "notebook.sankey.source"
              : spec.mark === "gantt"
                ? "visualization.charts.ganttTask"
                : "notebook.chartXAxis",
          )}
          value={shownX ?? ""}
          disabled={readOnly || columnNames.length === 0}
          options={[
            {
              value: "",
              label: t(explicitAxes ? "chartData.noX" : "chartAxis.none"),
            },
            ...columnOptions,
          ]}
          onChange={(value) =>
            onChange?.({ chartSpec: { xField: value || null } })
          }
        />
        {timeUnit != null ? (
          <ChartSelect
            label={t("chartAxis.timeUnit")}
            value={timeUnit}
            disabled={readOnly}
            options={chartTimeUnitSchema.options.map((value) => ({
              value,
              label: t(
                value === "none"
                  ? "chartAxis.none"
                  : `chartAxis.timeUnits.${value}`,
              ),
            }))}
            onChange={(xTimeUnit) => onChange?.({ chartSpec: { xTimeUnit } })}
          />
        ) : null}
        {spec.mark === "sankey" ? (
          <ChartSelect
            label={t("notebook.sankey.target")}
            value={targetField ?? ""}
            disabled={readOnly || columnNames.length === 0}
            options={[
              { value: "", label: t("notebook.sankey.chooseTarget") },
              ...columnOptions,
            ]}
            onChange={(value) =>
              onChange?.({ chartSpec: { seriesField: value || null } })
            }
          />
        ) : null}
        {spec.mark === "heatmap" ? (
          <ChartSelect
            label={t("notebook.chartYAxis")}
            value={targetField ?? ""}
            disabled={readOnly || columnNames.length === 0}
            options={[
              { value: "", label: t("chartAxis.none") },
              ...columnOptions,
            ]}
            onChange={(value) =>
              onChange?.({ chartSpec: { seriesField: value || null } })
            }
          />
        ) : null}
        {spec.mark === "bar" ||
        spec.mark === "line" ||
        spec.mark === "area" ||
        spec.mark === "combo" ||
        spec.mark === "gantt" ? (
          <ChartSelect
            label={colorLabel}
            value={targetField ?? ""}
            disabled={
              readOnly ||
              columnNames.length === 0 ||
              (multipleMeasures && !targetField)
            }
            options={[
              { value: "", label: t("chartAxis.none") },
              ...columnOptions.map((option) => ({
                ...option,
                disabled: multipleMeasures,
              })),
            ]}
            onChange={(value) =>
              onChange?.({ chartSpec: { seriesField: value || null } })
            }
          />
        ) : null}
        {spec.mark === "histogram" ? (
          <label className="nb-chart-config-field">
            <span className="nb-chart-config-label">
              {t("visualization.charts.bins")}
            </span>
            <input
              className="nb-chart-select"
              aria-label={t("visualization.charts.bins")}
              type="number"
              min={2}
              max={100}
              placeholder={t("visualization.charts.binsAuto")}
              value={
                binsText ?? (spec.binCount != null ? String(spec.binCount) : "")
              }
              disabled={readOnly}
              onChange={(event) => {
                const raw = event.target.value;
                setBinsText(raw);
                if (raw.trim() === "") {
                  onChange?.({ chartSpec: { binCount: undefined } });
                  return;
                }
                if (/^\d+$/.test(raw.trim())) {
                  const parsed = Number.parseInt(raw.trim(), 10);
                  if (parsed >= 2 && parsed <= 100) {
                    onChange?.({ chartSpec: { binCount: parsed } });
                  }
                }
              }}
              onBlur={() => setBinsText(null)}
            />
          </label>
        ) : (
          <ChartSelect
            label={t(
              spec.mark === "sankey"
                ? "notebook.sankey.value"
                : spec.mark === "heatmap"
                  ? "notebook.chartValueLabel"
                  : spec.mark === "gantt"
                    ? "visualization.charts.ganttStart"
                    : "notebook.chartYAxis",
            )}
            value={
              countRecords
                ? countRecordsOption
                : shownY === null
                  ? ""
                  : measureOption(shownY)
            }
            disabled={readOnly || columnNames.length === 0}
            options={[
              {
                value: "",
                label: t(explicitAxes ? "chartData.noY" : "chartAxis.none"),
              },
              ...(explicitAxes && aggregates && spec.mark !== "combo"
                ? [
                    {
                      value: countRecordsOption,
                      label: t("chartData.countRecords"),
                    },
                  ]
                : []),
              ...columnOptions.map(({ value, label }) => ({
                value: measureOption(value),
                label,
              })),
            ]}
            onChange={(value) => {
              const measure = columnNames.find(
                (name) => measureOption(name) === value,
              );
              const nextY = measure ?? null;
              const comboYFields =
                spec.mark === "combo"
                  ? nextY && shownSecondaryY && nextY !== shownSecondaryY
                    ? [nextY, shownSecondaryY]
                    : []
                  : undefined;
              onChange?.({
                chartSpec: {
                  yField: nextY,
                  ...(comboYFields !== undefined
                    ? { yFields: comboYFields }
                    : spec.yFields
                      ? { yFields: [] }
                      : {}),
                  ...(explicitAxes
                    ? {
                        yAggregation: undefined,
                        countRecords: value === countRecordsOption,
                      }
                    : {}),
                },
              });
            }}
          />
        )}
        {spec.mark === "combo" ? (
          <ChartSelect
            label={t("visualization.charts.secondaryYAxis")}
            value={shownSecondaryY ?? ""}
            disabled={readOnly || columnNames.length === 0}
            options={[
              { value: "", label: t("chartAxis.none") },
              ...columnOptions,
            ]}
            onChange={(value) => {
              const secondary = value || null;
              onChange?.({
                chartSpec: {
                  secondaryYField: secondary,
                  yFields:
                    shownY && secondary && shownY !== secondary
                      ? [shownY, secondary]
                      : [],
                },
              });
            }}
          />
        ) : null}
        {spec.mark === "gantt" ? (
          <ChartSelect
            label={t("visualization.charts.ganttEnd")}
            value={shownEnd ?? ""}
            disabled={readOnly || columnNames.length === 0}
            options={[
              { value: "", label: t("chartAxis.none") },
              ...columnOptions,
            ]}
            onChange={(value) =>
              onChange?.({ chartSpec: { endField: value || null } })
            }
          />
        ) : null}
        {aggregation !== null ? (
          <ChartSelect
            label={t("chartAxis.aggregation")}
            value={aggregation}
            disabled={readOnly}
            options={chartAggregationsForType(
              columns.find((column) => column.name === shownY)?.type,
              chartAggregationSchema.options,
            ).map((value) => ({
              value,
              label: t(
                value === "none"
                  ? "chartAxis.none"
                  : `chartAxis.aggregations.${value}`,
              ),
            }))}
            onChange={(yAggregation) =>
              onChange?.({ chartSpec: { yAggregation } })
            }
          />
        ) : null}
        {spec.mark === "bar" && !explicitAxes ? (
          <label className="nb-input-settings-checkbox">
            <input
              type="checkbox"
              checked={spec.stacked === true}
              disabled={readOnly}
              onChange={(event) =>
                onChange?.({
                  chartSpec: { stacked: event.currentTarget.checked },
                })
              }
            />
            {t("notebook.chartStacked")}
          </label>
        ) : null}
        {(spec.mark === "bar" ||
          spec.mark === "line" ||
          spec.mark === "area") &&
        shownY &&
        additionalMeasures.length > 0 ? (
          <details className="nb-input-settings">
            <summary className="nb-input-settings-summary">
              {t("notebook.additionalMeasures")}
            </summary>
            {additionalMeasures.map((column) => {
              const selected = spec.yFields?.includes(column.name) ?? false;
              return (
                <label className="nb-input-settings-checkbox" key={column.name}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={
                      readOnly ||
                      (fullResult && targetField !== null && !selected)
                    }
                    onChange={(event) => {
                      const current = spec.yFields?.length
                        ? spec.yFields
                        : [shownY];
                      const yFields = event.currentTarget.checked
                        ? [...new Set([...current, column.name])]
                        : current.filter((field) => field !== column.name);
                      onChange?.({ chartSpec: { yField: shownY, yFields } });
                    }}
                  />
                  {fieldLabel(column.name)}
                </label>
              );
            })}
          </details>
        ) : null}
        <ChartTitleField
          title={spec.title ?? null}
          placeholder={explicitAxes ? t("chartData.addTitle") : undefined}
          disabled={readOnly}
          onCommit={(title) => onChange?.({ chartSpec: { title } })}
        />
      </div>

      <details className="nb-input-settings">
        <summary className="nb-input-settings-summary">
          {t("notebook.chartAppearance")}
        </summary>
        <label className="nb-chart-config-field">
          <span className="nb-chart-config-label">
            {t("notebook.chartPalette")}
          </span>
          <input
            key={(spec.colors ?? []).join(",")}
            className="nb-chart-select"
            type="text"
            aria-label={t("notebook.chartPalette")}
            placeholder={t("notebook.chartPalettePlaceholder")}
            defaultValue={(spec.colors ?? []).join(", ")}
            disabled={readOnly}
            onChange={(event) => event.currentTarget.setCustomValidity("")}
            onBlur={(event) => {
              const input = event.currentTarget;
              const colors =
                input.value.trim() === ""
                  ? []
                  : input.value.split(",").map((color) => color.trim());
              if (colors.some((color) => !/^#[0-9a-fA-F]{6}$/.test(color))) {
                input.setCustomValidity(t("notebook.chartPaletteInvalid"));
                input.reportValidity();
                return;
              }
              onChange?.({ chartSpec: { colors } });
            }}
          />
        </label>
        <ChartSelect
          label={t("notebook.chartValueFormat")}
          value={spec.yFormatter ?? "number"}
          disabled={readOnly}
          options={[
            { value: "number", label: t("notebook.chartFormatNumber") },
            { value: "percent", label: t("notebook.chartFormatPercent") },
          ]}
          onChange={(yFormatter) => onChange?.({ chartSpec: { yFormatter } })}
        />
        {legendAlwaysDrawn ||
        spec.mark === "bar" ||
        spec.mark === "line" ||
        spec.mark === "area" ||
        spec.mark === "combo" ||
        spec.mark === "scatter" ||
        spec.mark === "gantt" ? (
          <label className="nb-input-settings-checkbox">
            <input
              type="checkbox"
              checked={showLegend}
              disabled={readOnly}
              onChange={(event) =>
                onChange?.({
                  chartSpec: { legend: event.currentTarget.checked },
                })
              }
            />
            {t("notebook.chartLegend")}
          </label>
        ) : null}
        {explicitAxes && aggregates ? (
          <label className="nb-input-settings-checkbox">
            <input
              type="checkbox"
              checked={spec.tooltipChannels !== false}
              disabled={readOnly}
              onChange={(event) =>
                onChange?.({
                  chartSpec: { tooltipChannels: event.currentTarget.checked },
                })
              }
            />
            {t("chartData.tooltipChannels")}
          </label>
        ) : null}
      </details>

      {explicitAxes ? (
        <div className="nb-chart-type-buttons">
          <button
            className="nb-chart-type"
            type="button"
            aria-pressed={!table}
            onClick={() => setTable(false)}
          >
            {t("chartData.chart")}
          </button>
          <button
            className="nb-chart-type"
            type="button"
            aria-pressed={table}
            onClick={() => setTable(true)}
          >
            {t("chartData.table")}
          </button>
        </div>
      ) : null}
      {showingSaved ? (
        <p className="nb-side-panel-note">
          Showing the saved result.
          {dataframes.length > 0
            ? " Choose a dataframe to edit how this chart is drawn."
            : ""}
        </p>
      ) : null}
      {renderResult ? (
        renderResult(table)
      ) : resolution.status === "error" ? (
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
      ) : selected == null ? (
        <p className="nb-side-panel-note">
          {dataframes.length === 0
            ? "No dataframes yet. Run a SQL or Python cell to create one."
            : "Choose a dataframe to draw the chart from."}
        </p>
      ) : series.rows.length === 0 ? (
        <p className="nb-side-panel-note">
          {t(
            explicitAxes &&
              shownX !== null &&
              (spec.mark === "histogram" ||
                (spec.mark === "gantt"
                  ? shownY !== null && shownEnd !== null
                  : shownY !== null || countRecords))
              ? "chartData.noData"
              : "chartData.chooseAxes",
          )}
        </p>
      ) : table ? (
        <CellOutputView
          columnFormats={series.columns.map((_, index) =>
            index === 0 ? null : (spec.yFormatter ?? "number"),
          )}
          output={{
            type: "table",
            columns: series.columns.map((name, index) => ({
              name:
                countRecords && index === 1 && !series.encoding?.colorField
                  ? t("chartData.countRecords")
                  : name,
              type: index === 0 ? "string" : "number",
            })),
            rows: series.rows.map(([x, ...values]) => [
              timeUnit !== null && typeof x === "number"
                ? new Date(x).toISOString()
                : (x ?? null),
              ...values,
            ]),
            rowCount: series.rows.length,
            truncated: selected.truncated ?? false,
          }}
        />
      ) : (
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
      )}
    </div>
  );
}

function ChartTitleField({
  title,
  placeholder,
  disabled,
  onCommit,
}: {
  title: string | null;
  placeholder: string | undefined;
  disabled: boolean;
  onCommit: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [title]);
  const commit = () => {
    if (draft === null) return;
    const next = draft.trim() === "" ? null : draft;
    if (next === title) setDraft(null);
    else onCommit(next);
  };
  return (
    <label className="nb-chart-config-field">
      <span className="nb-chart-config-label">Title</span>
      <input
        className="nb-chart-select"
        aria-label="Chart title"
        type="text"
        value={draft ?? title ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ChartSelect<Value extends string>({
  options,
  value,
  ...props
}: Parameters<typeof InputSelect<Value>>[0]) {
  return (
    <div className="nb-chart-config-field">
      <span className="nb-chart-config-label">{props.label}</span>
      <InputSelect
        {...props}
        options={options}
        value={
          options.some((option) => option.value === value)
            ? value
            : options[0]?.value
        }
      />
    </div>
  );
}
