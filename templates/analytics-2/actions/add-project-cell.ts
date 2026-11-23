import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  ADDABLE_CELL_KINDS,
  PARAMETER_INPUT_TYPES,
} from "../app/lib/model/cell-types.js";
import {
  cellContentsSchema,
  cellIdSchema,
  cellKindSchema,
  withoutPendingCellEdit,
  type Cell,
  type CellDraft,
  type ChartSpec,
} from "../app/lib/model/contracts.js";
import { nearestVisualizationSource } from "../app/lib/model/visualization-source.js";
import {
  agentNavigationSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import {
  isNotebookToolWrite,
  privateAskNotebookWrite,
} from "../server/lib/notebook-tool-context.js";
import {
  invalidNotebookProposal,
  notebookProposalChatUI,
  notebookToolProposalFields,
  proposeNotebookToolChange,
} from "../server/lib/notebook-tool-proposal.js";
import {
  assertGrantedDataConnection,
  assertValidCellConnection,
  grantedConnectionOrNull,
  notebookChangeResource,
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireWritableProject,
  resultVariables,
  uniqueResultVariable,
} from "../server/lib/project-action-access.js";
import { addCell, nextInputName } from "../server/model/cells-store.js";
import { defaultDataConnectionId } from "../server/model/data-connections.js";
import { getDataTableDetails } from "../server/model/data-table-details.js";
import { dataTableSqlIdentifier } from "../server/model/data-table-preview.js";
import { wakeReactiveNotebookRun } from "../server/model/notebook-execution/service.js";
import type { ExecutionActor } from "../server/model/notebook-execution/snapshot.js";
import { readLegacyNotebook } from "../server/model/notebook-operations/legacy.js";
import {
  getAuthorizedProjectRow,
  type ProjectRow,
} from "../server/model/project-access.js";
import { bindChartResult } from "../server/model/visualization-source.js";
import { defaultChartSpec } from "../shared/chart-visualization-config.js";
import {
  defaultMetricConfig,
  metricConfigSchema,
} from "../shared/metric-config.js";
import { notebookChangeSchema } from "../shared/notebook-operations.js";
import {
  notebookInsertionGap,
  notebookSectionInsertPosition,
} from "../shared/notebook-sections.js";
import { notebookOriginIdSchema } from "../shared/notebook-undo.js";
import { defaultPivotConfig } from "../shared/pivot-config.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import { isSqlInputName } from "../shared/sql-input-name.js";
import { defaultTableConfig } from "../shared/table-visualization-config.js";

/** The base shape every new cell carries before its kind-specific fields. */
const baseCellDraft = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;

/** New SQL cells use a dataframe result variable. */
const DEFAULT_SQL_RESULT_VARIABLE = "dataframe";
const INITIAL_QUERY_ROW_LIMIT = 100;
const addableCellKindSchema = z.enum(ADDABLE_CELL_KINDS);

function sqlDraft(
  cells: readonly Cell[],
  dataConnectionId: string | null,
  name?: string,
  source?: string | null,
  dataframes = false,
): CellDraft {
  const requested = name?.trim();
  const variableBase =
    requested && /^[A-Za-z_][A-Za-z0-9_]*$/.test(requested)
      ? requested
      : DEFAULT_SQL_RESULT_VARIABLE;
  return {
    ...baseCellDraft,
    label: requested || null,
    kind: "sql",
    source: source ?? "",
    dataConnectionId,
    ...(dataframes ? { connectionMode: "dataframes" as const } : {}),
    databaseSchema: null,
    resultVariable: uniqueResultVariable(variableBase, resultVariables(cells)),
    outputResult: true,
  };
}

function markdownDraft(): CellDraft {
  return { ...baseCellDraft, kind: "markdown", markdown: "" };
}

function textDraft(): CellDraft {
  return { ...baseCellDraft, kind: "text", text: "" };
}

/**
 * A component import cell names the component it shows. The cell stores only the
 * reference: the component's own snapshot is what renders, so every importer
 * shows the same cells the creator captured.
 */
function componentImportDraft(
  componentTitle?: string,
  componentVersionId?: string,
): CellDraft {
  return {
    ...baseCellDraft,
    kind: "component-import",
    componentVersionId: componentVersionId ?? null,
    title: componentTitle?.trim() || null,
  };
}

function chartDraft(
  upstream: readonly Cell[],
  dataframe: string | undefined,
  binding: ReturnType<typeof nearestVisualizationSource>,
  chartSpec: ChartSpec,
): CellDraft {
  const source = upstream.find(({ id }) => id === binding?.cellId)?.contents;
  return {
    ...baseCellDraft,
    kind: "chart",
    dataframe:
      source && "resultVariable" in source
        ? source.resultVariable
        : (dataframe ?? null),
    chartSpec,
  };
}

function pivotDraft(
  source: ReturnType<typeof nearestVisualizationSource>,
): CellDraft {
  return {
    ...baseCellDraft,
    kind: "pivot",
    dataframe: null,
    rows: [],
    columns: [],
    values: [],
    pivotConfig: { ...defaultPivotConfig, source },
  };
}

/** The default value each input type starts with, in its stored form. */
const INPUT_DEFAULT_VALUE: Record<
  (typeof PARAMETER_INPUT_TYPES)[number],
  string
> = {
  TEXT_INPUT: "",
  DROPDOWN: "",
  MULTISELECT: "[]",
  DATE: "",
  CHECKBOX: "false",
  SLIDER: "0",
  NUMERIC_INPUT: "0",
  BUTTON: "",
  TABLE: "",
  FILE_UPLOAD: "",
};

function inputDraft(
  cells: readonly Cell[],
  inputType: (typeof PARAMETER_INPUT_TYPES)[number],
  requestedName: string | undefined,
): CellDraft {
  return {
    ...baseCellDraft,
    kind: "input",
    name: requestedName?.trim() || nextInputName(cells),
    inputType,
    defaultValueString: INPUT_DEFAULT_VALUE[inputType],
    options: [],
    optional: false,
  };
}

async function inheritedConnection(
  cells: readonly Cell[],
  saved: ProjectRow["notebookLastSqlSource"],
): Promise<string | null> {
  if (saved?.kind === "dataframes") return null;
  if (saved?.kind === "warehouse") {
    const inherited = await grantedConnectionOrNull(saved.connectionId);
    if (inherited !== null) return inherited;
  }
  const withConnection = cells
    .flatMap(({ contents, createdAt }) =>
      contents.kind === "sql" &&
      (contents.dataConnectionId !== null ||
        contents.connectionMode === "dataframes")
        ? [{ contents, selectedAt: contents.connectionSelectedAt ?? createdAt }]
        : [],
    )
    .sort((a, b) => b.selectedAt.localeCompare(a.selectedAt));
  for (const latest of withConnection) {
    if (latest.contents.connectionMode === "dataframes") return null;
    const inherited = await grantedConnectionOrNull(
      latest.contents.dataConnectionId,
    );
    if (inherited !== null) return inherited;
  }
  const selected = await defaultDataConnectionId();
  if (selected !== null) await assertGrantedDataConnection(selected);
  return selected ?? SAMPLE_DATA_SOURCE_ID;
}

const addProjectCellInput = z
  .object({
    projectId: z.string().min(1),
    originId: notebookOriginIdSchema.optional(),
    // Every kind the add-cell control offers has to be accepted here, or the
    // control is a dead end for the person who clicks it.
    kind: cellKindSchema,
    afterCellId: z
      .string()
      .min(1)
      .optional()
      .describe("Insert after this cell; omit when using beforeCellId."),
    beforeCellId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Insert before this cell; omit when using afterCellId. With neither, append.",
      ),
    parentSectionId: cellIdSchema
      .nullable()
      .optional()
      .describe(
        "Insert into this Section. Omit to use the anchor's Section, or pass null to insert at the root.",
      ),
    // Input cells only: the parameter type the new cell renders.
    inputType: z.enum(PARAMETER_INPUT_TYPES).optional(),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "For SQL, sets the label and uses valid identifiers as result variable names. For inputs, pass a unique SQL identifier such as channel_pick or omit it to generate a name such as input_1. For component imports, sets the initial title.",
      ),
    table: z
      .object({
        connectionId: z.string().min(1),
        tableId: z.string().min(1),
      })
      .optional()
      .describe("For SQL, query this browsable table on its own connection."),
    dataConnectionId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "For SQL, use this saved warehouse connection ID with source. For dbt-metric, the connection whose dbt Semantic Layer to query.",
      ),
    dataframe: z
      .string()
      .min(1)
      .refine(isSqlInputName)
      .optional()
      .describe(
        "Result variable to query with SQL or bind to a Chart, Pivot, Single value, or Table.",
      ),
    metricConfig: metricConfigSchema
      .optional()
      .describe(
        "Single value settings. Bind an earlier dataframe by producer cell and export ID. Null field and aggregate use typed defaults.",
      ),
    componentVersionId: z
      .string()
      .min(1)
      .optional()
      .describe("For component imports, the component the new cell shows."),
    restore: cellContentsSchema
      .optional()
      .describe("Contents and identity of a removed notebook cell to restore."),
    outputUndoToken: z
      .uuid()
      .optional()
      .describe("SQL output undo token returned when the cell was deleted."),
    source: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Initial source for a new SQL or Python cell."),
  })
  .strict();

