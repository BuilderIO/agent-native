import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";

import {
  cellContentsSchema,
  parameterCellContentsSchema,
  type CellContents,
  type CellOutput,
} from "../../app/lib/model/contracts.js";
import { compareOrder } from "../../app/lib/model/order.js";
import {
  executionSnapshotSchema,
  runRequestSchema,
  type RunRequest,
} from "../../shared/notebook-execution.js";
import { notebookCellIdSchema } from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import { createHostedKernelPort } from "../execution/notebook-kernel.js";
import { createNotebookWorker } from "../execution/notebook-worker.js";
import { inputBinding } from "../execution/sql-compiler.js";
import { decodeJsonColumn, StoredDataError } from "./json-column.js";
import {
  digest,
  executionContents,
  type ExecutionCell,
} from "./notebook-execution/planner.js";
import { createRunStore } from "./notebook-execution/run-store.js";
import {
  notebookRunAttempts,
  notebookRunWork,
} from "./notebook-execution/schema.js";
import {
  readCurrentDraftSnapshot,
  MAX_NOTEBOOK_CELLS,
  readDraftSnapshot,
  type ExecutionActor,
  type SnapshotReader,
} from "./notebook-execution/snapshot.js";
import { getNotebookResultPage } from "./notebook-results.js";
import { getReadableProjectRow } from "./project-access.js";

type PublishedRun = {
  projectId: string;
  versionId: string;
  cellId: string;
  values: Record<string, string | string[]>;
  drill?: { chartCellId: string; x: string; series: string };
};
type TableOutput = Extract<CellOutput, { type: "table" }>;
const dataframeRequestSchema = runRequestSchema.options[0];

function invalidInput(): never {
  fail("Check the values for the input cells and try again.", {
    statusCode: 422,
    errorCode: "project_input_invalid",
  });
}

function withViewerInput(
  contents: Extract<CellContents, { kind: "input" }>,
  value: string | string[],
) {
  if (Array.isArray(value) && contents.inputType !== "MULTISELECT")
    invalidInput();
  const input = {
    ...contents,
    defaultValueString: Array.isArray(value) ? JSON.stringify(value) : value,
  };
  try {
    inputBinding(input);
  } catch {
    invalidInput();
  }
  return input;
}

