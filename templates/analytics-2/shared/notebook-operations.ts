import { z } from "zod";

import {
  cellKindSchema,
  cellSchema,
  chartCellContentsSchema,
  chartSpecSchema,
  codeCellContentsSchema,
  collapsibleCellContentsSchema,
  componentImportCellContentsSchema,
  displayTableCellContentsSchema,
  filterCellContentsSchema,
  markdownCellContentsSchema,
  metricCellContentsSchema,
  parameterCellContentsSchema,
  pivotCellContentsSchema,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_TITLE_MAX_LENGTH,
  sqlCellContentsSchema,
  textCellContentsSchema,
} from "../app/lib/model/contracts.js";
import {
  appDocumentSchema,
  appPatchSchema,
  appPlaceRequestSchema,
} from "./app-layout.js";
import { metricConfigSchema } from "./metric-config.js";
import { runIdSchema, runInvalidationSchema } from "./notebook-execution.js";
import {
  absentSchema,
  authorizedNotebookSnapshotRefSchema,
  CONTRACT_VERSION,
  draftHeadSchema,
  notebookCellIdSchema,
  notebookCommandImpactSchema,
  notebookEventCursorSchema,
  notebookProjectIdSchema,
  notebookVersionIdSchema,
  outputFenceSchema,
  pendingSchema,
  revisionSchema,
} from "./notebook-snapshot-contract.js";
import { warehouseTableRefSchema } from "./warehouse-table.js";

export { draftHeadSchema, revisionSchema };
export type { DraftHead, Revision } from "./notebook-snapshot-contract.js";

const opId = z.string().min(1).max(128);
const cellId = notebookCellIdSchema;
const gap = z.strictObject({
  afterCellId: cellId.nullable(),
  beforeCellId: cellId.nullable(),
});
const positioned = { cellId, gap, expectedOrderRevision: revisionSchema };
const guarded = { cellId, expectedRevision: revisionSchema };
const writable = {
  id: true,
  order: true,
  parentSectionId: true,
  gridX: true,
  gridY: true,
  gridWidth: true,
  gridHeight: true,
  hidden: true,
} as const;
const chartSpec = chartSpecSchema.strict();
export const agentChartSpecSchema = chartSpec
  .pick({
    sourceCellId: true,
    sourceExportId: true,
    mark: true,
    xField: true,
    yField: true,
    yFields: true,
    yAggregation: true,
    seriesField: true,
    title: true,
  })
  .loose();
const insertContents = z.discriminatedUnion("kind", [
  sqlCellContentsSchema
    .omit({
      ...writable,
      pendingEdit: true,
      connectionSelectedAt: true,
      warehouseTable: true,
    })
    .partial({ resultVariable: true })
    .strict(),
  codeCellContentsSchema.omit(writable).strict(),
  markdownCellContentsSchema.omit(writable).strict(),
  textCellContentsSchema.omit(writable).strict(),
  parameterCellContentsSchema.omit(writable).partial({ name: true }).strict(),
  chartCellContentsSchema.omit(writable).extend({ chartSpec }).strict(),
  displayTableCellContentsSchema.omit(writable).strict(),
  pivotCellContentsSchema.omit(writable).strict(),
  filterCellContentsSchema.omit(writable).strict(),
  metricCellContentsSchema.omit(writable).strict(),
  componentImportCellContentsSchema.omit(writable).strict(),
  collapsibleCellContentsSchema.omit(writable).strict(),
]);
export const agentNotebookDraftCellSchema = z.looseObject({
  kind: cellKindSchema,
  source: z.string().optional().describe("Source for a SQL or code cell."),
  text: z.string().optional().describe("Contents of a text cell."),
  markdown: z.string().optional().describe("Contents of a markdown cell."),
  dataframe: chartCellContentsSchema.shape.dataframe.optional(),
  chartSpec: agentChartSpecSchema.optional(),
  metricConfig: metricConfigSchema.optional(),
});
export const notebookMetadataSchema = z.strictObject({
  title: z.string().max(PROJECT_TITLE_MAX_LENGTH),
  description: z.string(),
  statusId: z.string().min(1).nullable(),
});

const notebookInsertSchema = z.strictObject({
  type: z.literal("insert"),
  ...positioned,
  contents: insertContents,
  parentSectionId: cellId.nullable().optional(),
});

const insertAndPlaceSchema = z.strictObject({
  type: z.literal("insert-and-place"),
  insert: notebookInsertSchema,
  placement: appPlaceRequestSchema,
});

export const setAppPatchSchema = z.discriminatedUnion("type", [
  ...appPatchSchema.options,
  insertAndPlaceSchema,
]);

const setAppChangeSchema = z.strictObject({
  type: z.literal("set-app"),
  expectedLayoutRevision: revisionSchema,
  patches: z.array(setAppPatchSchema).min(1).max(50),
});

