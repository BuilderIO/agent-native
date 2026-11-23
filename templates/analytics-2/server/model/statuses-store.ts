import { fail } from "@agent-native/core/action";
import { isUniqueViolation } from "@agent-native/core/db";
import { and, desc, eq } from "@agent-native/core/db/schema";
import { sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { deleteNotebookStatus } from "./notebook-operations/store.js";
import { type WorkspaceScope, requireWorkspaceScope } from "./scope.js";

const { statuses } = schema;

type StatusRow = typeof statuses.$inferSelect;

export type ProjectStatusRecord = {
  id: string;
  /**
   * The member who created the status. The catalogue itself belongs to the
   * organisation, so this is author metadata and never an access boundary.
   */
  ownerEmail: string;
  name: string;
  description: string;
  color: string | null;
  endorsed: boolean;
  inLibrary: boolean;
  enforcesReview: boolean;
  sortOrder: number;
  isDefault: boolean;
};

/** Drizzle wraps the driver error, so walk the cause chain for the PG code. */
function isNameConflict(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    current !== null && current !== undefined && depth < 5;
    depth += 1
  ) {
    if (isUniqueViolation(current)) return true;
    const next = (current as { cause?: unknown }).cause;
    if (next === undefined || next === current) break;
    current = next;
  }
  return false;
}

export class StatusNameConflictError extends Error {
  readonly code = "analytics_status_name_conflict";
  readonly errorCode = this.code;
  readonly statusCode = 409;

  constructor(name: string) {
    super(`A status named "${name}" already exists in this workspace.`);
    this.name = "StatusNameConflictError";
  }
}

function toStatus(row: StatusRow): ProjectStatusRecord {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    name: row.name,
    description: row.description,
    color: row.color ?? null,
    endorsed: row.endorsed,
    inLibrary: row.inLibrary,
    enforcesReview: row.enforcesReview,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
  };
}

/**
 * The status catalogue belongs to the organisation, not to the member who
 * happened to create a label. Every member of the organisation reads the same
 * catalogue; a different organisation with the same email reads its own.
 *
 * The caller still supplies an explicit account + organisation scope so a
 * missing organisation can never fall through to a global list.
 */
export async function listStatuses(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
): Promise<ProjectStatusRecord[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const rows = await getDb()
    .select()
    .from(statuses)
    .where(eq(statuses.orgId, scope.orgId))
    .orderBy(statuses.sortOrder, statuses.name);
  return rows.map(toStatus);
}

export type CreateStatusInput = WorkspaceScope & {
  name: string;
  description?: string;
  color?: string | null;
  endorsed?: boolean;
  inLibrary?: boolean;
  enforcesReview?: boolean;
  sortOrder?: number;
};

