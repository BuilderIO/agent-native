import { createHash, randomUUID } from "node:crypto";

import {
  defineAction,
  fail,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { z } from "zod";

import {
  cellContentsSchema,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  type CellDraft,
} from "../app/lib/model/contracts.js";
import {
  agentNavigationSchema,
  agentOpenIntentSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import {
  assertGrantedDataConnection,
  assertValidCellConnection,
  notebookChangeResource,
} from "../server/lib/project-action-access.js";
import {
  checkedProjectCreation,
  requireProjectCreationAccess,
} from "../server/lib/project-creation-access.js";
import { defaultDataConnectionId } from "../server/model/data-connections.js";
import { newId } from "../server/model/ids.js";
import { createNotebook } from "../server/model/notebook-creation/store.js";
import { creationReceiptSchema } from "../shared/notebook-creation.js";
import { agentNotebookDraftCellSchema } from "../shared/notebook-operations.js";
import { restoreNotebookMembership } from "../shared/notebook-sections.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";

const cellDraftSchema = z.union(
  cellContentsSchema.options.map((schema) =>
    (schema as z.ZodObject<Record<string, z.ZodType>>)
      .omit({ order: true })
      .partial({ id: true }),
  ) as unknown as [
    z.ZodType<CellDraft>,
    z.ZodType<CellDraft>,
    ...z.ZodType<CellDraft>[],
  ],
);

const sampleDataset = z.enum(["orders", "customers", "products"]);
const initialCells = z.array(cellDraftSchema).max(200);
const emptyStarter = z.strictObject({ kind: z.literal("empty") });
const sampleStarter = z.strictObject({
  kind: z.literal("sample"),
  sampleDataset,
});
const cellsStarter = z.strictObject({
  kind: z.literal("cells"),
  cells: initialCells,
});
const starterSchema = z.discriminatedUnion("kind", [
  emptyStarter,
  sampleStarter,
  cellsStarter,
]);
const metadata = {
  title: z
    .string()
    .trim()
    .max(500)
    .regex(/^[^\u0000]*$/)
    .optional()
    .describe("Project name. Omit for an untitled project."),
  description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH).optional(),
  intent: agentOpenIntentSchema,
};
const canonicalCreate = z.strictObject({
  ...metadata,
  requestId: z
    .uuid()
    .describe("Reuse this ID when retrying the same project creation."),
  starter: starterSchema.default({ kind: "empty" }),
});
const legacyMetadata = { ...metadata, requestId: z.uuid().optional() };
const createInput = z.union(
  [
    canonicalCreate,
    z.strictObject({ ...legacyMetadata, sampleDataset }),
    z.strictObject({ ...legacyMetadata, cells: initialCells }),
    z.strictObject(legacyMetadata),
  ],
  {
    error: ({ input }) => {
      if (
        input &&
        typeof input === "object" &&
        "cells" in input &&
        "sampleDataset" in input
      )
        return "cells: Choose initial cells or a sample dataset, not both.";
    },
  },
);

const agentInitialCells = z.array(agentNotebookDraftCellSchema).max(200);
const agentCreateInput = z.union([
  canonicalCreate.extend({
    starter: z
      .discriminatedUnion("kind", [
        emptyStarter,
        sampleStarter,
        cellsStarter.extend({ cells: agentInitialCells }),
      ])
      .default({ kind: "empty" }),
  }),
  z.strictObject({ ...legacyMetadata, sampleDataset }),
  z.strictObject({ ...legacyMetadata, cells: agentInitialCells }),
  z.strictObject(legacyMetadata),
]);

function legacyRequestId(context?: ActionRunContext) {
  if (context?.caller !== "tool" || !context.runId || !context.toolCallId)
    return randomUUID();
  const hash = createHash("sha256")
    .update(JSON.stringify([context.runId, context.toolCallId]))
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function prepareStarter(starter: z.infer<typeof starterSchema>) {
  const initialCells =
    starter.kind === "cells"
      ? restoreNotebookMembership(starter.cells, () => newId("cel"))
      : undefined;
  if (initialCells === null)
    fail("The notebook starter contains an invalid Section hierarchy.", {
      errorCode: "invalid_project_starter",
      statusCode: 422,
      details: { field: "starter" },
    });
  const sampleDataset =
    starter.kind === "sample" ? starter.sampleDataset : undefined;
  try {
    for (const cell of initialCells ?? []) assertValidCellConnection(cell);
    const connectionIds = new Set(
      (initialCells ?? []).flatMap((cell) =>
        (cell.kind === "sql" || cell.kind === "dbt-metric") &&
        cell.dataConnectionId !== null
          ? [cell.dataConnectionId]
          : [],
      ),
    );
    const defaultConnection = initialCells?.some(
      (cell) =>
        cell.kind === "sql" &&
        cell.dataConnectionId === null &&
        cell.connectionMode !== "dataframes",
    )
      ? await defaultDataConnectionId()
      : null;
    if (defaultConnection !== null) connectionIds.add(defaultConnection);
    const recheck = async () => {
      for (const connectionId of connectionIds)
        await assertGrantedDataConnection(connectionId);
    };
    await recheck();
    const cells: CellDraft[] =
      initialCells?.map((cell) =>
        cell.kind === "sql" &&
        cell.dataConnectionId === null &&
        cell.connectionMode !== "dataframes"
          ? { ...cell, dataConnectionId: defaultConnection }
          : cell,
      ) ??
      (sampleDataset === undefined
        ? []
        : [
            {
              kind: "sql",
              label: null,
              hidden: false,
              gridX: null,
              gridY: null,
              gridWidth: null,
              gridHeight: null,
              source: `SELECT * FROM ${sampleDataset} LIMIT 100`,
              dataConnectionId: SAMPLE_DATA_SOURCE_ID,
              databaseSchema: null,
              resultVariable: sampleDataset,
              outputResult: true,
            },
          ]);
    return { cells, recheck };
  } catch (error) {
    if (isActionContractError(error) && error.statusCode < 500)
      fail(error.message, {
        errorCode: "invalid_project_starter",
        statusCode: 422,
        details: { field: "starter" },
      });
    throw error;
  }
}

export default defineAction({
  mcpTool: true,
  description:
    "Create a private project and return its first working version and creation receipt. Reuse the request ID for retries.",
  schema: createInput,
  agentInputSchema: agentCreateInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  changeResource: (_input, output) =>
    notebookChangeResource({ projectId: output.id }),
  outputSchema: z
    .object({
      ...creationReceiptSchema.shape,
      navigation: agentNavigationSchema.optional(),
    })
    .strict(),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) => {
    const starter =
      "starter" in input
        ? input.starter
        : "cells" in input
          ? { kind: "cells" as const, cells: input.cells }
          : "sampleDataset" in input
            ? { kind: "sample" as const, sampleDataset: input.sampleDataset }
            : { kind: "empty" as const };
    const { title, description, intent } = input;
    const requestId = input.requestId ?? legacyRequestId(context);
    const receipt = await checkedProjectCreation(async () => {
      const scope = await requireProjectCreationAccess();
      return createNotebook(
        { ...scope, requestId },
        {
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
          starter,
        },
        () => prepareStarter(starter),
        async () => {
          await requireProjectCreationAccess();
        },
      );
    });
    return {
      ...receipt,
      ...(await showAgentProject(context, receipt.projectId, intent)),
    };
  },
});
