import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "@agent-native/core/db/schema";

import type {
  CellOutput,
  CellRun,
  RunStatus,
} from "../../app/lib/model/contracts.js";
import {
  cellContentsSchema,
  cellOutputSchema,
} from "../../app/lib/model/contracts.js";
import {
  authorizedNotebookSnapshotRefSchema,
  outputFenceSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  registerOutputDataframe,
  sweepDataframeBlobs,
  sweepDataframeBlobsAfterWrite,
} from "./dataframe-lifecycle.js";
import { withoutDataframeReference } from "./dataframe-materialization.js";
import { newId } from "./ids.js";
import {
  decodeJsonColumn,
  encodeJsonColumn,
  StoredDataError,
} from "./json-column.js";
import { consumeReactiveInputs } from "./notebook-execution/reactive.js";
import {
  invalidateNotebookRunOutputs,
  lockNotebookRunOutputs,
} from "./notebook-execution/run-store.js";
import {
  draftNamespace,
  MAX_NOTEBOOK_CELLS,
} from "./notebook-execution/snapshot.js";
import {
  assertAuthorizedProject,
  assertEditableProject,
  assertReadableProject,
  getAuthorizedProjectRow,
  assertCellInProject,
} from "./project-access.js";
import {
  RunTransitionError,
  requireStoredRunStatus,
  requireTerminalRunStatus,
} from "./run-machine.js";
import {
  type Queryable,
  type WorkspaceScope,
  requireWorkspaceScope,
} from "./scope.js";

const { runs, cellOutputs, cellOutputGenerations } = schema;

export type RunScope = WorkspaceScope & { projectId: string };

/** Advance or lock the shared output generation in the caller's transaction. */
export async function reserveCellOutputGeneration(
  projectId: string,
  cellId: string,
  generation: string,
  tx: Queryable,
): Promise<void> {
  const rows = await tx
    .insert(cellOutputGenerations)
    .values({ projectId, cellId, generation })
    .onConflictDoUpdate({
      target: cellOutputGenerations.cellId,
      set: { generation },
      setWhere: eq(cellOutputGenerations.projectId, projectId),
    })
    .returning({ cellId: cellOutputGenerations.cellId });
  if (rows.length === 0)
    throw new RunTransitionError("This cell belongs to another project.");
}

export async function lockCellOutputForEdit(
  projectId: string,
  cellId: string,
  tx: Queryable,
): Promise<boolean> {
  const candidate = randomUUID();
  const rows = await tx
    .insert(cellOutputGenerations)
    .values({ projectId, cellId, generation: candidate })
    .onConflictDoUpdate({
      target: cellOutputGenerations.cellId,
      set: { generation: sql`${cellOutputGenerations.generation}` },
      setWhere: eq(cellOutputGenerations.projectId, projectId),
    })
    .returning({
      cellId: cellOutputGenerations.cellId,
      generation: cellOutputGenerations.generation,
    });
  if (rows.length === 0)
    throw new RunTransitionError("This cell belongs to another project.");
  return rows[0]?.generation === candidate;
}

export class CellOutputGenerationConflict extends RunTransitionError {}
export class CellOutputGenerationUnavailable extends Error {
  readonly code = "project_query_recovery_required";
  readonly statusCode = 409;
  constructor() {
    super("This query cannot be resumed. Run the cell again.");
  }
}

