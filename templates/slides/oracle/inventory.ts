import type { OracleRow } from "./schema";

export type MeasuredInventory = {
  // Every row id in the measured file, whatever its status.
  measuredIds: string[];
  // The ids the measured file marks as not measured. Relabeling a measured row
  // gap changes this list, so it cannot leave the ratchet without a diff.
  unmeasuredIds: string[];
};

/**
 * The sorted ids of one oracle file's rows. A duplicate id throws, so a copy
 * cannot hide the removal of another row.
 */
export function sortedRowIds(rows: OracleRow[], fileName: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`Duplicate oracle row id "${row.id}" in ${fileName}`);
    }
    seen.add(row.id);
  }
  return rows.map((row) => row.id).sort();
}

/**
 * The measured file's inventory: each row id, and which of them are unmeasured.
 * A duplicate id throws, so a copy cannot hide the removal of another row.
 */
export function measuredInventory(rows: OracleRow[]): MeasuredInventory {
  return {
    measuredIds: sortedRowIds(rows, "the measured file"),
    unmeasuredIds: rows
      .filter((row) => row.status === "gap")
      .map((row) => row.id)
      .sort(),
  };
}