export default defineAction({
  mcpTool: true,
  description:
    "Add a notebook cell (saved in Ask; pending_review until confirmed in review). Query a warehouse with SQL dataConnectionId and source. Use kind metric and metricConfig for Single value. Read-only SELECTs needed for the question are already authorized: run them without asking permission.",
  schema: addProjectCellInput.refine(
    ({ kind, restore }) =>
      restore !== undefined || addableCellKindSchema.safeParse(kind).success,
    {
      path: ["kind"],
      message: "That cell type cannot be added to a project yet.",
    },
  ),
  agentInputSchema: addProjectCellInput.extend({
    restore: z
      .looseObject({ id: cellIdSchema, kind: cellKindSchema })
      .optional()
      .describe("For undo, pass the complete contents of the removed cell."),
  }),
  changeResource: notebookChangeResource,
  chatUI: notebookProposalChatUI,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: projectDocumentResultSchema.extend({
    cellStatus: z
      .enum(["saved", "pending_review"])
      .describe(
        "saved when added to the notebook; pending_review when staged as an unconfirmed proposal.",
      ),
    createdCellId: z
      .string()
      .optional()
      .describe(
        "ID of the saved cell when cellStatus is saved, or candidate ID of the unconfirmed proposal when cellStatus is pending_review.",
      ),
    ...notebookToolProposalFields,
    navigation: agentNavigationSchema.optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args, context) => {
    const {
      projectId,
      kind,
      afterCellId,
      beforeCellId,
      parentSectionId,
      inputType,
      name,
      source,
      dataframe,
      metricConfig,
      componentVersionId,
      table,
      dataConnectionId,
      restore,
      outputUndoToken,
      originId,
    } = args;
    if (afterCellId !== undefined && beforeCellId !== undefined) {
      fail("Choose either before or after a cell.", {
        statusCode: 400,
        errorCode: "invalid_cell_position",
      });
    }
    if (kind !== "sql" && kind !== "code" && source != null)
      fail("Initial source is only supported for SQL and Python cells.", {
        statusCode: 400,
        errorCode: "cell_source_kind_invalid",
      });
    if (
      (kind !== "sql" &&
        (table !== undefined ||
          (dataConnectionId !== undefined && kind !== "dbt-metric"))) ||
      (dataframe !== undefined &&
        kind !== "sql" &&
        kind !== "chart" &&
        kind !== "pivot" &&
        kind !== "metric" &&
        kind !== "display-table") ||
      (metricConfig !== undefined &&
        (kind !== "metric" ||
          dataframe !== undefined ||
          restore !== undefined)) ||
      (table !== undefined && (dataframe !== undefined || source != null)) ||
      (dataConnectionId !== undefined &&
        (table !== undefined ||
          dataframe !== undefined ||
          restore !== undefined)) ||
      (outputUndoToken !== undefined && restore?.kind !== "sql") ||
      (restore &&
        (restore.kind !== kind || table || dataframe || source != null))
    ) {
      fail("Choose a compatible cell type and initial source.", {
        statusCode: 400,
        errorCode: "cell_source_kind_invalid",
      });
    }
    if (restore?.kind === "sql") {
      assertValidCellConnection(restore);
      if (restore.dataConnectionId !== null)
        await assertGrantedDataConnection(restore.dataConnectionId);
    }
    function insertion(cells: readonly Cell[]) {
      const target = notebookInsertionGap(cells, {
        beforeCellId,
        afterCellId,
        parentSectionId,
      });
      const position =
        target &&
        notebookSectionInsertPosition(
          cells,
          target.parentSectionId,
          target.gap,
        );
      if (!target || position === null)
        fail("The notebook insertion point changed. Refresh and try again.", {
          statusCode: 409,
          errorCode: "notebook_conflict",
        });
      return { ...target, position };
    }
    async function draftContents(
      cells: readonly Cell[],
      project: Pick<ProjectRow, "notebookLastSqlSource" | "workingVersionId">,
      actor: ExecutionActor,
      thread?: { id: string; threadId: string },
    ): Promise<(cells: readonly Cell[]) => Promise<CellDraft>> {
      const tableDetails = table
        ? await getDataTableDetails(table, context?.caller)
        : undefined;
      const tableSql =
        table && tableDetails
          ? `select * from ${dataTableSqlIdentifier(table.connectionId, tableDetails.table)} limit ${INITIAL_QUERY_ROW_LIMIT}`
          : undefined;
      if (dataConnectionId !== undefined)
        await assertGrantedDataConnection(dataConnectionId);
      const connection =
        table?.connectionId ??
        dataConnectionId ??
        (kind === "sql" && !restore && dataframe === undefined
          ? await inheritedConnection(cells, project.notebookLastSqlSource)
          : null);
      return async (cells) => {
        if (restore) {
          if (
            cells.some(
              (cell) =>
                cell.id === restore.id ||
                ("resultVariable" in restore &&
                  restore.resultVariable !== null &&
                  "resultVariable" in cell.contents &&
                  cell.contents.resultVariable === restore.resultVariable),
            )
          )
            fail("A cell with that identifier or variable already exists.", {
              statusCode: 409,
              errorCode: "project_cell_restore_conflict",
            });
          return withoutPendingCellEdit(restore);
        }
        if (
          dataframe !== undefined &&
          !resultVariables(cells).includes(dataframe)
        )
          fail("That result variable is not in this project.", {
            statusCode: 404,
            errorCode: "project_result_variable_not_found",
          });
        const addableKind = addableCellKindSchema.safeParse(kind);
        if (!addableKind.success)
          fail("That cell type cannot be added to a project yet.", {
            statusCode: 400,
            errorCode: "project_cell_kind_unsupported",
          });
        switch (addableKind.data) {
          case "sql":
            return sqlDraft(
              cells,
              connection,
              name,
              tableSql ??
                (dataframe
                  ? `select * from "${dataframe}" limit ${INITIAL_QUERY_ROW_LIMIT}`
                  : source),
              connection === null,
            );
          case "code":
            return {
              ...baseCellDraft,
              kind: "code",
              language: "python",
              source: source ?? "",
              resultVariable: null,
              outputResult: true,
            };
          case "markdown":
            return markdownDraft();
          case "text":
            return textDraft();
          case "component-import":
            return componentImportDraft(name, componentVersionId);
          case "dbt-metric":
            return {
              ...baseCellDraft,
              kind: "dbt-metric",
              dataConnectionId: connection,
              metrics: [],
              selectedTimegrain: null,
              selectedDimensions: [],
              useRichDisplay: true,
            };
          case "collapsible":
            return {
              ...baseCellDraft,
              kind: "collapsible",
              title: name?.trim() || null,
              collapsed: false,
            };
          case "chart":
          case "pivot":
          case "metric":
          case "display-table": {
            const upstream = cells.slice(0, insertion(cells).position);
            const binding = nearestVisualizationSource(upstream, dataframe);
            if (addableKind.data === "chart") {
              const defaultSpec = defaultChartSpec(binding);
              const spec =
                binding && thread
                  ? await bindChartResult(
                      actor,
                      {
                        projectId,
                        versionId: project.workingVersionId,
                        cells: upstream,
                      },
                      binding,
                      defaultSpec,
                      thread,
                    )
                  : defaultSpec;
              return chartDraft(upstream, dataframe, binding, spec);
            }
            if (addableKind.data === "pivot") return pivotDraft(binding);
            if (addableKind.data === "metric") {
              return {
                ...baseCellDraft,
                kind: "metric",
                valueVariableName: null,
                valueRowIndex: null,
                resultVariable: null,
                outputResult: false,
                format: null,
                metricConfig: metricConfig ?? {
                  ...defaultMetricConfig,
                  source: binding,
                },
              };
            }
            return {
              ...baseCellDraft,
              kind: "display-table",
              dataframe: null,
              columns: [],
              tableConfig: { ...defaultTableConfig, source: binding },
            };
          }
          case "input":
            if (inputType === undefined)
              fail("Choose the input's parameter type.", {
                statusCode: 400,
                errorCode: "input_type_required",
              });
            return inputDraft(cells, inputType, name);
        }
      };
    }
    const askWrite =
      isNotebookToolWrite(context) && !restore
        ? await privateAskNotebookWrite(projectId, context)
        : null;
    if (isNotebookToolWrite(context) && !askWrite) {
      const { newCellId, ...proposal } = await proposeNotebookToolChange(
        context,
        projectId,
        "add-project-cell",
        args,
        async (notebook, cellId, scope, thread) => {
          if (restore || outputUndoToken !== undefined)
            invalidNotebookProposal();
          const project = await getAuthorizedProjectRow(scope, projectId);
          if (!project) invalidNotebookProposal();
          const { cells } = notebook;
          const build = await draftContents(
            cells,
            project,
            { ...scope, caller: context?.caller ?? "tool" },
            thread,
          );
          const {
            id: _id,
            order: _order,
            parentSectionId: _parentSectionId,
            gridX: _x,
            gridY: _y,
            gridWidth: _width,
            gridHeight: _height,
            hidden: _hidden,
            ...contents
          } = await build(cells);
          const { gap, parentSectionId: parent } = insertion(cells);
          return [
            notebookChangeSchema.parse({
              type: "insert",
              cellId,
              gap,
              parentSectionId: parent,
              expectedOrderRevision: notebook.resources.orderRevision,
              contents,
            }),
          ];
        },
      );
      return {
        ...proposal,
        cellStatus: "pending_review" as const,
        createdCellId: newCellId,
      };
    }
    const { scope, project } = await requireWritableProject(projectId);
    const draft = await readLegacyNotebook(scope, project.id);
    const contents = await draftContents(
      draft.cells,
      draft.project,
      { ...scope, caller: context?.caller ?? "frontend" },
      askWrite ?? undefined,
    );
    const created = await addCell(
      {
        ...scope,
        projectId: project.id,
        versionId: draft.project.workingVersionId,
        restore: restore !== undefined,
        ...(originId === undefined ? {} : { originId }),
        ...(outputUndoToken === undefined ? {} : { outputUndoToken }),
        contents,
        ...(afterCellId === undefined ? {} : { afterCellId }),
        ...(beforeCellId === undefined ? {} : { beforeCellId }),
        ...(parentSectionId === undefined ? {} : { parentSectionId }),
      },
      draft,
    );
    if (kind === "input" && (context?.requestHeaders || context?.runId))
      wakeReactiveNotebookRun({ ...scope, caller: context.caller }, project.id);
    return {
      project: await refreshedProjectDocument(scope, project.id),
      cellStatus: "saved" as const,
      createdCellId: created.id,
      ...(askWrite ? {} : await showAgentProject(context, project.id)),
    };
  },
});
