import {
  actionErrorCode,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useDeferredValue, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Cell } from "@/lib/model/contracts";

import {
  sharedQueryableGranularities,
  type dbtSemanticMetricsOutput,
  type queryDbtSemanticMetricsOutput,
} from "../../../shared/dbt-semantic-metrics";
import type { NotebookConnection } from "./types";
import { toNotebookError } from "./utils";

type DbtMetricContents = Extract<Cell["contents"], { kind: "dbt-metric" }>;
type Catalog = ReturnType<typeof dbtSemanticMetricsOutput.parse>;
type CatalogMetric = Catalog["items"][number];
type CatalogDimension = CatalogMetric["dimensions"][number];
type QueryResult = ReturnType<typeof queryDbtSemanticMetricsOutput.parse>;
type Grain = NonNullable<DbtMetricContents["selectedTimegrain"]>;

const ROW_LIMIT = 1000;
const RENDERED_ROWS = 200;
const TIME_DIMENSION = "metric_time";
const selectClass =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";

export function sharedDimensions(
  metrics: readonly CatalogMetric[],
): CatalogDimension[] {
  const [first, ...rest] = metrics;
  if (!first) return [];
  return first.dimensions.filter((dimension) =>
    rest.every((metric) =>
      metric.dimensions.some(({ name }) => name === dimension.name),
    ),
  );
}

function timeDimensionOf(dimensions: readonly CatalogDimension[]) {
  const time = dimensions.filter(({ type }) => type === "TIME");
  return time.find(({ name }) => name === TIME_DIMENSION) ?? time[0];
}

