import type { ProjectDocument } from "../app/lib/model/contracts.js";
import { emptyAppLayout, projectAppLayout } from "./app-layout.js";
import { linkedInputRange } from "./input-range.js";

export function appResultCellIds(
  project: ProjectDocument,
  bookmark: string | null,
  canViewSource: boolean,
) {
  const layout = project.appLayout;
  const placed = new Set(
    layout
      ? projectAppLayout(layout, bookmark, canViewSource).rows.flatMap(
          ({ columns }) =>
            columns.flatMap(({ elements }) =>
              elements
                .filter(({ display }) => display !== "source")
                .map(({ cellId }) => cellId),
            ),
        )
      : project.cells
          .filter(({ contents }) => !contents.hidden)
          .map(({ id }) => id),
  );
  const sourceIds = new Set<string>();
  const variables = new Set<string>();
  for (const { id, contents } of project.cells) {
    if (!placed.has(id)) continue;
    if (contents.kind === "chart") {
      if (contents.chartSpec.sourceCellId)
        sourceIds.add(contents.chartSpec.sourceCellId);
      else if (contents.dataframe) variables.add(contents.dataframe);
    } else if (contents.kind === "display-table") {
      if (contents.tableConfig?.source)
        sourceIds.add(contents.tableConfig.source.cellId);
      else if (!contents.tableConfig && contents.dataframe)
        variables.add(contents.dataframe);
    } else if (contents.kind === "pivot" && contents.pivotConfig?.source) {
      sourceIds.add(contents.pivotConfig.source.cellId);
    } else if (
      contents.kind === "metric" &&
      !contents.metricConfig &&
      contents.valueVariableName
    ) {
      variables.add(contents.valueVariableName);
    }
  }
  for (const { id, contents } of project.cells) {
    if (
      (contents.kind === "sql" || contents.kind === "code") &&
      (sourceIds.has(id) ||
        (contents.resultVariable && variables.has(contents.resultVariable)))
    )
      placed.add(id);
  }
  return placed;
}

export function appViewerCellIds(project: ProjectDocument) {
  const visible = new Set(
    (project.appLayout?.tabs.map(({ tabId }) => tabId) ?? [null]).flatMap(
      (tabId) => [...appResultCellIds(project, tabId, false)],
    ),
  );
  for (const cell of project.cells) {
    if (!visible.has(cell.id)) continue;
    const range = linkedInputRange(project.cells, cell);
    if (range) {
      visible.add(range.start.id);
      visible.add(range.end.id);
    }
  }
  return visible;
}

export function appViewerDocument(
  project: ProjectDocument,
  visibleIds: Set<string>,
): ProjectDocument {
  const layout = project.appLayout;
  const {
    draftHead: _draftHead,
    publishedHead: _publishedHead,
    orderRevision: _orderRevision,
    ...document
  } = project;
  const tabs = layout?.tabs.flatMap(({ tabId, rows: originalRows }) => {
    const { tab, rows } = projectAppLayout(layout, tabId, false);
    return originalRows.length > 0 && rows.length === 0
      ? []
      : [
          {
            ...tab,
            rows: rows.map(({ rowId, columns }) => ({ rowId, columns })),
          },
        ];
  });
  return {
    ...document,
    collectionIds: [],
    workingVersionId: project.publishedVersionId ?? project.workingVersionId,
    cells: project.cells
      .filter(({ id }) => visibleIds.has(id))
      .map((cell) => {
        const { contents } = cell;
        if (contents.kind === "sql") {
          const {
            pendingEdit: _pendingEdit,
            connectionSelectedAt: _connectionSelectedAt,
            ...safe
          } = contents;
          return {
            ...cell,
            contents: {
              ...safe,
              source: "",
              dataConnectionId: null,
              databaseSchema: null,
            },
          };
        }
        if (contents.kind === "code")
          return { ...cell, contents: { ...contents, source: "" } };
        if (contents.kind === "chart") {
          const { drilldownSql: _drilldownSql, ...safe } = contents;
          return { ...cell, contents: safe };
        }
        return cell;
      }),
    ...(layout
      ? {
          appLayout: {
            ...layout,
            tabs: tabs?.length ? tabs : emptyAppLayout(layout.revision).tabs,
          },
        }
      : {}),
  };
}