const sectionSelection = z.array(cellId).min(1).max(200);
const groupSection = z.strictObject({
  type: z.literal("group-section"),
  cellId,
  cellIds: sectionSelection,
  expectedOrderRevision: revisionSchema,
});
const moveToSection = z.strictObject({
  type: z.literal("move-to-section"),
  cellId,
  cellIds: sectionSelection,
  parentSectionId: cellId.nullable(),
  beforeCellId: cellId.optional(),
  expectedOrderRevision: revisionSchema,
});
const setSection = z.strictObject({
  type: z.literal("set-section"),
  ...guarded,
  config: collapsibleCellContentsSchema
    .pick({ title: true, collapsed: true, headingStyle: true })
    .partial()
    .strict(),
});
const agentSectionChanges = [groupSection, moveToSection, setSection] as const;
const sectionChanges = [
  ...agentSectionChanges,
  z.strictObject({
    type: z.literal("remove-section"),
    cellId,
    mode: z.enum(["eject", "delete"]),
    expectedOrderRevision: revisionSchema,
  }),
] as const;

const cellEdits = [
  z.strictObject({
    type: z.literal("duplicate"),
    ...positioned,
    fromCellId: cellId,
    expectedRevision: revisionSchema,
  }),
  z.strictObject({ type: z.literal("move"), ...positioned }),
  z.strictObject({
    type: z.literal("delete"),
    ...guarded,
    expectedOrderRevision: revisionSchema,
  }),
  z.strictObject({
    type: z.literal("set-code"),
    ...guarded,
    source: z.string(),
  }),
  z.strictObject({
    type: z.literal("set-source"),
    ...guarded,
    dataConnectionId: z.string().min(1).nullable(),
    connectionMode: z.enum(["dataframes", "warehouse"]),
    databaseSchema: z.string().nullable().optional(),
  }),
  z.strictObject({ type: z.literal("set-text"), ...guarded, text: z.string() }),
  z.strictObject({
    type: z.literal("set-label"),
    cellId,
    expectedLabelRevision: revisionSchema,
    label: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("set-output-name"),
    ...guarded,
    name: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("set-input-default"),
    ...guarded,
    defaultValueString: z.string(),
    optionsResultId: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal("set-input-config"),
    ...guarded,
    config: z.strictObject({
      name: parameterCellContentsSchema.shape.name.optional(),
      inputType: parameterCellContentsSchema.shape.inputType.optional(),
      options: parameterCellContentsSchema.shape.options.nullable(),
      optionValueType:
        parameterCellContentsSchema.shape.optionValueType.nullable(),
      optionLabels: parameterCellContentsSchema.shape.optionLabels.nullable(),
      dynamicOptions:
        parameterCellContentsSchema.shape.dynamicOptions.nullable(),
      optional: parameterCellContentsSchema.shape.optional.nullable(),
      sliderOptions: parameterCellContentsSchema.shape.sliderOptions.nullable(),
      defaultValueString: z.string().optional(),
    }),
  }),
  z.strictObject({
    type: z.literal("set-metric-config"),
    ...guarded,
    config: metricConfigSchema,
  }),
] as const;

const setChartConfig = z.strictObject({
  type: z.literal("set-chart-config"),
  ...guarded,
  config: z.strictObject({
    dataframe: z.string().nullable().optional(),
    chartSpec: chartSpec.optional(),
  }),
});

export const notebookChangeSchema = z.discriminatedUnion("type", [
  notebookInsertSchema,
  setAppChangeSchema,
  ...sectionChanges,
  ...cellEdits,
  setChartConfig,
  z.strictObject({
    type: z.literal("set-metadata"),
    expectedMetadataRevision: revisionSchema,
    metadata: notebookMetadataSchema.partial().extend({
      description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH).optional(),
    }),
  }),
]);

const commandEnvelopeSchema = z.strictObject({
  protocol: z.literal(CONTRACT_VERSION),
  projectId: notebookProjectIdSchema,
  workingVersionId: notebookVersionIdSchema,
  opId,
  observedHead: draftHeadSchema,
});

export const notebookCommandSchema = commandEnvelopeSchema.extend({
  originId: z.uuid().optional(),
  changes: z
    .array(notebookChangeSchema)
    .min(1)
    .max(200)
    .refine(
      (changes) => changes.filter(({ type }) => type === "set-app").length <= 1,
    ),
});

export const agentNotebookProposalCommandSchema = commandEnvelopeSchema.extend({
  originId: notebookCommandSchema.shape.originId,
  changes: z
    .array(
      z.discriminatedUnion("type", [
        notebookInsertSchema.extend({ contents: agentNotebookDraftCellSchema }),
        ...agentSectionChanges,
        ...cellEdits,
        setChartConfig.extend({
          config: setChartConfig.shape.config.extend({
            chartSpec: agentChartSpecSchema.optional(),
          }),
        }),
      ]),
    )
    .min(1)
    .max(200),
});

export const setAppCommandSchema = commandEnvelopeSchema.extend({
  opId: z.uuid(),
  changes: z.tuple([setAppChangeSchema]),
});

export const agentSetAppCommandSchema = setAppCommandSchema.extend({
  changes: z.tuple([
    setAppChangeSchema.extend({
      patches: z.array(appPatchSchema).min(1).max(50),
    }),
  ]),
});

