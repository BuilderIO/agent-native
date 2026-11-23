import { useOptionalLocale, useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import {
  IconChartBar,
  IconChevronRight,
  IconListDetails,
  IconLoader2,
} from "@tabler/icons-react";
import { useId, useState } from "react";

import {
  CellOutputView,
  formatPublishedValue,
} from "@/components/notebook/CellOutputView";
import {
  projectChartDataframes,
  type ChartDataframe,
} from "@/components/notebook/chart-config";
import { ComponentImportBody } from "@/components/notebook/ComponentImportBody";
import { isRenderableInput } from "@/components/notebook/InputCellControl";
import { MarkdownCellView } from "@/components/notebook/MarkdownCellView";
import { CompleteMetricView } from "@/components/notebook/MetricCell";
import { PivotCell } from "@/components/notebook/PivotCell";
import { PythonCellOutput } from "@/components/notebook/PythonCellOutput";
import { ReadOnlyChart } from "@/components/notebook/ReadOnlyChart";
import { TableCell } from "@/components/notebook/TableCell";
import type {
  LoadResultPage,
  NotebookCellOutputState,
  VisualizationViewScope,
} from "@/components/notebook/types";
import { cellTitleAtPosition } from "@/components/notebook/utils";
import { VegaSpecChart } from "@/components/notebook/VegaChart";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notebookMessages } from "@/i18n/messages/notebook";
import type { Cell, CellOutput } from "@/lib/model/contracts";
import {
  DEFAULT_PROJECT_GRID_HEIGHT,
  projectGridLayout,
} from "@/lib/model/project-layout";

import type getNotebookInputChoices from "../../../actions/get-notebook-input-choices";
import {
  projectAppLayout,
  publishedElementMinHeight,
  type AppDocument,
} from "../../../shared/app-layout";
import type { AppSessionProjection } from "../../../shared/app-session-operations";
import { linkedInputRange } from "../../../shared/input-range";
import {
  PublishedInputControl,
  type InputUpdate,
} from "./PublishedInputControl";

import "./app-layout-snapshot.css";

type ChartPoint = { x: string; series: string };
type ChoiceRead = Awaited<ReturnType<typeof getNotebookInputChoices.run>>;
type AppCellOutputState = NotebookCellOutputState &
  Pick<AppSessionProjection["projection"]["outputs"][string], "resultStatus">;
type AppInputChange = (
  cell: Cell,
  value: string,
  optionsResultId?: string,
) => void;

const LEGACY_MIN_ROW_HEIGHT_PX = 80;
const LEGACY_ROW_GAP_PX = 24;

function publishedCellCardClassName({ contents }: Cell) {
  return contents.kind === "metric" && contents.metricConfig
    ? "nb-app-grid-card app-snapshot-element flex flex-col"
    : "nb-app-grid-card app-snapshot-element";
}

