import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  cellContentsSchema,
  cellKindSchema,
  chartCellContentsSchema,
  codeCellContentsSchema,
  markdownCellContentsSchema,
  parameterCellContentsSchema,
  sqlCellContentsSchema,
  textCellContentsSchema,
  type Cell,
  type CellContents,
} from "../app/lib/model/contracts.js";
import { nearestVisualizationSource } from "../app/lib/model/visualization-source.js";
import {
  agentNavigationSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import { isCellRevisionCurrent } from "../server/lib/cell-revision.js";
import { notebookToolCellEdits } from "../server/lib/notebook-tool-cell-edits.js";
import {
  isNotebookToolWrite,
  privateAskNotebookWrite,
} from "../server/lib/notebook-tool-context.js";
import {
  notebookProposalChatUI,
  notebookToolProposalFields,
  proposeNotebookToolChange,
} from "../server/lib/notebook-tool-proposal.js";
import {
  assertGrantedDataConnection,
  assertGrantedMetricConnection,
  assertValidCellConnection,
  notebookChangeResource,
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireWritableProject,
} from "../server/lib/project-action-access.js";
import { updateCell } from "../server/model/cells-store.js";
import { wakeReactiveNotebookRun } from "../server/model/notebook-execution/service.js";
import type { ExecutionActor } from "../server/model/notebook-execution/snapshot.js";
import {
  readLegacyNotebook,
  requireLegacyCell,
} from "../server/model/notebook-operations/legacy.js";
import { bindChartResult } from "../server/model/visualization-source.js";
import { chartNeedsDefaultAxes } from "../shared/chart-visualization-config.js";
import { metricConfigSchema } from "../shared/metric-config.js";
import { agentChartSpecSchema } from "../shared/notebook-operations.js";
import { notebookOriginIdSchema } from "../shared/notebook-undo.js";

const saveProjectCellInput = z.strictObject({
  projectId: z.string().min(1),
  cellId: z.string().min(1),
  contents: cellContentsSchema,
  // The cell's revision the editor last rendered. When the stored cell has
  // moved on, another change landed first and this save is refused.
  expectedUpdatedAt: z.string().min(1).optional(),
  inputOptionsResultId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Ready resultId from get-notebook-input-choices when saving a dynamicOptions selection.",
    ),
  suppressReactiveRun: z.boolean().optional(),
  originId: notebookOriginIdSchema.optional(),
});

const agentCellContents = sqlCellContentsSchema
  .omit({
    pendingEdit: true,
    warehouseTable: true,
    connectionSelectedAt: true,
    connectionMode: true,
    gridX: true,
    gridY: true,
    gridWidth: true,
    gridHeight: true,
    kind: true,
  })
  .partial({
    source: true,
    resultVariable: true,
    outputResult: true,
    dataConnectionId: true,
    databaseSchema: true,
  })
  .loose()
  .extend({
    kind: cellKindSchema,
    language: codeCellContentsSchema.shape.language.optional(),
    text: textCellContentsSchema.shape.text.optional(),
    markdown: markdownCellContentsSchema.shape.markdown.optional(),
    dataframe: chartCellContentsSchema.shape.dataframe.optional(),
    chartSpec: agentChartSpecSchema.optional(),
    metricConfig: metricConfigSchema.optional(),
    defaultValueString:
      parameterCellContentsSchema.shape.defaultValueString.optional(),
    options: z.array(z.string()).optional(),
    optionValueType: parameterCellContentsSchema.shape.optionValueType,
    dynamicOptions: parameterCellContentsSchema.shape.dynamicOptions,
  })
  .describe(
    "Copy the complete cell contents from get-project or the add-project-cell result. Change the requested fields and keep the other kind-specific fields.",
  );