export async function createStatus(
  input: CreateStatusInput,
): Promise<ProjectStatusRecord> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  const name = input.name.trim();
  if (name === "") throw new Error("A status needs a name.");
  const timestamp = nowIso();
  const id = newId("sts");
  try {
    await withStatusLock(scope, async (tx) => {
      const [last] = await tx
        .select({ sortOrder: statuses.sortOrder })
        .from(statuses)
        .where(eq(statuses.orgId, scope.orgId))
        .orderBy(desc(statuses.sortOrder))
        .limit(1);
      await tx.insert(statuses).values({
        id,
        // Author metadata: the row is shared with the organisation, but this
        // records who created it.
        ownerEmail: scope.ownerEmail,
        orgId: scope.orgId,
        name,
        description: input.description ?? "",
        color: input.color === undefined ? null : input.color,
        endorsed: input.endorsed === true,
        inLibrary: input.inLibrary === true,
        enforcesReview: input.enforcesReview === true,
        sortOrder: input.sortOrder ?? (last ? last.sortOrder + 1 : 0),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  } catch (error) {
    if (isNameConflict(error)) throw new StatusNameConflictError(name);
    throw error;
  }
  const row = await readStatusRow(scope, id);
  if (row === null) throw new Error("The status could not be read back.");
  return toStatus(row);
}

/**
 * Reads a catalogue row in the organisation. Membership/role authorization is
 * the action caller's job; the store only refuses to cross the organisation
 * boundary.
 */
async function readStatusRow(
  scope: WorkspaceScope,
  statusId: string,
): Promise<StatusRow | null> {
  const rows = await getDb()
    .select()
    .from(statuses)
    .where(and(eq(statuses.orgId, scope.orgId), eq(statuses.id, statusId)))
    .limit(1);
  return rows[0] ?? null;
}

export type UpdateStatusInput = WorkspaceScope & {
  statusId: string;
  name?: string;
  description?: string;
  color?: string | null;
  endorsed?: boolean;
  inLibrary?: boolean;
  enforcesReview?: boolean;
  sortOrder?: number;
};

export async function updateStatus(
  input: UpdateStatusInput,
): Promise<ProjectStatusRecord> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  const changes: Partial<typeof statuses.$inferInsert> = {
    updatedAt: nowIso(),
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === "") throw new Error("A status needs a name.");
    changes.name = name;
  }
  if (input.description !== undefined) changes.description = input.description;
  if (input.color !== undefined) changes.color = input.color;
  if (input.endorsed !== undefined) changes.endorsed = input.endorsed;
  if (input.inLibrary !== undefined) changes.inLibrary = input.inLibrary;
  if (input.enforcesReview !== undefined) {
    changes.enforcesReview = input.enforcesReview;
  }
  if (input.sortOrder !== undefined) changes.sortOrder = input.sortOrder;

  try {
    await withStatusLock(scope, async (tx) => {
      if (input.endorsed === true) {
        const [current] = await tx
          .select()
          .from(statuses)
          .where(
            and(
              eq(statuses.orgId, scope.orgId),
              eq(statuses.id, input.statusId),
            ),
          )
          .limit(1);
        if (current?.isDefault)
          fail("The default status cannot be endorsed.", {
            statusCode: 409,
            errorCode: "default_status_endorsed",
          });
      }
      await tx
        .update(statuses)
        .set(changes)
        .where(
          and(eq(statuses.orgId, scope.orgId), eq(statuses.id, input.statusId)),
        );
    });
  } catch (error) {
    if (isNameConflict(error)) {
      throw new StatusNameConflictError(
        typeof changes.name === "string" ? changes.name : input.statusId,
      );
    }
    throw error;
  }
  const row = await readStatusRow(scope, input.statusId);
  if (row === null) throw new Error("That status is not in this workspace.");
  return toStatus(row);
}

export async function deleteStatus(
  scopeInput: WorkspaceScope,
  statusId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await deleteNotebookStatus(scope, statusId);
}

type StatusTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function withStatusLock<T>(
  scope: WorkspaceScope,
  write: (tx: StatusTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`analytics-2:statuses:${scope.orgId}`}, 0))`,
    );
    return write(tx);
  });
}

export async function reorderStatuses(
  scopeInput: WorkspaceScope,
  ids: string[],
): Promise<ProjectStatusRecord[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  return withStatusLock(scope, async (tx) => {
    const rows = await tx
      .select()
      .from(statuses)
      .where(eq(statuses.orgId, scope.orgId));
    const present = new Set(rows.map((row) => row.id));
    if (
      ids.length !== rows.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !present.has(id))
    ) {
      fail("The status catalogue changed. Refresh and try again.", {
        statusCode: 409,
        errorCode: "data_status_order_conflict",
      });
    }
    for (const [sortOrder, id] of ids.entries()) {
      await tx
        .update(statuses)
        .set({ sortOrder, updatedAt: nowIso() })
        .where(and(eq(statuses.orgId, scope.orgId), eq(statuses.id, id)));
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id, sortOrder) => {
      const row = byId.get(id);
      if (!row)
        throw new Error("The status catalogue changed while reordering.");
      return { ...toStatus(row), sortOrder };
    });
  });
}

export async function setDefaultStatus(
  scopeInput: WorkspaceScope,
  id: string | null,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await withStatusLock(scope, async (tx) => {
    if (id !== null) {
      const [status] = await tx
        .select()
        .from(statuses)
        .where(and(eq(statuses.orgId, scope.orgId), eq(statuses.id, id)))
        .limit(1);
      if (!status)
        fail("That status is not in this workspace.", {
          statusCode: 404,
          errorCode: "data_status_not_found",
        });
      if (status.endorsed)
        fail("Endorsed statuses cannot be set as the default.", {
          statusCode: 400,
          errorCode: "default_status_endorsed",
        });
    }
    await tx
      .update(statuses)
      .set({ isDefault: false })
      .where(eq(statuses.orgId, scope.orgId));
    if (id !== null)
      await tx
        .update(statuses)
        .set({ isDefault: true })
        .where(and(eq(statuses.orgId, scope.orgId), eq(statuses.id, id)));
  });
}