const ERROR_COPY: Record<string, string> = {
  dbt_semantic_configuration_invalid: "dbtMetricCell.errors.notEnabled",
  dbt_semantic_connection_unavailable: "dbtMetricCell.errors.unavailable",
  data_connection_not_found: "dbtMetricCell.errors.unavailable",
  data_connection_ai_disabled: "dbtMetricCell.errors.notIncluded",
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function DbtMetricCell({
  cell,
  contents: savedContents,
  canEdit,
  connections,
  onSaveContents,
  onDuplicateAsSql,
}: {
  cell: Cell;
  contents: DbtMetricContents;
  canEdit: boolean;
  connections: readonly NotebookConnection[];
  onSaveContents?:
    | ((contents: Cell["contents"]) => void | Promise<unknown>)
    | undefined;
  onDuplicateAsSql?: ((sql: string, connectionId: string) => void) | undefined;
}) {
  const t = useT();
  const [optimistic, setOptimistic] = useState<DbtMetricContents | null>(null);
  const contents = optimistic ?? savedContents;
  const [search, setSearch] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const connectionId = contents.dataConnectionId;
  const listKey = JSON.stringify([connectionId, deferredSearch]);
  const listed = useRef<{ key: string; pages: Map<number, CatalogMetric[]> }>({
    key: listKey,
    pages: new Map(),
  });
  if (listed.current.key !== listKey) {
    listed.current = { key: listKey, pages: new Map() };
    if (pageNum !== 1) setPageNum(1);
  }
  const catalogQuery = useActionQuery<Catalog>(
    "list-dbt-semantic-metrics",
    {
      connectionId: connectionId ?? "",
      pageSize: 100,
      ...(pageNum > 1 ? { pageNum } : {}),
      ...(deferredSearch ? { search: deferredSearch } : {}),
    },
    { enabled: connectionId !== null },
  );
  if (catalogQuery.data && catalogQuery.data.pageNum === pageNum)
    listed.current.pages.set(pageNum, catalogQuery.data.items);
  const run = useActionMutation<
    QueryResult,
    unknown,
    "query-dbt-semantic-metrics"
  >("query-dbt-semantic-metrics", { errorNotification: "caller" });

  const errorMessage = (error: Error | null) => {
    const key = ERROR_COPY[actionErrorCode(error) ?? ""];
    return key ? t(key) : toNotebookError(error).message;
  };
  const catalog = [...listed.current.pages.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, items]) => items);
  const hasMorePages =
    catalogQuery.data !== undefined &&
    catalogQuery.data.pageNum === pageNum &&
    pageNum < catalogQuery.data.totalPages;
  const known = useRef({
    connectionId,
    metrics: new Map<string, CatalogMetric>(),
  });
  if (known.current.connectionId !== connectionId)
    known.current = { connectionId, metrics: new Map() };
  for (const metric of catalog) known.current.metrics.set(metric.name, metric);
  const metricNamed = (name: string) => known.current.metrics.get(name);
  const chosenOf = (names: readonly string[]) =>
    names.flatMap((name) => metricNamed(name) ?? []);
  const chosen = chosenOf(contents.metrics);
  const dimensions = sharedDimensions(chosen);
  const timeDimension = timeDimensionOf(dimensions);
  const grains = timeDimension ? sharedQueryableGranularities(chosen) : [];
  const categorical = dimensions.filter(({ type }) => type !== "TIME");
  const canChange =
    canEdit && onSaveContents !== undefined && optimistic === null;

  function save(patch: Partial<DbtMetricContents>) {
    if (!canChange) return;
    const next = { ...contents, ...patch };
    setOptimistic(next);
    const settle = () =>
      setOptimistic((current) => (current === next ? null : current));
    void Promise.resolve(onSaveContents(next)).then(settle, settle);
  }

  function toggleMetric(name: string, checked: boolean) {
    const metrics = checked
      ? [...contents.metrics, name]
      : contents.metrics.filter((metric) => metric !== name);
    const next = chosenOf(metrics);
    const stillShared = sharedDimensions(next);
    const stillGrains = timeDimensionOf(stillShared)
      ? sharedQueryableGranularities(next)
      : [];
    save({
      metrics,
      selectedDimensions: contents.selectedDimensions.filter((dimension) =>
        stillShared.some(({ name: shared }) => shared === dimension),
      ),
      selectedTimegrain:
        contents.selectedTimegrain &&
        stillGrains.includes(contents.selectedTimegrain)
          ? contents.selectedTimegrain
          : null,
    });
  }

  function toggleDimension(name: string, checked: boolean) {
    save({
      selectedDimensions: checked
        ? [...contents.selectedDimensions, name]
        : contents.selectedDimensions.filter((dimension) => dimension !== name),
    });
  }

  function queryRequest() {
    if (connectionId === null || contents.metrics.length === 0) return null;
    const groupBy = [
      ...(contents.selectedTimegrain
        ? [
            {
              name: timeDimension?.name ?? TIME_DIMENSION,
              grain: contents.selectedTimegrain,
            },
          ]
        : []),
      ...[...new Set(contents.selectedDimensions)].map((name) => ({ name })),
    ];
    return {
      connectionId,
      metrics: [...new Set(contents.metrics)].map((name) => ({ name })),
      ...(groupBy.length > 0 ? { groupBy } : {}),
      limit: ROW_LIMIT,
    };
  }

  function runQuery() {
    const request = queryRequest();
    if (request) run.mutate(request);
  }

  const current =
    run.variables !== undefined &&
    JSON.stringify(run.variables) === JSON.stringify(queryRequest());
  const result = current ? run.data : undefined;
  const sql = result?.sql ?? null;

  return (
    <div
      className="flex min-w-0 flex-col gap-3 p-3 text-sm"
      data-cell-kind="dbt-metric"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{t("dbtMetricCell.title")}</span>
        <label className="flex min-w-0 max-w-full items-center gap-2">
          <span className="text-muted-foreground">
            {t("dbtMetricCell.connection")}
          </span>
          <select
            aria-label={t("dbtMetricCell.connection")}
            className={selectClass}
            disabled={!canChange}
            value={connectionId ?? ""}
            onChange={(event) =>
              save({
                dataConnectionId: event.target.value || null,
                metrics: [],
                selectedDimensions: [],
                selectedTimegrain: null,
              })
            }
          >
            <option value="">{t("dbtMetricCell.chooseConnection")}</option>
            {connectionId !== null &&
            !connections.some(({ id }) => id === connectionId) ? (
              <option value={connectionId}>{connectionId}</option>
            ) : null}
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {connections.length === 0 ? (
        <p className="text-muted-foreground">
          {t("dbtMetricCell.noConnections")}
        </p>
      ) : null}

      {connectionId !== null ? (
        <section aria-label={t("dbtMetricCell.metrics")} className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="font-medium">{t("dbtMetricCell.metrics")}</h4>
            <Input
              aria-label={t("dbtMetricCell.searchMetrics")}
              className="h-8 max-w-60"
              placeholder={t("dbtMetricCell.searchMetrics")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {catalogQuery.isError ? (
            <p role="alert" className="text-destructive">
              {errorMessage(catalogQuery.error)}
            </p>
          ) : null}
          {catalog.length === 0 ? (
            catalogQuery.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : catalogQuery.isError ? null : (
              <p className="text-muted-foreground">
                {t("dbtMetricCell.noMetrics")}
              </p>
            )
          ) : (
            <ul className="max-h-48 space-y-1 overflow-auto">
              {catalog.map((metric) => (
                <li key={metric.name} className="flex items-baseline gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={contents.metrics.includes(metric.name)}
                      disabled={!canChange}
                      onChange={(event) =>
                        toggleMetric(metric.name, event.target.checked)
                      }
                    />
                    {metric.name}
                  </label>
                  {metric.description ? (
                    <span className="truncate text-muted-foreground">
                      {metric.description}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {hasMorePages || (catalog.length > 0 && catalogQuery.isPending) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={catalogQuery.isPending}
              onClick={() => setPageNum(pageNum + 1)}
            >
              {t("dbtMetricCell.showMore")}
            </Button>
          ) : null}
        </section>
      ) : null}

      {chosen.length > 0 ? (
        <section
          aria-label={t("dbtMetricCell.groupBy")}
          className="flex flex-wrap items-start gap-6"
        >
          {timeDimension && grains.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {t("dbtMetricCell.timeGrain")}
              </span>
              <select
                aria-label={t("dbtMetricCell.timeGrain")}
                className={selectClass}
                disabled={!canChange}
                value={contents.selectedTimegrain ?? ""}
                onChange={(event) =>
                  save({
                    selectedTimegrain: (event.target.value ||
                      null) as Grain | null,
                  })
                }
              >
                <option value="">{t("dbtMetricCell.noTimeGrain")}</option>
                {grains.map((grain) => (
                  <option key={grain} value={grain}>
                    {grain}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {categorical.length > 0 ? (
            <fieldset className="min-w-0 space-y-1">
              <legend className="text-muted-foreground">
                {t("dbtMetricCell.dimensions")}
              </legend>
              {categorical.map((dimension) => (
                <div key={dimension.name}>
                  <label className="flex items-start gap-2 break-all">
                    <input
                      className="mt-1 shrink-0"
                      type="checkbox"
                      checked={contents.selectedDimensions.includes(
                        dimension.name,
                      )}
                      disabled={!canChange}
                      onChange={(event) =>
                        toggleDimension(dimension.name, event.target.checked)
                      }
                    />
                    {dimension.name}
                  </label>
                </div>
              ))}
            </fieldset>
          ) : null}
        </section>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={
            connectionId === null ||
            contents.metrics.length === 0 ||
            run.isPending
          }
          onClick={runQuery}
        >
          {run.isPending ? t("dbtMetricCell.running") : t("dbtMetricCell.run")}
        </Button>
        {sql && connectionId !== null && onDuplicateAsSql ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDuplicateAsSql(sql, connectionId)}
          >
            {t("dbtMetricCell.duplicateAsSql")}
          </Button>
        ) : null}
        {connectionId !== null && contents.metrics.length === 0 ? (
          <span className="text-muted-foreground">
            {t("dbtMetricCell.chooseMetric")}
          </span>
        ) : null}
      </div>

      {run.isError && current ? (
        <p role="alert" className="text-destructive">
          {errorMessage(run.error)}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2">
          {result.rows.length === 0 ? (
            <p className="text-muted-foreground">{t("dbtMetricCell.noRows")}</p>
          ) : (
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {result.fields.map((field) => (
                      <th key={field.name} className="px-2 py-1 font-medium">
                        {field.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, RENDERED_ROWS).map((row, index) => (
                    <tr key={index} className="border-t">
                      {result.fields.map((field) => (
                        <td key={field.name} className="px-2 py-1">
                          {cellText(row[field.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.hasMore || result.rows.length > RENDERED_ROWS ? (
            <p className="text-muted-foreground">
              {t("dbtMetricCell.resultsTruncated", {
                count: Math.min(result.rows.length, RENDERED_ROWS),
              })}
            </p>
          ) : null}
          {sql ? (
            <details>
              <summary>{t("dbtMetricCell.generatedSql")}</summary>
              <pre className="overflow-auto rounded-md bg-muted p-2 text-xs">
                {sql}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