export default defineAction({
  mcpTool: true,
  description:
    "Save one cell’s contents. An Ask agent edits its private backing notebook. A notebook review agent stages a pending change. Read the pending view before editing a cell that already has a proposal.",
  schema: saveProjectCellInput,
  agentInputSchema: saveProjectCellInput.extend({
    contents: agentCellContents,
  }),
  changeResource: notebookChangeResource,
  chatUI: notebookProposalChatUI,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: projectDocumentResultSchema.extend({
    navigation: agentNavigationSchema.optional(),
    editStatus: z.enum(["saved", "pending_review"]),
    ...notebookToolProposalFields,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, context) => {
    const {
      projectId,
      cellId,
      contents,
      expectedUpdatedAt,
      inputOptionsResultId,
      suppressReactiveRun,
      originId,
    } = args;
    // The cell id is the authority for which row is written; a body carrying a
    // different id is a client bug, not a request to move contents between rows.
    if (contents.id !== cellId) {
      fail("The saved cell contents belong to a different cell.", {
        statusCode: 400,
        errorCode: "cell_id_mismatch",
      });
    }
    async function bindChart(
      actor: ExecutionActor,
      cells: readonly Cell[],
      stored: Cell,
      thread?: { id: string; threadId: string },
    ): Promise<CellContents> {
      const prior = stored.contents;
      if (contents.kind !== "chart" || prior.kind !== "chart") return contents;
      const spec = contents.chartSpec;
      if (!chartNeedsDefaultAxes(spec)) {
        return spec.autoBind
          ? { ...contents, chartSpec: { ...spec, autoBind: false } }
          : contents;
      }
      if (!thread) return contents;
      const previousSpec = prior.chartSpec;
      const dataframeChanged = contents.dataframe !== prior.dataframe;
      const sourceChanged = spec.sourceCellId !== previousSpec.sourceCellId;
      if (
        !spec.autoBind &&
        !dataframeChanged &&
        !sourceChanged &&
        (spec.sourceExportId ?? "result") ===
          (previousSpec.sourceExportId ?? "result")
      )
        return contents;

      const upstream = cells.slice(0, cells.indexOf(stored));
      const sourceId =
        dataframeChanged && !sourceChanged ? null : spec.sourceCellId;
      const binding = sourceId
        ? upstream.some(
            ({ id, contents }) =>
              id === sourceId &&
              (contents.kind === "sql" || contents.kind === "code"),
          )
          ? { cellId: sourceId, exportId: spec.sourceExportId ?? "result" }
          : null
        : contents.dataframe
          ? nearestVisualizationSource(upstream, contents.dataframe)
          : null;
      if (!binding) return contents;
      return {
        ...contents,
        chartSpec: await bindChartResult(
          actor,
          { projectId, versionId: stored.versionId, cells: upstream },
          binding,
          spec,
          thread,
        ),
      };
    }
    const askWrite = isNotebookToolWrite(context)
      ? await privateAskNotebookWrite(projectId, context)
      : null;
    if (isNotebookToolWrite(context) && !askWrite) {
      const { newCellId: _unused, ...proposal } =
        await proposeNotebookToolChange(
          context,
          projectId,
          "save-project-cell",
          args,
          async (notebook, _newCellId, scope, thread) => {
            const cell = requireLegacyCell(notebook, cellId);
            if (!isCellRevisionCurrent(cell, expectedUpdatedAt))
              fail("Changed elsewhere", {
                statusCode: 409,
                errorCode: "cell_changed_elsewhere",
              });
            const next = await bindChart(
              { ...scope, caller: context?.caller ?? "tool" },
              notebook.cells,
              cell,
              thread,
            );
            return notebookToolCellEdits(cell, next, inputOptionsResultId);
          },
        );
      return { ...proposal, editStatus: "pending_review" as const };
    }
    const { scope, project } = await requireWritableProject(projectId);
    const draft = await readLegacyNotebook(scope, project.id);
    const stored = requireLegacyCell(draft, cellId);
    const storedContents = stored.contents;
    if (!isCellRevisionCurrent(stored, expectedUpdatedAt)) {
      fail("Changed elsewhere", {
        statusCode: 409,
        errorCode: "cell_changed_elsewhere",
      });
    }
    // A save edits a cell; changing its kind is a different operation and would
    // silently discard the stored contents that the kind's editor depends on.
    if (contents.kind !== storedContents.kind) {
      fail("A saved cell cannot change its kind.", {
        statusCode: 400,
        errorCode: "cell_kind_change",
      });
    }
    let nextContents = await bindChart(
      { ...scope, caller: context?.caller ?? "frontend" },
      draft.cells,
      stored,
      askWrite ?? undefined,
    );
    if (storedContents.kind === "sql" && contents.kind === "sql") {
      const { pendingEdit: _ignored, ...rest } = contents;
      nextContents = storedContents.pendingEdit
        ? { ...rest, pendingEdit: storedContents.pendingEdit }
        : rest;
    }
    assertValidCellConnection(nextContents);
    if (nextContents.kind === "sql" && nextContents.dataConnectionId !== null) {
      await assertGrantedDataConnection(nextContents.dataConnectionId);
    }
    await assertGrantedMetricConnection(nextContents, storedContents);
    // The version is the authorised project's working version, never a value
    // supplied by the caller.
    const updated = await updateCell(
      {
        ...scope,
        projectId: project.id,
        versionId: draft.project.workingVersionId,
        cellId,
        contents: nextContents,
        expectedUpdatedAt: expectedUpdatedAt ?? stored.updatedAt,
        ...(inputOptionsResultId === undefined ? {} : { inputOptionsResultId }),
        ...(suppressReactiveRun ? { suppressReactiveRun } : {}),
        ...(originId === undefined ? {} : { originId }),
      },
      draft,
    );
    if (updated === null) {
      fail("Changed elsewhere", {
        statusCode: 409,
        errorCode: "cell_changed_elsewhere",
      });
    }
    if (
      contents.kind === "input" &&
      !suppressReactiveRun &&
      (context?.requestHeaders || context?.runId)
    )
      wakeReactiveNotebookRun({ ...scope, caller: context.caller }, project.id);
    const document = await refreshedProjectDocument(scope, project.id);
    return {
      project: document,
      editStatus: "saved" as const,
      ...(askWrite ? {} : await showAgentProject(context, project.id)),
    };
  },
});
