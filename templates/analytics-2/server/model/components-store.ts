import { fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { and, eq, inArray } from "@agent-native/core/db/schema";
import { asc } from "drizzle-orm";
import { z } from "zod";

import {
  cellContentsSchema,
  cellOutputSchema,
  withoutPendingCellEdit,
  type CellOutput,
} from "../../app/lib/model/contracts.js";
import { getDb, schema } from "../db/index.js";
import { sqlSource } from "../execution/source-resolver.js";
import { nowIso } from "./clock.js";
import { assertDataframeConnectionAccess } from "./data-connections.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { withoutDataframeReference } from "./dataframe-materialization.js";
import { decodeJsonColumn, StoredDataError } from "./json-column.js";
import { getNotebookExecution } from "./notebook-execution/draft-state.js";
import {
  getNotebookResultPage,
  loadNotebookResult,
} from "./notebook-results.js";
import { readProjectOutputs } from "./runs-store.js";
import { type WorkspaceScope, requireWorkspaceScope } from "./scope.js";

const { cells, projects } = schema;

export type ComponentCell = {
  /** The cell's kind and contents exactly as captured. */
  id: string;
  kind: string;
  label: string | null;
  order: string;
  contents: Record<string, unknown>;
  /** The result that cell had when the component was captured, if any. */
  output?: unknown;
  sourceConnectionIds?: string[];
};

export type Component = {
  id: string;
  name: string;
  sourceProjectId: string;
  cellCount: number;
  createdAt: string;
  updatedAt: string;
};

type StoredComponentRow = {
  id: string;
  name: string;
  sourceProjectId: string;
  cellsJson: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const storedCellsSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    label: z.string().nullable(),
    order: z.string(),
    contents: z.record(z.string(), z.unknown()),
    output: cellOutputSchema.optional(),
    sourceConnectionIds: z.unknown().optional(),
  }),
);

function storedCells(row: StoredComponentRow) {
  const parsed = decodeJsonColumn(row.cellsJson, storedCellsSchema);
  if (!parsed)
    throw new StoredDataError("A component snapshot is missing its cells.");
  return parsed;
}

function toComponent(row: StoredComponentRow): Component {
  return {
    id: row.id,
    name: row.name,
    sourceProjectId: row.sourceProjectId,
    cellCount: storedCells(row).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Every component this workspace can import. Scoped by owner and organisation,
 * so one member's components are not listed to another.
 */
export async function listComponents(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
): Promise<Component[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const result = await getDbExec().execute({
    sql: `SELECT "id", "name", "source_project_id" AS "sourceProjectId",
                 "cells_json" AS "cellsJson", "created_at" AS "createdAt",
                 "updated_at" AS "updatedAt"
            FROM "analytics2_components"
           WHERE "owner_email" = ? AND "org_id" = ?
           ORDER BY LOWER("name")`,
    args: [scope.ownerEmail, scope.orgId],
  });
  return (result.rows as StoredComponentRow[]).map(toComponent);
}

function durableColumnType(
  type: string,
): "string" | "number" | "boolean" | "date" | "datetime" | "null" {
  if (type === "integer" || type === "decimal") return "number";
  if (
    type === "number" ||
    type === "boolean" ||
    type === "date" ||
    type === "datetime" ||
    type === "null"
  )
    return type;
  return "string";
}

function durableCellValue(
  value: unknown,
  fieldType: string | undefined,
): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value &&
    typeof value.value === "string" &&
    (value.type === "integer" ||
      value.type === "decimal" ||
      value.type === "binary") &&
    (fieldType === undefined || value.type === fieldType)
  ) {
    if (value.type === "integer" || value.type === "decimal") {
      const numeric = Number(value.value);
      if (Number.isFinite(numeric) && String(numeric) === value.value)
        return numeric;
    }
    return value.value;
  }
  return JSON.stringify(value);
}