export const notebookCellSchema = cellSchema
  .extend({
    revision: revisionSchema,
    labelRevision: revisionSchema,
  })
  .strict();

export const notebookResourcesSchema = z.strictObject({
  orderRevision: revisionSchema,
  metadataRevision: revisionSchema,
  inputRevision: revisionSchema,
  layoutRevision: revisionSchema,
});

export const notebookTombstoneSchema = outputFenceSchema.extend({
  versionId: notebookVersionIdSchema,
  revision: revisionSchema,
});

export const notebookDeltaSchema = z.strictObject({
  cells: z.array(notebookCellSchema),
  tombstones: z.array(notebookTombstoneSchema),
  resources: notebookResourcesSchema,
  metadata: notebookMetadataSchema.optional(),
  listed: z.boolean().optional(),
  appLayout: appDocumentSchema.optional(),
});

export const notebookConflictReasonSchema = z.enum([
  "lineage_changed",
  "head_ahead",
  "cell_changed",
  "cell_missing",
  "label_changed",
  "order_changed",
  "metadata_changed",
  "layout_changed",
  "stale_anchor",
  "cell_id_reserved",
  "symbol_taken",
]);

const receipt = z.strictObject({
  opId,
  previousHead: draftHeadSchema,
  nextHead: draftHeadSchema,
  eventSeq: notebookEventCursorSchema,
  committedAt: z.iso.datetime(),
});
// raw-sql-ok: This schema validates text in a receipt.
const queryStatement = z.string().max(8192);
export const notebookTableRunSchema = z.strictObject({
  requestId: z.uuid(),
  runId: runIdSchema,
  cellId,
  table: warehouseTableRefSchema,
  sql: queryStatement,
  sourceId: z.string().min(1).max(1024),
  resultVariable: z.string().min(1).max(128),
  admittedAt: z.iso.datetime(),
});
export const appliedReceiptSchema = receipt.extend({
  status: z.literal("applied"),
  delta: notebookDeltaSchema,
  impact: notebookCommandImpactSchema,
  tableRun: notebookTableRunSchema.optional(),
  versionChange: z
    .strictObject({
      type: z.enum(["checkpoint", "restore"]),
      versionId: notebookVersionIdSchema,
    })
    .optional(),
});
export const operationReceiptSchema = z.discriminatedUnion("status", [
  appliedReceiptSchema,
  receipt.extend({ status: z.literal("no_change") }),
  receipt.extend({
    status: z.literal("conflict"),
    reason: notebookConflictReasonSchema,
  }),
]);

export const notebookEventSchema = z.strictObject({
  sequence: notebookEventCursorSchema,
  principalId: z.string().min(1),
  before: notebookDeltaSchema,
  receipt: appliedReceiptSchema,
  invalidations: z.array(runInvalidationSchema),
  runIntent: z
    .strictObject({
      kind: z.literal("reactive-input"),
      cellIds: z.array(cellId).min(1),
    })
    .nullable(),
});

export const notebookSnapshotSchema = z.strictObject({
  status: z.literal("accepted"),
  snapshot: authorizedNotebookSnapshotRefSchema,
  metadata: notebookMetadataSchema,
  resources: notebookResourcesSchema,
  cells: z.array(notebookCellSchema),
  appLayout: appDocumentSchema.optional(),
});
export const notebookSnapshotReadSchema = z.discriminatedUnion("status", [
  notebookSnapshotSchema,
  pendingSchema,
]);
export const notebookProjectInputSchema = z.strictObject({
  projectId: notebookProjectIdSchema,
});
export const notebookOperationInputSchema = notebookProjectInputSchema.extend({
  opId,
});
export const notebookOperationReadSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    receipt: operationReceiptSchema,
  }),
  absentSchema,
]);
export const notebookChangesInputSchema = notebookProjectInputSchema.extend({
  after: notebookEventCursorSchema,
  limit: z.number().int().min(1).max(100).default(50),
});
export const notebookChangesReadSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    events: z.array(notebookEventSchema),
    cursor: notebookEventCursorSchema,
    hasMore: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("expired"),
    cursor: notebookEventCursorSchema,
  }),
  pendingSchema,
]);

export type NotebookChange = z.infer<typeof notebookChangeSchema>;
export type NotebookSectionChange = z.infer<(typeof sectionChanges)[number]>;
export type NotebookCommand = z.infer<typeof notebookCommandSchema>;
export type NotebookInsert = z.infer<typeof notebookInsertSchema>;
export type SetAppPatch = z.infer<typeof setAppPatchSchema>;
export type NotebookCell = z.infer<typeof notebookCellSchema>;
export type NotebookMetadata = z.infer<typeof notebookMetadataSchema>;
export type NotebookResources = z.infer<typeof notebookResourcesSchema>;
export type NotebookDelta = z.infer<typeof notebookDeltaSchema>;
export type NotebookConflictReason = z.infer<
  typeof notebookConflictReasonSchema
>;
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;
export type NotebookEvent = z.infer<typeof notebookEventSchema>;
export type NotebookSnapshot = z.infer<typeof notebookSnapshotSchema>;
