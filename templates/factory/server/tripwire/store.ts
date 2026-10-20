import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import { factoryTripwires } from "../db/schema.js";
import type { TripwireScope } from "./types.js";

// Any Drizzle PostgreSQL database: the app's `getDb()`, a transaction, or a
// PGlite instance in a spec.
type TripwireDatabase = PgDatabase<any, any>;

/** The newest rows kept for each factory; older ones are deleted as new ones arrive. */
export const TRIPWIRE_KEEP_PER_FACTORY = 500;
/** The newest rows kept for each organization across its factories, so the count of factories never sets how many rows the table holds. */
export const TRIPWIRE_KEEP_PER_ORG = 2_000;
/** Rows one prune deletes, so a factory far past the cap converges without one large delete. */
export const TRIPWIRE_PRUNE_BATCH = 50;
const TRIPWIRE_LIST_MAX = 200;
const TRIPWIRE_COUNT_GROUPS_MAX = 60;

export interface TripwireRow {
  id: string;
  orgId: string;
  factoryId: string;
  workflowId: string | null;
  runId: string | null;
  nodeId: string | null;
  area: string;
  code: string;
  severity: string;
  /** At most 4 KB: `sanitizeDetails` wrote it. */
  detailsJson: string;
  createdAt: string;
}

interface TripwireListQuery {
  /** Events of this workflow, plus the ones that name no workflow at all. */
  workflowId?: string;
  runId?: string;
  codes?: readonly string[];
  /** Inclusive lower bound on `createdAt`, an ISO instant. */
  since: string;
  limit: number;
}

interface TripwireCount {
  area: string;
  code: string;
  count: number;
  lastAt: string;
}

export interface TripwireStore {
  insert(row: TripwireRow): Promise<void>;
  /**
   * Deletes up to a batch of rows past the newest `TRIPWIRE_KEEP_PER_FACTORY`
   * of the factory, and up to a batch past the newest `TRIPWIRE_KEEP_PER_ORG`
   * of its organization; returns how many it deleted.
   */
  prune(scope: TripwireScope): Promise<number>;
  /** Newest first. */
  list(scope: TripwireScope, query: TripwireListQuery): Promise<TripwireRow[]>;
  countsByCode(
    scope: TripwireScope,
    query: { workflowId?: string; since: string },
  ): Promise<TripwireCount[]>;
}

const table = factoryTripwires;

function scopeOf(scope: TripwireScope): SQL {
  if (!scope.orgId || !scope.factoryId) {
    throw new Error("A tripwire read or write needs an org and a factory.");
  }
  return and(
    eq(table.orgId, scope.orgId),
    eq(table.factoryId, scope.factoryId),
  ) as SQL;
}

function workflowFilter(workflowId: string | undefined): SQL | undefined {
  return workflowId === undefined
    ? undefined
    : or(eq(table.workflowId, workflowId), isNull(table.workflowId));
}

export function createDrizzleTripwireStore(options: {
  /** Called on every operation, so a reset connection is never held. */
  getDatabase: () => TripwireDatabase;
}): TripwireStore {
  const { getDatabase } = options;
  return {
    async insert(row) {
      await getDatabase().insert(table).values(row);
    },

    async prune(scope) {
      const db = getDatabase();
      // Each cap is checked on its own: a factory far under its cap can still
      // sit in an organization over its own.
      const deleteBeyond = async (where: SQL, keep: number) => {
        const beyondKeep = db
          .select({ id: table.id })
          .from(table)
          .where(where)
          .orderBy(desc(table.createdAt), desc(table.id))
          .limit(TRIPWIRE_PRUNE_BATCH)
          .offset(keep);
        const deleted = await db
          .delete(table)
          .where(and(where, inArray(table.id, beyondKeep)))
          .returning({ id: table.id });
        return deleted.length;
      };
      return (
        (await deleteBeyond(scopeOf(scope), TRIPWIRE_KEEP_PER_FACTORY)) +
        (await deleteBeyond(
          eq(table.orgId, scope.orgId),
          TRIPWIRE_KEEP_PER_ORG,
        ))
      );
    },

    async list(scope, query) {
      const limit = Math.min(Math.max(1, query.limit), TRIPWIRE_LIST_MAX);
      return getDatabase()
        .select()
        .from(table)
        .where(
          and(
            scopeOf(scope),
            gte(table.createdAt, query.since),
            workflowFilter(query.workflowId),
            query.runId === undefined
              ? undefined
              : eq(table.runId, query.runId),
            query.codes === undefined || query.codes.length === 0
              ? undefined
              : inArray(table.code, [...query.codes]),
          ),
        )
        .orderBy(desc(table.createdAt), desc(table.id))
        .limit(limit);
    },

    async countsByCode(scope, query) {
      const rows = await getDatabase()
        .select({
          area: table.area,
          code: table.code,
          count: sql<number>`count(*)`.mapWith(Number),
          lastAt: sql<string>`max(${table.createdAt})`,
        })
        .from(table)
        .where(
          and(
            scopeOf(scope),
            gte(table.createdAt, query.since),
            workflowFilter(query.workflowId),
          ),
        )
        .groupBy(table.area, table.code)
        .orderBy(sql`count(*) desc`, table.code)
        .limit(TRIPWIRE_COUNT_GROUPS_MAX);
      return rows;
    },
  };
}