export function AppLayoutSnapshot({
  cells,
  visualizationScope,
  resultIds,
  metricSourceResultIds,
  outputs,
  layout,
  tabBookmark,
  embeddedCell,
  onTabChange,
  runningTabIds,
  canViewSource,
  values,
  onChangeValue,
  onCommitValue,
  onCommitValues,
  inputChoices,
  onLoadPage,
  onMarkClick,
  canDrill,
}: {
  cells: readonly Cell[];
  visualizationScope?: VisualizationViewScope | undefined;
  resultIds?: Readonly<Record<string, string | null>>;
  metricSourceResultIds?: Readonly<Record<string, string>> | undefined;
  outputs: Readonly<Record<string, AppCellOutputState | undefined>>;
  layout: AppDocument | undefined;
  tabBookmark: string | null;
  embeddedCell?: { cellId: string; showLabel: boolean } | null | undefined;
  onTabChange: (tabId: string) => void;
  runningTabIds?: ReadonlySet<string>;
  canViewSource: boolean;
  values: Record<string, string>;
  onChangeValue?: AppInputChange;
  onCommitValue?: AppInputChange;
  onCommitValues?: (updates: InputUpdate[]) => void;
  inputChoices?: Readonly<Record<string, ChoiceRead>>;
  onLoadPage?: LoadResultPage;
  onMarkClick?: (cell: Cell, point: ChartPoint) => void;
  canDrill?: (cell: Cell) => boolean;
}) {
  const t = useT();
  const direction = useOptionalLocale()?.dir ?? "ltr";
  const elementPrefix = useId();
  const dataframes = projectChartDataframes(cells, outputs);
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const sourceOutputs = new Map(
    cells.flatMap((cell) => {
      const contents = cell.contents;
      const output = outputs[cell.id];
      return (contents.kind === "sql" || contents.kind === "code") &&
        contents.resultVariable &&
        output !== undefined
        ? [[contents.resultVariable, output] as const]
        : [];
    }),
  );
  const namedValues = new Map(
    cells.flatMap(({ id, contents }) =>
      contents.kind === "input"
        ? [[contents.name, values[id] ?? contents.defaultValueString] as const]
        : [],
    ),
  );

  function renderOutput(cell: Cell, showLabel: boolean) {
    const contents = cell.contents;
    const sourceCellId =
      contents.kind === "chart" ? contents.chartSpec.sourceCellId : undefined;
    const name =
      contents.kind === "chart" || contents.kind === "display-table"
        ? contents.dataframe
        : contents.kind === "metric" && !contents.metricConfig
          ? contents.valueVariableName
          : null;
    return (
      <PublishedCellView
        cell={cell}
        visualizationScope={visualizationScope}
        resultIds={resultIds}
        metricSourceResultId={metricSourceResultIds?.[cell.id]}
        state={
          outputs[cell.id] ??
          (sourceCellId
            ? outputs[sourceCellId]
            : name
              ? sourceOutputs.get(name)
              : undefined)
        }
        dataframes={dataframes}
        onMarkClick={
          onMarkClick && (!canDrill || canDrill(cell))
            ? (point) => onMarkClick(cell, point)
            : undefined
        }
        inputValues={values}
        range={linkedInputRange(cells, cell)}
        onCommitValues={onCommitValues}
        choices={inputChoices?.[cell.id]}
        namedValues={namedValues}
        onChangeValue={onChangeValue}
        onCommitValue={onCommitValue}
        onLoadPage={onLoadPage}
        showLabel={showLabel}
      />
    );
  }

  if (embeddedCell !== undefined) {
    const cell = embeddedCell ? byId.get(embeddedCell.cellId) : undefined;
    if (!embeddedCell || !cell) {
      return <p role="alert">{t("notebook.embed.unavailable")}</p>;
    }
    return (
      <div
        className={publishedCellCardClassName(cell)}
        data-published-cell={cell.id}
        data-app-label={embeddedCell.showLabel}
      >
        {renderOutput(cell, embeddedCell.showLabel)}
      </div>
    );
  }

  function renderEmpty(hasTabs: boolean) {
    return (
      <div className="grid justify-items-center gap-3 py-12 text-center">
        <span className="grid size-16 place-items-center rounded-full border text-muted-foreground">
          <IconListDetails size={28} aria-hidden="true" />
        </span>
        <p className="font-medium">
          {t(hasTabs ? "publishedApp.emptyTab" : "publishedApp.emptyLayout")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            hasTabs
              ? "publishedApp.emptyTabDetail"
              : "publishedApp.emptyLayoutDetail",
          )}
        </p>
      </div>
    );
  }
  if (!layout) {
    const legacy = projectGridLayout(
      cells.filter((cell) => !cell.contents.hidden),
    );
    return legacy.length ? (
      <div className="nb-published-grid">
        {legacy.map(({ cell, placement }) => (
          <div
            className={publishedCellCardClassName(cell)}
            key={cell.id}
            data-published-cell={cell.id}
            style={{
              gridColumn: `${placement.gridX + 1} / span ${placement.gridWidth}`,
              gridRow: `${placement.gridY + 1} / span ${placement.gridHeight}`,
              minHeight:
                placement.gridHeight === DEFAULT_PROJECT_GRID_HEIGHT
                  ? undefined
                  : placement.gridHeight * LEGACY_MIN_ROW_HEIGHT_PX +
                    (placement.gridHeight - 1) * LEGACY_ROW_GAP_PX,
            }}
          >
            {renderOutput(cell, true)}
          </div>
        ))}
      </div>
    ) : (
      renderEmpty(false)
    );
  }

  const { tab, rows } = projectAppLayout(layout, tabBookmark, canViewSource);
  const tocLabel = t("notebook.appBuilder.settings.toc", {
    defaultValue: notebookMessages.notebook.appBuilder.settings.toc,
  });
  const headings = new Map(
    cells.map(({ id, contents }, index) => [
      id,
      cellTitleAtPosition(contents, index + 1),
    ]),
  );
  const tocEntries = layout.settings.toc
    ? rows.flatMap(({ columns }) =>
        columns.flatMap(({ elements }) =>
          elements.flatMap(({ cellId, elementId, showLabel }) => {
            const title = headings.get(cellId);
            return showLabel && title
              ? [{ target: `${elementPrefix}-${elementId}`, title }]
              : [];
          }),
        ),
      )
    : [];
  const content = rows.length ? (
    <>
      {tocEntries.length > 0 && (
        <Collapsible className="mb-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="group text-muted-foreground"
            >
              <IconChevronRight
                aria-hidden="true"
                className="transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
              />
              {tocLabel}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <nav aria-label={tocLabel} className="ms-8 mt-1 grid gap-1 text-sm">
              {tocEntries.map(({ target, title }) => (
                <a
                  key={target}
                  href={`#${target}`}
                  className="w-fit rounded-sm py-0.5 text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {title}
                </a>
              ))}
            </nav>
          </CollapsibleContent>
        </Collapsible>
      )}
      <div className="app-snapshot-grid">
        {rows.map((row) => (
          <div className="app-snapshot-row" key={row.rowId}>
            {row.columns.map((column) => (
              <div
                className="app-snapshot-column"
                key={column.columnId}
                style={{
                  gridColumn: `${column.left + 1} / ${column.right + 1}`,
                }}
              >
                {column.elements.map((element) => {
                  const cell = byId.get(element.cellId);
                  if (!cell) return null;
                  const source =
                    cell.contents.kind === "sql" ||
                    cell.contents.kind === "code"
                      ? cell.contents.source
                      : undefined;
                  return (
                    <section
                      className={publishedCellCardClassName(cell)}
                      id={`${elementPrefix}-${element.elementId}`}
                      key={element.elementId}
                      data-published-cell={cell.id}
                      data-app-element={element.elementId}
                      data-app-display={element.display}
                      data-app-interval={`${column.left}:${column.right}`}
                      data-app-label={element.showLabel}
                      style={{
                        minHeight: publishedElementMinHeight(element, cell),
                      }}
                    >
                      {element.display !== "output" && source !== undefined ? (
                        <>
                          {element.display === "source" &&
                          element.showLabel &&
                          cell.contents.label ? (
                            <h2>{cell.contents.label}</h2>
                          ) : null}
                          <pre>{source}</pre>
                        </>
                      ) : null}
                      {element.display !== "source"
                        ? renderOutput(cell, element.showLabel)
                        : null}
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  ) : (
    renderEmpty(layout.tabs.length > 1)
  );

  if (layout.tabs.length === 1) return content;
  return (
    <Tabs dir={direction} value={tab.tabId} onValueChange={onTabChange}>
      <TabsList
        aria-label={t("publishedApp.tabs")}
        className="app-snapshot-tabs max-w-full justify-start overflow-x-auto"
      >
        {layout.tabs.map(({ tabId, name }) => {
          const running = runningTabIds?.has(tabId);
          return (
            <TabsTrigger
              value={tabId}
              key={tabId}
              className="max-w-full shrink-0 gap-1.5 focus-visible:ring-inset focus-visible:ring-offset-0"
              aria-busy={running || undefined}
            >
              {running ? (
                <IconLoader2
                  className="size-3.5 shrink-0 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate" title={name}>
                {name}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value={tab.tabId}>{content}</TabsContent>
    </Tabs>
  );
}

function PublishedCellView({
  cell,
  visualizationScope,
  resultIds,
  metricSourceResultId,
  state,
  dataframes,
  inputValues,
  range,
  onCommitValues,
  choices,
  namedValues,
  onChangeValue,
  onCommitValue,
  onLoadPage,
  onMarkClick,
  showLabel,
}: {
  cell: Cell;
  visualizationScope?: VisualizationViewScope | undefined;
  resultIds: Readonly<Record<string, string | null>> | undefined;
  metricSourceResultId: string | undefined;
  state: AppCellOutputState | undefined;
  dataframes: readonly ChartDataframe[];
  inputValues: Record<string, string>;
  range: ReturnType<typeof linkedInputRange>;
  onCommitValues: ((updates: InputUpdate[]) => void) | undefined;
  choices: ChoiceRead | undefined;
  namedValues: ReadonlyMap<string, string>;
  onChangeValue: AppInputChange | undefined;
  onCommitValue: AppInputChange | undefined;
  onLoadPage: LoadResultPage | undefined;
  onMarkClick?: ((point: ChartPoint) => void) | undefined;
  showLabel: boolean;
}) {
  const contents = cell.contents;
  const heading = showLabel ? contents.label : null;
  const output = state?.output;
  const pageProps = {
    loading: state?.artifactLoading === true,
    queryError: state?.artifactError === true,
    hasNextPage: state?.hasNextPage,
    queryRequestId: state?.pageRequestId,
    totalRows: state?.totalRows,
    onLoadPage,
  };
  const locale = useReaderLocale();
  const t = useT();

  if (contents.kind === "collapsible") {
    const title = contents.title ?? heading;
    return showLabel && title ? <h2>{title}</h2> : null;
  }

  if (contents.kind === "component-import") {
    return (
      <section>
        {heading ? (
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>{heading}</h2>
        ) : null}
        <ComponentImportBody
          componentId={contents.componentVersionId}
          title={contents.title}
        />
      </section>
    );
  }

  if (isRenderableInput(contents)) {
    return (
      <PublishedInputControl
        cell={cell}
        range={range}
        values={inputValues}
        choices={choices}
        onChange={onChangeValue}
        onCommit={onCommitValue}
        onCommitValues={onCommitValues}
      />
    );
  }
  if (contents.kind === "markdown" || contents.kind === "text") {
    const source =
      contents.kind === "markdown" ? contents.markdown : contents.text;
    const markdown = source.replace(
      /{{\s*([A-Za-z_][A-Za-z_0-9]*)\s*}}/g,
      (token, name: string) => namedValues.get(name) ?? token,
    );
    if (!heading && markdown.trim() === "") return null;
    return (
      <section>
        {heading ? (
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>{heading}</h2>
        ) : null}
        {markdown.trim() === "" ? null : (
          <MarkdownCellView markdown={markdown} />
        )}
      </section>
    );
  }

  const boundName =
    contents.kind === "display-table"
      ? contents.dataframe
      : contents.kind === "metric" && !contents.metricConfig
        ? contents.valueVariableName
        : null;
  const bound = dataframes.find((frame) => frame.name === boundName);
  function sourceResultId(sourceCellId: string | null | undefined) {
    return sourceCellId ? (resultIds?.[sourceCellId] ?? null) : null;
  }
  const pythonOutputs =
    contents.kind === "code" ? state?.pythonOutputs : undefined;
  const fallback = pythonOutputs?.length ? (
    <PythonCellOutput
      projectId={cell.projectId}
      cellId={cell.id}
      outputs={pythonOutputs}
      scope={visualizationScope}
      onLoadPage={
        onLoadPage ? (id, offset) => onLoadPage(offset, id) : undefined
      }
      canRepair={false}
    />
  ) : contents.kind === "sql" && state?.resultStatus === "failed" ? (
    <p className="text-muted-foreground">{t("publishedApp.noSqlResult")}</p>
  ) : output || state?.artifactLoading ? (
    <CellOutputView output={output} initialPageSize={25} {...pageProps} />
  ) : (
    <p className="text-muted-foreground">{t("publishedApp.noResult")}</p>
  );
  return (
    <section
      className={
        contents.kind === "metric" && contents.metricConfig
          ? "flex flex-1 flex-col"
          : undefined
      }
    >
      {heading ? (
        <h2 style={{ fontSize: 16, marginBottom: 6 }}>{heading}</h2>
      ) : null}
      {showLabel && contents.description ? (
        <PanelDescription text={contents.description} />
      ) : null}
      {contents.kind === "display-table" && contents.tableConfig ? (
        <TableCell
          cell={cell}
          config={contents.tableConfig}
          canEdit={false}
          scope={visualizationScope}
          sourceResultId={sourceResultId(contents.tableConfig.source?.cellId)}
        />
      ) : contents.kind === "display-table" && output?.type === "table" ? (
        <ConfiguredTable
          output={output}
          columns={contents.columns}
          pageProps={pageProps}
        />
      ) : contents.kind === "metric" && contents.metricConfig ? (
        <CompleteMetricView
          context={{
            projectId: cell.projectId,
            cellId: cell.id,
            versionId: cell.versionId,
          }}
          config={contents.metricConfig}
          scope={visualizationScope}
          sourceResultId={
            metricSourceResultId ??
            sourceResultId(contents.metricConfig.source?.cellId)
          }
          namedValues={namedValues}
        />
      ) : contents.kind === "metric" && bound ? (
        <p>
          {formatPublishedValue(
            bound.rows[contents.valueRowIndex ?? 0]?.[0] ?? "—",
            contents.format,
            locale,
          )}
        </p>
      ) : contents.kind === "pivot" && contents.pivotConfig ? (
        <PivotCell
          cell={cell}
          contents={contents}
          canEdit={false}
          scope={visualizationScope}
          sourceResultId={sourceResultId(contents.pivotConfig.source?.cellId)}
        />
      ) : contents.kind === "vega-chart" && contents.spec ? (
        <VegaSpecChart spec={contents.spec} />
      ) : contents.kind === "chart" ? (
        state?.resultStatus === "failed" ? (
          <div className="grid min-h-[220px] content-center justify-items-center gap-5 text-muted-foreground">
            <IconChartBar size={96} stroke={1} aria-hidden="true" />
            <p>{t("publishedApp.loadingChart")}</p>
          </div>
        ) : (
          <ReadOnlyChart
            context={{
              projectId: cell.projectId,
              cellId: cell.id,
              versionId: cell.versionId,
              scope: visualizationScope,
              sourceResultId: sourceResultId(contents.chartSpec.sourceCellId),
            }}
            dataframe={contents.dataframe}
            spec={contents.chartSpec}
            dataframes={dataframes}
            output={output?.type === "chart" ? output : null}
            fallback={fallback}
            onMarkClick={onMarkClick}
          />
        )
      ) : (
        fallback
      )}
    </section>
  );
}

function PanelDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const className = "mb-1.5 text-xs leading-normal text-muted-foreground";
  if (text.length <= 80 && !/[\r\n]/.test(text)) {
    return (
      <p data-panel-description="" className={className}>
        {text}
      </p>
    );
  }
  return (
    <button
      type="button"
      data-panel-description=""
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
      className={`${className} flex w-full items-start gap-1 text-start`}
    >
      <IconChevronRight
        size={13}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
        style={{ transform: expanded ? "rotate(90deg)" : undefined }}
      />
      <span
        className={expanded ? undefined : "truncate"}
        style={{ whiteSpace: expanded ? "pre-wrap" : "nowrap" }}
      >
        {text}
      </span>
    </button>
  );
}

function ConfiguredTable({
  output,
  columns,
  pageProps,
}: {
  output: Extract<CellOutput, { type: "table" }>;
  columns: Extract<Cell["contents"], { kind: "display-table" }>["columns"];
  pageProps: Omit<Parameters<typeof CellOutputView>[0], "output">;
}) {
  if (!columns.length)
    return (
      <CellOutputView output={output} initialPageSize={25} {...pageProps} />
    );
  const selected = columns.flatMap((column) => {
    if (column.hidden) return [];
    const index = output.columns.findIndex(
      (candidate) => candidate.name === column.name,
    );
    const source = output.columns[index];
    return source ? [{ column, index, source }] : [];
  });
  const projected = {
    ...output,
    columns: selected.map(({ column, source }) => ({
      ...source,
      name: column.header ?? column.name,
    })),
    rows: projectRows(output.rows),
  };
  function projectRows(rows: Extract<CellOutput, { type: "table" }>["rows"]) {
    return rows.map((row) => selected.map(({ index }) => row[index] ?? null));
  }
  const load = pageProps.onLoadPage;
  return (
    <CellOutputView
      output={projected}
      initialPageSize={25}
      {...pageProps}
      onLoadPage={
        load
          ? async (offset, id) => projectRows(await load(offset, id))
          : undefined
      }
      columnFormats={selected.map(({ column }) => column.format)}
    />
  );
}