function publishedReader(
  input: PublishedRun,
  actor: ExecutionActor,
  sessionId: string,
): SnapshotReader {
  return async (current, requested, tx) => {
    if (
      current.orgId !== actor.orgId ||
      current.ownerEmail !== actor.ownerEmail ||
      requested.ref.workspaceId !== actor.orgId ||
      requested.ref.projectId !== input.projectId ||
      requested.ref.head.versionId !== input.versionId ||
      requested.namespace.kind !== "release-session" ||
      requested.namespace.sessionId !== sessionId ||
      requested.namespace.namespaceId !== sessionId ||
      requested.namespace.releaseId !== input.versionId
    )
      return { status: "denied" };
    const db = tx ?? getDb();
    const project = await getReadableProjectRow(current, input.projectId, db);
    if (!project || project.trashedAt) return { status: "absent" };
    const [version] = await db
      .select({
        id: schema.projectVersions.id,
        kind: schema.projectVersions.kind,
      })
      .from(schema.projectVersions)
      .where(
        and(
          eq(schema.projectVersions.id, input.versionId),
          eq(schema.projectVersions.projectId, project.id),
        ),
      )
      .limit(1);
    if (version?.kind !== "published") return { status: "absent" };
    const rows = await db
      .select({ id: schema.cells.id, contents: schema.cells.contents })
      .from(schema.cells)
      .where(
        and(
          eq(schema.cells.projectId, project.id),
          eq(schema.cells.versionId, version.id),
        ),
      )
      .limit(MAX_NOTEBOOK_CELLS + 1);
    if (rows.length > MAX_NOTEBOOK_CELLS) return { status: "unreadable" };
    const cells: ExecutionCell[] = [];
    let chart: Extract<CellContents, { kind: "chart" }> | undefined;
    for (const row of rows) {
      let contents;
      try {
        contents = decodeJsonColumn(row.contents, cellContentsSchema);
      } catch (error) {
        if (!(error instanceof StoredDataError)) throw error;
        return { status: "unreadable" };
      }
      if (!contents) return { status: "unreadable" };
      if (contents.kind === "chart" && row.id === input.drill?.chartCellId)
        chart = contents;
      if (
        contents.kind === "input" ||
        contents.kind === "sql" ||
        contents.kind === "code"
      )
        cells.push({ id: notebookCellIdSchema.parse(row.id), contents });
    }
    cells.sort((a, b) => compareOrder(a.contents.order, b.contents.order));
    const target = cells.find(({ id }) => id === input.cellId);
    if (
      !target ||
      target.contents.kind !== "sql" ||
      target.contents.connectionMode !== "dataframes"
    )
      return { status: "absent" };
    if (input.drill) {
      if (
        !chart?.drilldownSql ||
        chart.dataframe !== target.contents.resultVariable
      )
        return { status: "absent" };
      target.contents = { ...target.contents, source: chart.drilldownSql };
    }
    for (const cell of cells) {
      if (
        cell.contents.kind !== "input" ||
        !Object.hasOwn(input.values, cell.contents.name)
      )
        continue;
      const value = input.values[cell.contents.name];
      if (value === undefined) invalidInput();
      cell.contents = withViewerInput(cell.contents, value);
    }
    if (input.drill) {
      const syntheticInputs = Object.entries({
        drillX: input.drill.x,
        drillSeries: input.drill.series,
      });
      cells.unshift(
        ...syntheticInputs.map(([name, defaultValueString]) => {
          const id = notebookCellIdSchema.parse(`${sessionId}:${name}`);
          return {
            id,
            contents: parameterCellContentsSchema.parse({
              kind: "input",
              id,
              name,
              defaultValueString,
              inputType: "TEXT_INPUT",
              hidden: true,
              order: "a",
              label: null,
              gridX: null,
              gridY: null,
              gridWidth: null,
              gridHeight: null,
            }),
          };
        }),
      );
    }
    const signature = digest(
      cells.map(({ id, contents }) => [id, executionContents(contents)]),
    );
    return {
      status: "accepted",
      value: {
        cells,
        snapshot: executionSnapshotSchema.parse({
          ...requested,
          ref: {
            ...requested.ref,
            head: {
              ...requested.ref.head,
              revision: BigInt(`0x${signature}`).toString(),
            },
          },
          executionFingerprint: signature,
        }),
      },
    };
  };
}

export async function runPublishedDataframe(
  actor: ExecutionActor,
  input: PublishedRun,
): Promise<TableOutput> {
  const sessionId = digest([
    "release-session",
    actor.orgId,
    actor.ownerEmail,
    input.projectId,
    input.versionId,
  ]);
  const inputRevision = BigInt(
    `0x${digest([input.values, input.drill ?? null])}`,
  ).toString();
  const reader = publishedReader(input, actor, sessionId);
  const accepted = await reader(
    actor,
    executionSnapshotSchema.parse({
      ref: {
        workspaceId: actor.orgId,
        projectId: input.projectId,
        head: { versionId: input.versionId, revision: "0" },
        eventSeq: "0",
      },
      namespace: {
        kind: "release-session",
        namespaceId: sessionId,
        releaseId: input.versionId,
        sessionId,
      },
      executionFingerprint: "published",
      inputRevision,
    }),
  );
  if (accepted.status !== "accepted")
    fail(
      accepted.status === "unreadable"
        ? "The notebook could not be read."
        : "That published cell is not available.",
      {
        ...(accepted.status === "unreadable"
          ? { statusCode: 503, errorCode: "notebook_unreadable" }
          : {
              statusCode: 404,
              errorCode: "project_sql_cell_not_found",
            }),
      },
    );
  return runDataframe(
    actor,
    createRunStore(reader),
    dataframeRequestSchema.parse({
      requestId: randomUUID(),
      snapshot: accepted.value.snapshot,
      cache: "reuse",
      mode: "upstream",
      targetCellId: input.cellId,
      staleValues: "reject",
    }),
  );
}

