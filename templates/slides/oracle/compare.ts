import { findOracleRow, OracleRowNotFoundError } from "./load";
import {
  ORACLE_EXPECT_KEYS,
  type OracleExpectKey,
  type OracleRow,
} from "./schema";

// There is no "unknown" verdict: a key the probe did not report throws, so a
// truncated run can never read as a pass or as an ordinary result.
export type OracleVerdict = "match" | "mismatch";

export interface OracleComparison {
  verdict: OracleVerdict;
  keys: Partial<Record<OracleExpectKey, OracleVerdict>>;
}

// Untyped on purpose: a probe can report null, a boolean or a stray key, and
// the comparator has to judge those rather than rely on the compiler.
export type ObservedOutcome = Record<string, unknown>;

export class OracleRowWithoutExpectError extends Error {
  readonly rowId: string;

  constructor(rowId: string) {
    super(`Interaction oracle row "${rowId}" has no expect to compare against`);
    this.name = "OracleRowWithoutExpectError";
    this.rowId = rowId;
  }
}

export class OracleUnknownKeyError extends Error {
  readonly rowId: string;
  readonly key: string;

  constructor(rowId: string, key: string) {
    super(
      `Observed key "${key}" is not defined by interaction oracle row "${rowId}"`,
    );
    this.name = "OracleUnknownKeyError";
    this.rowId = rowId;
    this.key = key;
  }
}

export class OracleObservationError extends Error {
  readonly rowId: string;

  constructor(rowId: string, reason: string) {
    super(
      `Observation for interaction oracle row "${rowId}" is invalid: ${reason}`,
    );
    this.name = "OracleObservationError";
    this.rowId = rowId;
  }
}

export function compareToOracle(
  rowId: string,
  observed: ObservedOutcome,
): OracleComparison {
  return compareOracleRow(rowId, findOracleRow(rowId), observed);
}

export function compareOracleRow(
  rowId: string,
  row: OracleRow | undefined,
  observed: ObservedOutcome,
): OracleComparison {
  if (row === undefined) {
    throw new OracleRowNotFoundError(rowId);
  }
  const expect = row.expect;
  if (expect === undefined) {
    throw new OracleRowWithoutExpectError(rowId);
  }
  const expectedKeys = ORACLE_EXPECT_KEYS.filter(
    (key) => expect[key] !== undefined,
  );
  if (expectedKeys.length === 0) {
    throw new OracleRowWithoutExpectError(rowId);
  }
  if (
    typeof observed !== "object" ||
    observed === null ||
    Array.isArray(observed)
  ) {
    throw new OracleObservationError(
      rowId,
      "expected an object keyed by probe output",
    );
  }

  // Object.keys includes keys whose value is undefined, so a misspelled key is
  // rejected even when the probe left its value empty. Do not filter those out.
  const defined = new Set<string>(expectedKeys);
  for (const key of Object.keys(observed)) {
    if (!defined.has(key)) {
      throw new OracleUnknownKeyError(rowId, key);
    }
  }

  const keys: Partial<Record<OracleExpectKey, OracleVerdict>> = {};
  const verdicts = expectedKeys.map((key) => {
    const verdict = verdictFor(rowId, key, observed[key], expect[key]);
    keys[key] = verdict;
    return verdict;
  });
  return {
    verdict: verdicts.includes("mismatch") ? "mismatch" : "match",
    keys,
  };
}

function verdictFor(
  rowId: string,
  key: string,
  observed: unknown,
  expected: unknown,
): OracleVerdict {
  if (observed === undefined) {
    throw new OracleObservationError(
      rowId,
      `the probe did not report "${key}"`,
    );
  }
  return observed === expected ? "match" : "mismatch";
}
