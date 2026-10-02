import { getTableName, type AnyColumn, type Table } from "drizzle-orm";

import { deferMigration, type MigrationEntry } from "../db/migrations.js";
import { registerRecurringSweepHandler } from "../jobs/sweep-hooks.js";
import {
  assertResourceKey,
  installResourceChangeCapture,
  registerAfterWriteDrain,
  resourceChangeCaptureFingerprint,
  resourceChangeCaptureInstalled,
  resourceChangeTriggerNames,
  type ResourceChangeSource,
} from "../resource-changes/store.js";
import {
  ensureSearchIndexTables,
  invalidateSearchIndex,
  raiseSearchIndexTarget,
} from "./index-store.js";

/** The change-feed consumer name the search index subscribes as. */
export const SEARCH_CHANGE_CONSUMER = "search";

/** What one resource contributes to the index. */
export interface SearchableResourceDocument {
  id: string;
  title: string;
  /** A short description, ranked between the title and the body. */
  summary?: string | null;
  body?: string | null;
  modifiedAt?: string | Date | null;
}

export interface SearchableResourceRegistration {
  /** The app that owns the table, e.g. "content". */
  app: string;
  /** Matches the shareable resource type, e.g. "document". */
  type: string;
  /** The Drizzle table whose rows are indexed. */
  table: Table;
  /** Its primary key column. */
  idColumn: AnyColumn;
  /**
   * Bump when `load` changes what it returns. A higher version rebuilds the
   * index; searches use the app's fallback until the rebuild completes.
   */
  version: number;
  /**
   * Loads the searchable text for a batch of ids. Omit an id whose row no
   * longer exists and it is removed from the index. Index every row the app
   * might search; access and filters are checked live at query time.
   */
  load(ids: string[]): Promise<SearchableResourceDocument[]>;
}

const registrations = new Map<string, SearchableResourceRegistration>();

function key(app: string, type: string) {
  return `${app}:${type}`;
}

/** Budget for the drain a write schedules in its own request. */
const AFTER_WRITE_DRAIN_MS = 250;
/** Share of the recurring sweep's budget search may use. */
const SWEEP_DRAIN_MS = 20_000;

let hooksRegistered = false;

function registerDrainHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // Both run only where the database is already awake: right after a write,
  // and inside the per-minute sweep that already queries it. Search never
  // polls on its own schedule.
  registerAfterWriteDrain("search-index", async () => {
    const { drainAllSearchIndexes } = await import("./indexer.js");
    await drainAllSearchIndexes(Date.now() + AFTER_WRITE_DRAIN_MS);
  });
  registerRecurringSweepHandler("search-index", async ({ deadlineAt }) => {
    const { drainAllSearchIndexes } = await import("./indexer.js");
    await drainAllSearchIndexes(
      Math.min(deadlineAt - 1_000, Date.now() + SWEEP_DRAIN_MS),
    );
  });
}

/**
 * Makes an app table searchable through the core index. Pair it with
 * `searchIndexMigration()` in the app's `runMigrations` list, which installs
 * the triggers that keep the index fresh.
 */
export function registerSearchableResource(
  registration: SearchableResourceRegistration,
): SearchableResourceRegistration {
  assertResourceKey(registration.app, "Search app");
  assertResourceKey(registration.type, "Search resource type");
  if (!Number.isInteger(registration.version) || registration.version < 1) {
    throw new Error("Search registration version must be a positive integer.");
  }
  const triggers = resourceChangeTriggerNames(
    searchableResourceSource(registration),
  ).function;
  for (const other of registrations.values()) {
    if (key(other.app, other.type) === key(registration.app, registration.type))
      continue;
    if (
      resourceChangeTriggerNames(searchableResourceSource(other)).function ===
      triggers
    ) {
      throw new Error(
        `Search registrations ${other.app}/${other.type} and ${registration.app}/${registration.type} would share change-capture trigger names. Rename one resource type.`,
      );
    }
  }
  registrations.set(key(registration.app, registration.type), registration);
  registerDrainHooks();
  return registration;
}

export function getSearchableResource(
  app: string,
  type: string,
): SearchableResourceRegistration | undefined {
  return registrations.get(key(app, type));
}

export function listSearchableResources(): SearchableResourceRegistration[] {
  return [...registrations.values()];
}

/** Removes a registration. Tests use it to isolate cases. */
export function unregisterSearchableResource(app: string, type: string): void {
  registrations.delete(key(app, type));
}

export function searchableResourceSource(
  registration: SearchableResourceRegistration,
): ResourceChangeSource {
  return {
    app: registration.app,
    resourceType: registration.type,
    table: getTableName(registration.table),
    idColumn: registration.idColumn.name,
  };
}

/**
 * A named migration that creates the search tables, raises the index's
 * target to the registration's version, and installs change capture on the
 * registration's table. Add it to the app's `runMigrations`
 * list with the app's next version number. It's recorded under `name` plus a
 * fingerprint of the capture SQL, so a release that changes that SQL installs
 * it again.
 */
export function searchIndexMigration(
  registration: SearchableResourceRegistration,
  entry: { version: number; name: string },
): MigrationEntry {
  const source = searchableResourceSource(registration);
  return {
    version: entry.version,
    // Under the bare name, a database that recorded an earlier build's
    // capture would never get this one, and search would stay on the
    // fallback for good.
    name: `${entry.name}@${resourceChangeCaptureFingerprint(source)}`,
    sql: {},
    run: async (exec) => {
      await ensureSearchIndexTables(exec);
      // Before capture exists: a build still running a lower version would
      // otherwise see this capture, finish a rebuild at its own version, and
      // answer from rows it didn't write.
      const target = await raiseSearchIndexTarget(exec, registration);
      // A newer build owns the index and its capture, which this build's
      // older SQL would replace.
      if (target > registration.version) return;
      const hadCapture = await resourceChangeCaptureInstalled(exec, source);
      const installed = await installResourceChangeCapture(
        exec,
        source,
        SEARCH_CHANGE_CONSUMER,
      );
      // A busy table: try again at the next migration run, which serverless
      // hosts reach only at their next release, rather than block writes.
      if (!installed) return deferMigration();
      // Writes made while capture was missing were never recorded. A search
      // that saw it missing has already discarded the finished index, but
      // nothing guarantees one ran.
      if (!hadCapture) await invalidateSearchIndex(exec, registration);
    },
  };
}