export async function runDraftDataframe(
  actor: ExecutionActor,
  input: { projectId: string; cellId: string; requestId?: string | undefined },
) {
  const accepted = await readCurrentDraftSnapshot(actor, input.projectId);
  if (accepted.status === "unreadable")
    fail("The notebook could not be read.", {
      statusCode: 503,
      errorCode: "notebook_unreadable",
    });
  if (accepted.status !== "accepted")
    fail("That SQL cell is not in this project.", {
      statusCode: 404,
      errorCode: "project_sql_cell_not_found",
    });
  return runDataframe(
    actor,
    createRunStore(readDraftSnapshot),
    dataframeRequestSchema.parse({
      requestId: input.requestId ?? randomUUID(),
      snapshot: accepted.value.snapshot,
      cache: "reuse",
      mode: "auto",
      targetCellId: input.cellId,
      staleValues: "allow-compatible",
    }),
  );
}

async function runDataframe(
  actor: ExecutionActor,
  store: ReturnType<typeof createRunStore>,
  request: Exclude<RunRequest, { mode: "run-all" }>,
): Promise<TableOutput> {
  const { targetCellId } = request;
  const run = await store.admit(actor, request);
  if (run.status !== "admitted")
    fail("The notebook changed before the run started.", {
      statusCode: 409,
      errorCode: "project_query_changed",
    });
  if (!run.plan.admittedCellIds.includes(targetCellId))
    fail("The dataframe is incomplete. Run the source cell again.", {
      statusCode: 422,
      errorCode: "dataframe_incomplete",
    });
  const worker = createNotebookWorker(store, createHostedKernelPort(store));
  for (const _cell of run.plan.admittedCellIds)
    if (!(await worker(actor, run.runId))) break;
  const [target] = await getDb()
    .select({
      receipt: notebookRunAttempts.receipt,
      diagnostic: notebookRunAttempts.diagnostic,
    })
    .from(notebookRunWork)
    .innerJoin(
      notebookRunAttempts,
      eq(notebookRunAttempts.id, notebookRunWork.attemptId),
    )
    .where(
      and(
        eq(notebookRunWork.runId, run.runId),
        eq(notebookRunWork.cellId, targetCellId),
      ),
    )
    .limit(1);
  const state = target?.receipt.state;
  if (target?.diagnostic?.code === "superseded")
    fail("The notebook changed before the run finished.", {
      statusCode: 409,
      errorCode: "project_query_changed",
    });
  if (target?.diagnostic?.code === "dataframe_denied")
    fail("You don’t have access to a source used by this dataframe.", {
      statusCode: 403,
      errorCode: "dataframe_denied",
    });
  if (state?.status !== "complete" || !state.resultIds[0])
    fail("The dataframe query could not complete.", {
      statusCode: 422,
      errorCode: "dataframe_sql_failed",
    });
  const page = await getNotebookResultPage(actor, {
    resultId: state.resultIds[0],
    page: 1,
  });
  if (page.status === "denied")
    fail("You don’t have access to a source used by this dataframe.", {
      statusCode: 403,
      errorCode: "dataframe_denied",
    });
  if (
    page.status === "incomplete" ||
    (page.status === "ready" && page.manifest.status === "incomplete")
  )
    fail("The dataframe is incomplete. Run the source cell again.", {
      statusCode: 409,
      errorCode: "dataframe_incomplete",
    });
  if (
    page.status !== "ready" ||
    (page.manifest.status !== "complete" &&
      page.manifest.status !== "complete-empty")
  )
    fail("The dataframe could not be read.", {
      statusCode: 503,
      errorCode: "dataframe_unreadable",
    });
  const { manifest } = page;
  return {
    type: "table",
    columns: manifest.fields.map(({ name, type }) => ({
      name,
      type:
        type === "integer" || type === "decimal"
          ? "number"
          : type === "boolean" ||
              type === "number" ||
              type === "date" ||
              type === "datetime" ||
              type === "null"
            ? type
            : "string",
    })),
    rows: page.rows.map((row) =>
      row.map((value) => {
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "boolean" ||
          typeof value === "number"
        )
          return value;
        if (
          "type" in value &&
          "value" in value &&
          typeof value.value === "string"
        ) {
          if (
            value.type === "integer" &&
            Number.isSafeInteger(Number(value.value))
          )
            return Number(value.value);
          if (
            value.type === "decimal" ||
            value.type === "integer" ||
            value.type === "binary"
          )
            return value.value;
        }
        return JSON.stringify(value);
      }),
    ),
    rowCount: page.rows.length,
    truncated: BigInt(manifest.rowCount) > BigInt(page.rows.length),
    totalRows: manifest.rowCount,
  };
}
