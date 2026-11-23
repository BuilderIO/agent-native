import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "@agent-native/core/db/schema";
import { isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { Cell } from "../../app/lib/model/contracts.js";
import { sqlDataframeReferences } from "../../shared/sql-dataframe-references.js";
import { sqlInputReferences } from "../../shared/sql-input-name.js";
import { schema } from "../db/index.js";
import type { Queryable } from "./scope.js";

const { cellOutputs, cellOutputGenerations } = schema;
const undoLifetimeMs = 24 * 60 * 60 * 1000;
const outputUndoSchema = z.object({
  token: z.uuid(),
  versionId: z.string(),
  generation: z.string(),
  fingerprint: z.string(),
  expiresAt: z.iso.datetime(),
});

function outputForCell(cell: Cell) {
  return and(
    eq(cellOutputs.projectId, cell.projectId),
    eq(cellOutputs.cellId, cell.id),
  );
}

async function queryBasis(cell: Cell, cells: readonly Cell[], tx: Queryable) {
  const inputs = new Set<string>();
  const dependencies = new Map<string, Cell>();
  const queries: unknown[] = [];
  function visit(query: Cell, preceding: readonly Cell[]) {
    const contents = query.contents;
    if (contents.kind !== "sql") return;
    queries.push([
      query.id,
      contents.source,
      contents.dataConnectionId,
      contents.connectionMode,
      contents.databaseSchema,
    ]);
    for (const name of sqlInputReferences(contents.source)) inputs.add(name);
    if (contents.connectionMode !== "dataframes") return;
    const candidates = Array.from(preceding.entries()).reverse();
    for (const name of sqlDataframeReferences(contents.source)) {
      for (const [index, dependency] of candidates) {
        if (
          dependency.contents.kind !== "sql" ||
          (dependency.contents.resultVariable !== name &&
            dependency.contents.resultVariable?.toLowerCase() !== name)
        )
          continue;
        if (!dependencies.has(dependency.id)) {
          dependencies.set(dependency.id, dependency);
          visit(dependency, preceding.slice(0, index));
        }
        break;
      }
    }
  }
  visit(
    cell,
    cells.slice(
      0,
      cells.findIndex(({ id }) => id === cell.id),
    ),
  );

  const values: unknown[] = [];
  let latestDependency = "";
  for (const { id, contents, updatedAt } of cells) {
    if (contents.kind === "input" && inputs.has(contents.name)) {
      values.push([
        id,
        contents.name,
        contents.inputType,
        contents.defaultValueString,
        contents.options,
      ]);
      if (updatedAt > latestDependency) latestDependency = updatedAt;
    }
  }
  const ids = [...dependencies.keys()];
  const results =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: cellOutputs.cellId,
            runId: cellOutputs.runId,
            ranAt: cellOutputs.ranAt,
            status: cellOutputs.status,
            generation: cellOutputGenerations.generation,
          })
          .from(cellOutputs)
          .innerJoin(
            cellOutputGenerations,
            and(
              eq(cellOutputGenerations.projectId, cellOutputs.projectId),
              eq(cellOutputGenerations.cellId, cellOutputs.cellId),
            ),
          )
          .where(
            and(
              eq(cellOutputs.projectId, cell.projectId),
              inArray(cellOutputs.cellId, ids),
              isNull(cellOutputs.undo),
            ),
          )
          .orderBy(cellOutputs.cellId);
  for (const result of results) {
    if (result.ranAt > latestDependency) latestDependency = result.ranAt;
  }
  const usable =
    results.length === ids.length &&
    results.every(
      ({ status, runId, generation }) =>
        status === "complete" && runId === generation,
    );
  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify([queries, values, results]))
      .digest("hex"),
    latestDependency,
    usable,
  };
}

export async function retainDeletedCellOutput(
  cell: Cell,
  cells: readonly Cell[],
  token: string,
  warehouseGeneration: string | null | undefined,
  tx: Queryable,
) {
  const now = Date.now();
  await tx
    .delete(cellOutputs)
    .where(
      and(
        eq(cellOutputs.projectId, cell.projectId),
        sql`${cellOutputs.undo}->>'expiresAt' < ${new Date(now).toISOString()}`,
      ),
    );
  const [output] = await tx
    .select({
      status: cellOutputs.status,
      hasOutput: isNotNull(cellOutputs.output),
      hasProvenance: cellOutputs.connectionProvenanceRecorded,
      runId: cellOutputs.runId,
      ranAt: cellOutputs.ranAt,
      generation: cellOutputGenerations.generation,
    })
    .from(cellOutputs)
    .innerJoin(
      cellOutputGenerations,
      and(
        eq(cellOutputGenerations.projectId, cellOutputs.projectId),
        eq(cellOutputGenerations.cellId, cellOutputs.cellId),
      ),
    )
    .where(and(outputForCell(cell), isNull(cellOutputs.undo)))
    .limit(1);
  if (
    !output?.hasOutput ||
    !output.hasProvenance ||
    (output.status !== "complete" && output.status !== "error") ||
    (warehouseGeneration === undefined ? output.runId : warehouseGeneration) !==
      output.generation
  )
    return false;
  const basis = await queryBasis(cell, cells, tx);
  if (!basis.usable || basis.latestDependency > output.ranAt) return false;
  await tx
    .update(cellOutputs)
    .set({
      undo: outputUndoSchema.parse({
        token,
        versionId: cell.versionId,
        generation: output.generation,
        fingerprint: basis.fingerprint,
        expiresAt: new Date(now + undoLifetimeMs).toISOString(),
      }),
    })
    .where(outputForCell(cell));
  return true;
}

export async function restoreDeletedCellOutput(
  cell: Cell,
  cells: readonly Cell[],
  token: string | undefined,
  tx: Queryable,
) {
  const [row] = await tx
    .select({
      undo: cellOutputs.undo,
      generation: cellOutputGenerations.generation,
    })
    .from(cellOutputs)
    .innerJoin(
      cellOutputGenerations,
      and(
        eq(cellOutputGenerations.projectId, cellOutputs.projectId),
        eq(cellOutputGenerations.cellId, cellOutputs.cellId),
      ),
    )
    .where(and(outputForCell(cell), isNotNull(cellOutputs.undo)))
    .limit(1);
  if (!row) return;
  const undo = outputUndoSchema.parse(row.undo);
  if (
    undo.token === token &&
    row.generation === token &&
    undo.versionId === cell.versionId &&
    undo.expiresAt >= new Date().toISOString()
  ) {
    const basis = await queryBasis(cell, cells, tx);
    if (basis.usable && basis.fingerprint === undo.fingerprint) {
      await tx
        .update(cellOutputs)
        .set({ undo: null })
        .where(outputForCell(cell));
      return undo.generation;
    }
  }
  await tx.delete(cellOutputs).where(outputForCell(cell));
}
