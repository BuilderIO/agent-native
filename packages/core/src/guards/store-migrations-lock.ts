/**
 * A checked-in record of every store's migrations, in order, with a checksum
 * for each `sql` migration. A database records a migration by name once and
 * never runs it again, so editing, renaming, reordering or deleting one never
 * reaches databases that already applied it. Comparing this file against the
 * base branch makes that a CI failure instead of silent drift.
 */

import type { Store } from "../db/store-registry.js";
import { migrationChecksum } from "../db/store-registry.js";
import type { GuardFinding } from "./types.js";

export const STORE_MIGRATIONS_LOCK_FILE = "src/db/store-migrations.lock.json";

export type StoreMigrationsLock = Record<
  string,
  Array<{ name: string; checksum: string | null }>
>;

export function buildStoreMigrationsLock(
  stores: readonly Store[],
): StoreMigrationsLock {
  const lock: StoreMigrationsLock = {};
  for (const store of [...stores].sort((a, b) => a.id.localeCompare(b.id))) {
    lock[store.id] = store.migrations.map((migration) => ({
      name: migration.name,
      checksum: migrationChecksum(migration),
    }));
  }
  return lock;
}

export function renderStoreMigrationsLock(lock: StoreMigrationsLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** Findings for every way `head` stops being an append-only extension of `base`. */
export function compareStoreMigrationsLocks(
  base: StoreMigrationsLock,
  head: StoreMigrationsLock,
): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const at = (message: string): GuardFinding => ({
    file: STORE_MIGRATIONS_LOCK_FILE,
    line: 1,
    message,
  });
  for (const [storeId, baseMigrations] of Object.entries(base)) {
    const headMigrations = head[storeId];
    if (!headMigrations) {
      findings.push(
        at(
          `store "${storeId}" was removed or renamed. Its ledger rows stay in every database; keep the store and retire it instead.`,
        ),
      );
      continue;
    }
    baseMigrations.forEach((migration, index) => {
      const current = headMigrations[index];
      if (!current || current.name !== migration.name) {
        findings.push(
          at(
            `store "${storeId}" migration "${migration.name}" was removed, renamed or reordered (position ${index + 1} is now "${current?.name ?? "missing"}"). Migrations are append-only: add a new one instead.`,
          ),
        );
      } else if (
        migration.checksum !== null &&
        current.checksum !== migration.checksum
      ) {
        findings.push(
          at(
            `store "${storeId}" migration "${migration.name}" changed its SQL. Databases that applied it never see the edit: append a new migration instead.`,
          ),
        );
      }
    });
  }
  return findings;
}
