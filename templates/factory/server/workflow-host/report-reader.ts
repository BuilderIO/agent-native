import { and, inArray } from "drizzle-orm";

import { triageItems } from "../db/schema.js";
import type { ReportReader } from "../lib/builder-task-reports.js";
import { orgFactoryItemFilter } from "../lib/factory-scope.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { RowUnreadable, rowToNormalizedItem } from "./inbox.js";
import type { ItemsDatabase } from "./items.js";

interface ReportReaderOptions {
  scope: WorkflowScope;
  /** Called on every read, so a reset connection is never held. */
  getDatabase: () => ItemsDatabase;
}

/**
 * Reads the reports a Builder task is for from this factory's inbox, as the
 * engine reads them: the same rows, the same item shape. A report that is not
 * there, or whose row cannot be read, fails the read with its id; a task is
 * never described by fewer reports than it was given.
 */
export function createReportReader(options: ReportReaderOptions): ReportReader {
  const { scope, getDatabase } = options;
  return async (ids, signal) => {
    signal.throwIfAborted();
    const rows = await getDatabase()
      .select()
      .from(triageItems)
      .where(
        and(
          orgFactoryItemFilter(scope.orgId, scope.factoryId),
          inArray(triageItems.id, [...ids]),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        code: "item_invalid",
        message: `The report${missing.length === 1 ? "" : "s"} ${missing.map((id) => `"${id}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} not in this factory's inbox, so the task cannot quote ${missing.length === 1 ? "it" : "them"}.`,
        retryable: false,
      };
    }
    try {
      return {
        ok: true,
        reports: [...rows]
          .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
          .map((row) => rowToNormalizedItem(row)),
      };
    } catch (error) {
      if (!(error instanceof RowUnreadable)) throw error;
      return {
        ok: false,
        code: "item_invalid",
        message: `The report "${error.itemId}" cannot be read: ${error.message}`,
        retryable: false,
      };
    }
  };
}
