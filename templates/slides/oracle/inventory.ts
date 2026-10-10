import type { OracleRow } from "./schema";

export type MeasuredInventory = {
  // Every row id in the measured file, whatever its status.
  measuredIds: string[];
  // The ids the measured file marks as not measured. Relabeling a measured row
  // gap changes this list, so it cannot leave the ratchet without a diff.
  unmeasuredIds: string[];
};

/**
 * The measured file's inventory: each row id, and which of them are unmeasured.
 * A duplicate id throws, so a copy cannot hide the removal of another row.
 */
export function measuredInventory(rows: OracleRow[]): MeasuredInventory {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(
        `Duplicate oracle row id "${row.id}" in the measured file`,
      );
    }
    seen.add(row.id);
  }
  return {
    measuredIds: rows.map((row) => row.id).sort(),
    unmeasuredIds: rows
      .filter((row) => row.status === "gap")
      .map((row) => row.id)
      .sort(),
  };
}