/**
 * Captures the chosen cells as a component. Every cell must belong to the named
 * project and to the caller's workspace: a component cannot be made from cells
 * the caller cannot read, and a partial match is refused rather than silently
 * dropping the missing ones.
 */
export async function createComponent(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  input: {
    projectId: string;
    name: string;
    cellIds: readonly string[];
    /** The action caller whose access each derived result's sources must allow. */
    caller?: string;
  },
): Promise<Component> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const name = input.name.trim();
  if (name === "") fail("Give the component a name.", { statusCode: 400 });

  const project = await getDb()
    .select({ id: projects.id, workingVersionId: projects.workingVersionId })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
      ),
    )
    .limit(1);
  const target = project[0];
  if (!target) fail("That project is not available.", { statusCode: 404 });

  const wanted = [...new Set(input.cellIds)];
  const rows = await getDb()
    .select({
      id: cells.id,
      kind: cells.kind,
      label: cells.label,
      order: cells.order,
      contents: cells.contents,
    })
    .from(cells)
    .where(
      and(
        eq(cells.projectId, input.projectId),
        eq(cells.versionId, target.workingVersionId),
        inArray(cells.id, wanted),
      ),
    )
    .orderBy(asc(cells.order));
  if (rows.length !== wanted.length) {
    fail("Every selected cell must still be in this project.", {
      statusCode: 409,
    });
  }

  const caller = input.caller ?? "unknown";
  const actor = {
    orgId: scope.orgId,
    ownerEmail: scope.ownerEmail,
    caller,
  };
  const durableExecution = await getNotebookExecution(actor, input.projectId);
  const outputs = await readProjectOutputs(scope, input.projectId, undefined, {
    cellIds: wanted,
    includeDataframeReferences: true,
  });
  const captured: ComponentCell[] = [];
  for (const row of rows) {
    const parsed = decodeJsonColumn(row.contents, cellContentsSchema);
    if (!parsed)
      throw new StoredDataError("A stored cell is missing its contents.");
    const contents = withoutPendingCellEdit(parsed);
    const durableResultId =
      durableExecution.status === "found"
        ? (durableExecution.cells[row.id]?.resultId ?? null)
        : null;

    let durableOutput: CellOutput | null = null;
    const connectionIds = new Set<string>();
    if (durableResultId) {
      const loaded = await loadNotebookResult(actor, durableResultId);
      if (loaded.status === "denied" || loaded.status === "unreadable") {
        fail(
          "This result has no verifiable source provenance. Run it again to capture it.",
          {
            statusCode: 409,
            errorCode: "component_provenance_unavailable",
          },
        );
      }
      if (loaded.status === "found") {
        const page = await getNotebookResultPage(actor, {
          resultId: durableResultId,
          page: 1,
        });
        if (page.status === "ready") {
          const { manifest } = page;
          const knownRows =
            manifest.status === "complete" ||
            manifest.status === "complete-empty"
              ? manifest.rowCount
              : manifest.verifiedRowCount;
          if (loaded.row.authorities !== null) {
            for (const authority of loaded.row.authorities)
              connectionIds.add(authority.connectionId);
          } else if (
            manifest.result.sourceGeneration !== null &&
            contents.kind === "sql"
          ) {
            const source = sqlSource(contents);
            if (source?.kind === "warehouse") connectionIds.add(source.id);
          }
          durableOutput = {
            type: "table",
            columns: manifest.fields.map(({ name: colName, type }) => ({
              name: colName,
              type: durableColumnType(type),
            })),
            rows: page.rows.map((entry) =>
              entry.map((value, index) =>
                durableCellValue(value, manifest.fields[index]?.type),
              ),
            ),
            rowCount: Number(knownRows),
            truncated:
              manifest.status === "incomplete" ||
              BigInt(knownRows) > BigInt(page.rows.length),
            totalRows: knownRows,
          };
        }
      }
    }

    const record = outputs[row.id];
    const stored = durableOutput ?? record?.output ?? null;
    if (
      !durableOutput &&
      stored &&
      record?.connectionProvenanceRecorded === false
    ) {
      fail(
        "This result has no verifiable source provenance. Run it again to capture it.",
        {
          statusCode: 409,
          errorCode: "component_provenance_unavailable",
        },
      );
    }
    if (!durableOutput) {
      if (record?.sourceConnectionId)
        connectionIds.add(record.sourceConnectionId);
      if (stored?.type === "table" && stored.materialization) {
        for (const dependency of stored.materialization.dependencies) {
          if (dependency.connectionId)
            connectionIds.add(dependency.connectionId);
        }
      }
    }
    if (connectionIds.size > 1000) {
      fail("The component result has too many data sources to capture.", {
        statusCode: 409,
        errorCode: "component_provenance_unavailable",
      });
    }
    for (const connectionId of connectionIds)
      await assertDataframeConnectionAccess(connectionId, caller);
    const output = withoutDataframeReference(stored);
    captured.push({
      id: row.id,
      kind: row.kind,
      label: row.label ?? null,
      order: row.order,
      contents,
      ...(output ? { output, sourceConnectionIds: [...connectionIds] } : {}),
    });
  }

  const normalized = normalizeName(name);
  const existing = await getDbExec().execute({
    sql: `SELECT "id" FROM "analytics2_components"
           WHERE "owner_email" = ? AND "org_id" = ? AND "normalized_name" = ?`,
    args: [scope.ownerEmail, scope.orgId, normalized],
  });
  if (existing.rows.length > 0) {
    fail(`A component named "${name}" already exists.`, { statusCode: 409 });
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  await getDbExec().execute({
    sql: `INSERT INTO "analytics2_components"
            ("id", "owner_email", "org_id", "source_project_id", "name",
             "normalized_name", "cells_json", "created_at", "updated_at")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      scope.ownerEmail,
      scope.orgId,
      input.projectId,
      name,
      normalized,
      JSON.stringify(captured),
      now,
      now,
    ],
  });
  return {
    id,
    name,
    sourceProjectId: input.projectId,
    cellCount: captured.length,
    createdAt: now,
    updatedAt: now,
  };
}

/** One component with the cells it captured, for the cell that imports it. */
export async function readComponent(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  componentId: string,
  caller = "unknown",
): Promise<{ component: Component; cells: ComponentCell[] } | null> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const result = await getDbExec().execute({
    sql: `SELECT "id", "name", "source_project_id" AS "sourceProjectId",
                 "cells_json" AS "cellsJson", "created_at" AS "createdAt",
                 "updated_at" AS "updatedAt"
            FROM "analytics2_components"
           WHERE "id" = ? AND "owner_email" = ? AND "org_id" = ?`,
    args: [componentId, scope.ownerEmail, scope.orgId],
  });
  const row = (result.rows as StoredComponentRow[])[0];
  if (!row) return null;
  const cells = storedCells(row);
  for (const cell of cells) {
    if (cell.output === undefined) continue;
    if (
      !Array.isArray(cell.sourceConnectionIds) ||
      cell.sourceConnectionIds.length > 1000 ||
      cell.sourceConnectionIds.some(
        (id) => typeof id !== "string" || id.length === 0,
      )
    ) {
      fail(
        "This component result has no verifiable source provenance. Capture it again to use it.",
        {
          statusCode: 409,
          errorCode: "component_provenance_unavailable",
        },
      );
    }
    for (const connectionId of new Set(cell.sourceConnectionIds))
      await assertDataframeConnectionAccess(connectionId, caller);
  }
  return {
    component: toComponent(row),
    cells: cells.map(({ sourceConnectionIds: _sources, output, ...cell }) => ({
      ...cell,
      ...(output === undefined
        ? {}
        : { output: withoutDataframeReference(output) }),
    })),
  };
}