export async function lockCellOutputGeneration(
  projectId: string,
  cellId: string,
  expected: string | undefined,
  tx: Queryable,
): Promise<void> {
  if (expected === undefined) {
    await reserveCellOutputGeneration(projectId, cellId, randomUUID(), tx);
    return;
  }
  const rows = await tx
    .update(cellOutputGenerations)
    .set({ generation: expected })
    .where(
      and(
        eq(cellOutputGenerations.projectId, projectId),
        eq(cellOutputGenerations.cellId, cellId),
        eq(cellOutputGenerations.generation, expected),
      ),
    )
    .returning({ cellId: cellOutputGenerations.cellId });
  if (rows.length === 0) {
    const existing = await tx
      .select({ generation: cellOutputGenerations.generation })
      .from(cellOutputGenerations)
      .where(
        and(
          eq(cellOutputGenerations.projectId, projectId),
          eq(cellOutputGenerations.cellId, cellId),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new CellOutputGenerationUnavailable();
    throw new CellOutputGenerationConflict(
      "A newer run or cleared output owns this cell.",
    );
  }
}

export type RecordRunInput = RunScope & {
  cellId: string;
  generation?: string;
  /** A finished outcome; live states belong on the cell output, not history. */
  status: RunStatus;
  output?: CellOutput | null;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  sourceConnectionId?: string | null;
};
async function outputConnectionId(
  input: RunScope & { cellId: string; sourceConnectionId?: string | null },
  db: Queryable,
): Promise<string | null> {
  const project = await assertEditableProject(input, input.projectId, db);
  const rows = await db
    .select({ contents: schema.cells.contents })
    .from(schema.cells)
    .where(
      and(
        eq(schema.cells.projectId, input.projectId),
        eq(schema.cells.versionId, project.workingVersionId),
        eq(schema.cells.id, input.cellId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("The output cell is not in the working project.");
  const contents = decodeJsonColumn(row.contents, cellContentsSchema);
  if (!contents)
    throw new StoredDataError(
      "The output cell contents are missing. This record needs repair.",
    );
  if (input.sourceConnectionId !== undefined) {
    if (contents.kind === "sql" && input.sourceConnectionId === null)
      throw new Error(
        "A SQL output must name the connection that produced it.",
      );
    return input.sourceConnectionId;
  }
  return contents.kind === "sql" ? contents.dataConnectionId : null;
}

/**
 * Appends an immutable, terminal run to the project's history and replaces the
 * cell's shown output. Both writes share one transaction: a rejected output
 * write (for example, an older run arriving after a newer one) leaves no
 * history row behind.
 */
export async function recordRun(
  input: RecordRunInput,
  db?: Queryable,
): Promise<CellRun> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  const status = requireTerminalRunStatus(input.status);
  await assertEditableProject(scope, input.projectId);
  await assertCellInProject(input.projectId, input.cellId);

  const runId = newId("run");
  const startedAt = input.startedAt ?? nowIso();
  const output = cellOutputSchema.nullable().parse(input.output ?? null);
  const finishedAt = input.finishedAt ?? null;
  const durationMs = input.durationMs ?? null;

  const write = async (tx: Queryable): Promise<CellRun> => {
    await lockCellOutputGeneration(
      input.projectId,
      input.cellId,
      input.generation,
      tx,
    );
    const sourceConnectionId = await outputConnectionId(input, tx);
    await registerOutputDataframe(tx, scope, input.projectId, output);
    await tx.insert(runs).values({
      id: runId,
      projectId: input.projectId,
      cellId: input.cellId,
      status,
      startedAt,
      finishedAt,
      durationMs,
      output: output === null ? null : encodeJsonColumn(output),
    });

    const values = {
      cellId: input.cellId,
      projectId: input.projectId,
      runId,
      sourceConnectionId,
      connectionProvenanceRecorded: true,
      status,
      output: output === null ? null : encodeJsonColumn(output),
      ranAt: finishedAt ?? startedAt,
      undo: null,
    };
    const written = await tx
      .insert(cellOutputs)
      .values(values)
      .onConflictDoUpdate({
        target: cellOutputs.cellId,
        set: values,
        // CAS guard: an output only moves forward. Equal timestamps are broken
        // by run id so two writers cannot ping-pong a cell indefinitely.
        setWhere: sql`${cellOutputs.ranAt} < ${values.ranAt}
          OR (${cellOutputs.ranAt} = ${values.ranAt}
            AND coalesce(${cellOutputs.runId}, '') < ${runId})`,
      })
      .returning({ cellId: cellOutputs.cellId });
    if (written.length === 0) {
      throw new RunTransitionError(
        "A newer run already owns this cell output; the older result was ignored.",
      );
    }

    return {
      id: runId,
      projectId: input.projectId,
      cellId: input.cellId,
      status,
      startedAt,
      finishedAt,
      durationMs,
      output: withoutDataframeReference(output),
    };
  };
  if (db) return write(db);
  const run = await getDb().transaction(write);
  await sweepDataframeBlobsAfterWrite(scope, input.projectId);
  return run;
}

export type WriteCellOutputInput = RunScope & {
  cellId: string;
  generation?: string;
  runId: string | null;
  status: RunStatus;
  output: CellOutput | null;
  ranAt?: string;
  sourceConnectionId?: string | null;
};

/**
 * Replaces the output a cell shows. One row per cell, so the page never has to
 * decide which of several outputs is the current one. Public callers must
 * already have an authorised parent project.
 */
export async function writeCellOutput(
  input: WriteCellOutputInput,
  db?: Queryable,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  const write = async (tx: Queryable): Promise<void> => {
    await assertEditableProject(scope, input.projectId, tx);
    await assertCellInProject(input.projectId, input.cellId, tx);
    await lockCellOutputGeneration(
      input.projectId,
      input.cellId,
      input.generation,
      tx,
    );
    const ranAt = input.ranAt ?? nowIso();
    const sourceConnectionId = await outputConnectionId(input, tx);
    const output =
      input.output === null ? null : cellOutputSchema.parse(input.output);
    await registerOutputDataframe(tx, scope, input.projectId, output);
    const values = {
      cellId: input.cellId,
      projectId: input.projectId,
      runId: input.runId,
      sourceConnectionId,
      connectionProvenanceRecorded: true,
      status: requireStoredRunStatus(input.status),
      output: output === null ? null : encodeJsonColumn(output),
      ranAt,
      undo: null,
    };
    await tx
      .insert(cellOutputs)
      .values(values)
      .onConflictDoUpdate({ target: cellOutputs.cellId, set: values });
  };
  if (db) return write(db);
  await getDb().transaction(write);
  await sweepDataframeBlobsAfterWrite(scope, input.projectId);
}

export type CellOutputRecord = {
  cellId: string;
  status: RunStatus;
  output: CellOutput | null;
  ranAt: string;
  sourceConnectionId: string | null;
  connectionProvenanceRecorded: boolean;
};

/** The output a cell currently shows, or null when it has never run. */
export async function readCellOutput(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  cellId: string,
): Promise<CellOutputRecord | null> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertEditableProject(scope, projectId);
  await assertCellInProject(projectId, cellId);
  const rows = await getDb()
    .select()
    .from(cellOutputs)
    .where(
      and(
        eq(cellOutputs.projectId, projectId),
        eq(cellOutputs.cellId, cellId),
        isNull(cellOutputs.undo),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    cellId: row.cellId,
    sourceConnectionId: row.sourceConnectionId,
    connectionProvenanceRecorded: row.connectionProvenanceRecorded,
    status: requireStoredRunStatus(row.status),
    output: withoutDataframeReference(
      decodeJsonColumn(row.output, cellOutputSchema),
    ),
    ranAt: row.ranAt,
  };
}

export async function readProjectOutputs(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  versionId?: string,
  options?: {
    includeDataframeReferences?: boolean;
    cellIds?: readonly string[];
  },
): Promise<Record<string, CellOutputRecord>> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertReadableProject(scope, projectId);
  let rows: Omit<typeof cellOutputs.$inferSelect, "runId" | "undo">[];
  if (versionId === undefined) {
    rows =
      options?.cellIds?.length === 0
        ? []
        : await getDb()
            .select()
            .from(cellOutputs)
            .where(
              and(
                eq(cellOutputs.projectId, projectId),
                isNull(cellOutputs.undo),
                options?.cellIds
                  ? inArray(cellOutputs.cellId, [...options.cellIds])
                  : undefined,
              ),
            );
  } else {
    const [version] = await getDb()
      .select({
        capturedOutputCount: schema.projectVersions.capturedOutputCount,
        kind: schema.projectVersions.kind,
      })
      .from(schema.projectVersions)
      .where(
        and(
          eq(schema.projectVersions.projectId, projectId),
          eq(schema.projectVersions.id, versionId),
        ),
      )
      .limit(1);
    if (!version)
      fail("That published version is not available.", {
        statusCode: 404,
        errorCode: "project_version_not_found",
      });
    if (
      version.kind !== "published" &&
      !(await getAuthorizedProjectRow(scope, projectId))
    )
      fail("That version is not available.", {
        statusCode: 404,
        errorCode: "project_version_not_found",
      });
    const count = version.capturedOutputCount;
    if (count === null)
      fail(
        "This published version has no saved result snapshot. Ask its owner to review and republish the project.",
        {
          statusCode: 409,
          errorCode: "published_snapshot_unavailable",
        },
      );
    if (!Number.isSafeInteger(count) || count < 0)
      throw new StoredDataError(
        "The published result snapshot metadata is unreadable.",
      );
    rows = await getDb()
      .select()
      .from(schema.publishedCellOutputs)
      .where(
        and(
          eq(schema.publishedCellOutputs.projectId, projectId),
          eq(schema.publishedCellOutputs.versionId, versionId),
        ),
      );
    if (rows.length !== count)
      throw new StoredDataError("The published result snapshot is incomplete.");
    if (options?.cellIds) {
      const wanted = new Set(options.cellIds);
      rows = rows.filter((row) => wanted.has(row.cellId));
    }
  }
  const outputs: Record<string, CellOutputRecord> = {};
  for (const row of rows) {
    const output = decodeJsonColumn(row.output, cellOutputSchema);
    if (
      !options?.includeDataframeReferences &&
      output?.type === "table" &&
      output.materialization
    )
      fail(
        "Warehouse-derived dataframe results can only be read by a caller that authorizes their sources.",
        { statusCode: 409, errorCode: "project_dataframe_capture_unavailable" },
      );
    outputs[row.cellId] = {
      cellId: row.cellId,
      sourceConnectionId: row.sourceConnectionId,
      connectionProvenanceRecorded: row.connectionProvenanceRecorded,
      status: requireStoredRunStatus(row.status),
      output: options?.includeDataframeReferences
        ? output
        : withoutDataframeReference(output),
      ranAt: row.ranAt,
    };
  }
  return outputs;
}

/** Recent runs of a project, newest first. */
export async function listRuns(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  limit = 50,
): Promise<CellRun[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertReadableProject(scope, projectId);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Run history limit must be a positive integer.");
  }
  const rows = await getDb()
    .select()
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(Math.min(limit, 200));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    cellId: row.cellId,
    status: requireStoredRunStatus(row.status),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    durationMs: row.durationMs ?? null,
    output: decodeJsonColumn(row.output, cellOutputSchema),
  }));
}

