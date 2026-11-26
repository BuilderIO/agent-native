import type { RowSnapshot } from "./dom.js";

export type RowField = Exclude<keyof RowSnapshot, "id">;

export type RowDifference =
  | { rowId: string; field: "missing"; target: RowSnapshot }
  | { rowId: string; field: "extra"; ours: RowSnapshot }
  | {
      rowId: string;
      field: RowField;
      ours: RowSnapshot[RowField];
      target: RowSnapshot[RowField];
    };

/**
 * A difference a part set makes on purpose. `rowId` "*" accepts it on every
 * row. A reason is required: an unexplained exception is how the two sets
 * drift apart without anyone deciding they should.
 */
export interface AcceptedRowDifference {
  rowId: string;
  field: RowField | "missing" | "extra";
  reason: string;
}

export interface EquivalenceReport {
  compared: number;
  differences: RowDifference[];
  accepted: Array<RowDifference & { reason: string }>;
}

const FIELDS: readonly RowField[] = [
  "part",
  "parentId",
  "position",
  "kind",
  "name",
  "selected",
  "checked",
  "expanded",
  "disabled",
  "pending",
  "value",
  "effect",
  "badge",
  "slot",
  "regions",
  "hosts",
  "complete",
];

function indexById(rows: readonly RowSnapshot[], side: string) {
  const byId = new Map<string, RowSnapshot>();
  for (const row of rows) {
    if (!row.id) throw new Error(`A ${side} row has no data-rid value`);
    if (byId.has(row.id)) {
      throw new Error(
        `Row ${row.id} is rendered twice by the ${side} part set`,
      );
    }
    byId.set(row.id, row);
  }
  return byId;
}

/**
 * Structural equivalence of two renders of the same model: the same rows, in
 * the same tree and order, with the same names, kinds, states, effects,
 * badges, slots and regions. Never visual: the part sets are meant to look different.
 */
export function compareRowSnapshots(
  ours: readonly RowSnapshot[],
  target: readonly RowSnapshot[],
  accepted: readonly AcceptedRowDifference[] = [],
): EquivalenceReport {
  for (const entry of accepted) {
    if (entry.reason.trim().length < 10) {
      throw new Error(
        `Accepted difference ${entry.rowId} ${entry.field} needs a reason of 10+ characters`,
      );
    }
  }
  const oursById = indexById(ours, "our");
  const targetById = indexById(target, "target");
  const all: RowDifference[] = [];

  for (const [rowId, targetRow] of targetById) {
    const ourRow = oursById.get(rowId);
    if (!ourRow) {
      all.push({ rowId, field: "missing", target: targetRow });
      continue;
    }
    for (const field of FIELDS) {
      if (ourRow[field] !== targetRow[field]) {
        all.push({
          rowId,
          field,
          ours: ourRow[field],
          target: targetRow[field],
        });
      }
    }
  }
  for (const [rowId, ourRow] of oursById) {
    if (!targetById.has(rowId))
      all.push({ rowId, field: "extra", ours: ourRow });
  }

  const reasonFor = (difference: RowDifference) =>
    accepted.find(
      (entry) =>
        (entry.rowId === "*" || entry.rowId === difference.rowId) &&
        entry.field === difference.field,
    )?.reason;

  const report: EquivalenceReport = {
    compared: targetById.size,
    differences: [],
    accepted: [],
  };
  for (const difference of all) {
    const reason = reasonFor(difference);
    if (reason === undefined) report.differences.push(difference);
    else report.accepted.push({ ...difference, reason });
  }
  return report;
}