/**
 * Forgets every saved cell output of a project, which is what the project
 * options' "Clear outputs" action does. Cell results stay in their run rows;
 * only the last-shown output is removed.
 */
export async function clearProjectOutputs(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const initial = await assertAuthorizedProject(scope, projectId);
  const namespace = draftNamespace(scope, projectId);
  await getDb().transaction(async (tx) => {
    const projectCells = await tx
      .select({ id: schema.cells.id })
      .from(schema.cells)
      .where(
        and(
          eq(schema.cells.projectId, projectId),
          eq(schema.cells.versionId, initial.workingVersionId),
        ),
      )
      .orderBy(schema.cells.id)
      .limit(MAX_NOTEBOOK_CELLS + 1);
    if (projectCells.length > MAX_NOTEBOOK_CELLS)
      fail("Too many cells to clear outputs.", {
        statusCode: 409,
        errorCode: "notebook_too_large",
      });
    const fences = projectCells.map(({ id }) =>
      outputFenceSchema.parse({ cellId: id, outputGeneration: randomUUID() }),
    );
    for (const { cellId } of fences)
      await lockCellOutputForEdit(projectId, cellId, tx);
    await lockNotebookRunOutputs(
      tx,
      namespace.namespaceId,
      fences.map(({ cellId }) => cellId),
      true,
    );
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, projectId),
          eq(schema.projects.orgId, scope.orgId),
          eq(schema.projects.ownerEmail, scope.ownerEmail),
          isNull(schema.projects.trashedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !project ||
      project.workingVersionId !== initial.workingVersionId ||
      project.notebookRevision !== initial.notebookRevision
    )
      fail("The notebook changed. Try clearing outputs again.", {
        statusCode: 409,
        errorCode: "notebook_snapshot_conflict",
      });
    for (const { cellId, outputGeneration } of fences)
      await reserveCellOutputGeneration(
        projectId,
        cellId,
        outputGeneration,
        tx,
      );
    await invalidateNotebookRunOutputs(tx, {
      snapshot: authorizedNotebookSnapshotRefSchema.parse({
        workspaceId: scope.orgId,
        projectId,
        head: {
          versionId: project.workingVersionId,
          revision: String(project.notebookRevision),
        },
        eventSeq: String(project.notebookEventSeq),
      }),
      namespace,
      inputRevision: revisionSchema.parse(
        String(project.notebookInputRevision),
      ),
      cause: "clear",
      outputs: fences,
    });
    await consumeReactiveInputs(tx, projectId);
    await tx.delete(cellOutputs).where(eq(cellOutputs.projectId, projectId));
  });
  await sweepDataframeBlobs(scope, projectId);
}

/** Forgets what a cell last showed, after its source was emptied. */
export async function clearCellOutput(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  cellId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertEditableProject(scope, projectId);
  await getDb().transaction(async (tx) => {
    await assertCellInProject(projectId, cellId, tx);
    await reserveCellOutputGeneration(projectId, cellId, randomUUID(), tx);
    await tx
      .delete(cellOutputs)
      .where(
        and(
          eq(cellOutputs.projectId, projectId),
          eq(cellOutputs.cellId, cellId),
        ),
      );
  });
  await sweepDataframeBlobs(scope, projectId);
}

// Re-exported so callers can match the typed failure without importing the
// machine module themselves.
export { RunTransitionError };
