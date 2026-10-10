import { describe, expect, it } from "vitest";

import {
  compareOracleRow,
  OracleObservationError,
  OracleRowWithoutExpectError,
  OracleUnknownKeyError,
  type ObservedOutcome,
  type OracleComparison,
} from "./compare";
import { OracleRowNotFoundError } from "./load";
import type { OracleExpect, OracleRow } from "./schema";

// Inline rows only: this file must not read the oracle JSON.
const FIXTURE_ID = "fixture.1";

function fixtureRow(expect?: OracleExpect): OracleRow {
  return {
    id: FIXTURE_ID,
    family: "1",
    familyName: "Fixture",
    probe: "fixture probe",
    result: "fixture result",
    notes: "",
    confidence: "high",
    status: "measured",
    claim: "positive",
    inputPath: "unknown",
    ...(expect === undefined ? {} : { expect }),
  };
}

const FULL_EXPECT: OracleExpect = {
  hit: "object",
  cursor: "move",
  outlineVisible: true,
};

type PlantedCase = {
  name: string;
  rowExpect: OracleExpect;
  observed: ObservedOutcome;
} & OracleComparison;

const PLANTED_CASES: PlantedCase[] = [
  {
    name: "all keys match",
    rowExpect: FULL_EXPECT,
    observed: { hit: "object", cursor: "move", outlineVisible: true },
    verdict: "match",
    keys: { hit: "match", cursor: "match", outlineVisible: "match" },
  },
  {
    name: "hit mismatch alone",
    rowExpect: FULL_EXPECT,
    observed: { hit: "group", cursor: "move", outlineVisible: true },
    verdict: "mismatch",
    keys: { hit: "mismatch", cursor: "match", outlineVisible: "match" },
  },
  {
    name: "cursor mismatch alone",
    rowExpect: FULL_EXPECT,
    observed: { hit: "object", cursor: "text", outlineVisible: true },
    verdict: "mismatch",
    keys: { hit: "match", cursor: "mismatch", outlineVisible: "match" },
  },
  {
    name: "outlineVisible mismatch alone",
    rowExpect: FULL_EXPECT,
    observed: { hit: "object", cursor: "move", outlineVisible: false },
    verdict: "mismatch",
    keys: { hit: "match", cursor: "match", outlineVisible: "mismatch" },
  },
  {
    name: "null for a string key is a mismatch",
    rowExpect: FULL_EXPECT,
    observed: { hit: null, cursor: "move", outlineVisible: true },
    verdict: "mismatch",
    keys: { hit: "mismatch", cursor: "match", outlineVisible: "match" },
  },
  {
    name: "null for a boolean key is a mismatch",
    rowExpect: FULL_EXPECT,
    observed: { hit: "object", cursor: "move", outlineVisible: null },
    verdict: "mismatch",
    keys: { hit: "match", cursor: "match", outlineVisible: "mismatch" },
  },
  {
    name: "null for a false-expected key is a mismatch",
    rowExpect: { outlineVisible: false },
    observed: { outlineVisible: null },
    verdict: "mismatch",
    keys: { outlineVisible: "mismatch" },
  },
  {
    name: "true observed against false expected is a mismatch",
    rowExpect: { outlineVisible: false },
    observed: { outlineVisible: true },
    verdict: "mismatch",
    keys: { outlineVisible: "mismatch" },
  },
  {
    name: "false matches false (false is not treated as absent)",
    rowExpect: { outlineVisible: false },
    observed: { outlineVisible: false },
    verdict: "match",
    keys: { outlineVisible: "match" },
  },
  {
    name: "string 'true' does not equal boolean true",
    rowExpect: { outlineVisible: true },
    observed: { outlineVisible: "true" },
    verdict: "mismatch",
    keys: { outlineVisible: "mismatch" },
  },
  {
    name: "empty string does not equal a real value",
    rowExpect: { hit: "nothing" },
    observed: { hit: "" },
    verdict: "mismatch",
    keys: { hit: "mismatch" },
  },
  {
    name: "single-key row matches",
    rowExpect: { cursor: "nw-resize" },
    observed: { cursor: "nw-resize" },
    verdict: "match",
    keys: { cursor: "match" },
  },
];

// Each of these omits or blanks a key the row expects. None may compare as a
// match or a mismatch, because the probe did not measure that key.
const INCOMPLETE_CASES: Array<{
  name: string;
  rowExpect: OracleExpect;
  observed: ObservedOutcome;
}> = [
  {
    name: "empty observation",
    rowExpect: FULL_EXPECT,
    observed: {},
  },
  {
    name: "one omitted key",
    rowExpect: FULL_EXPECT,
    observed: { hit: "object", outlineVisible: true },
  },
  {
    name: "explicit undefined value",
    rowExpect: FULL_EXPECT,
    observed: { hit: undefined, cursor: "move", outlineVisible: true },
  },
  {
    name: "undefined against false expected",
    rowExpect: { outlineVisible: false },
    observed: { outlineVisible: undefined },
  },
  {
    name: "a reported mismatch does not hide a missing key",
    rowExpect: FULL_EXPECT,
    observed: { hit: "group" },
  },
];

const MALFORMED_OBSERVATIONS: Array<[string, unknown]> = [
  ["null", null],
  ["a string", "resize"],
  ["an array", ["move"]],
];

describe("compareOracleRow planted faults", () => {
  it.each(PLANTED_CASES)("$name", ({ rowExpect, observed, verdict, keys }) => {
    expect(
      compareOracleRow(FIXTURE_ID, fixtureRow(rowExpect), observed),
    ).toEqual({ verdict, keys });
  });
});

describe("compareOracleRow refuses incomplete or malformed observations", () => {
  it.each(INCOMPLETE_CASES)("$name", ({ rowExpect, observed }) => {
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow(rowExpect), observed),
    ).toThrow(OracleObservationError);
  });

  it("names the key the probe did not report", () => {
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow(FULL_EXPECT), {
        hit: "object",
        outlineVisible: true,
      }),
    ).toThrow('the probe did not report "cursor"');
  });

  it.each(MALFORMED_OBSERVATIONS)("throws for %s", (_name, observed) => {
    expect(() =>
      compareOracleRow(
        FIXTURE_ID,
        fixtureRow(FULL_EXPECT),
        observed as ObservedOutcome,
      ),
    ).toThrow(OracleObservationError);
  });
});

describe("compareOracleRow errors", () => {
  it("throws OracleRowNotFoundError for a missing row", () => {
    expect(() => compareOracleRow("no.such.row", undefined, {})).toThrow(
      OracleRowNotFoundError,
    );
    expect(() => compareOracleRow("no.such.row", undefined, {})).toThrow(
      'No interaction oracle row with id "no.such.row"',
    );
  });

  it("throws OracleRowWithoutExpectError for a row without expect, even with an observation", () => {
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow(), { hit: "object" }),
    ).toThrow(OracleRowWithoutExpectError);
  });

  it("throws OracleRowWithoutExpectError for an expect with no keys", () => {
    expect(() => compareOracleRow(FIXTURE_ID, fixtureRow({}), {})).toThrow(
      OracleRowWithoutExpectError,
    );
  });

  it("throws OracleUnknownKeyError for an observed key the row does not define", () => {
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow({ hit: "object" }), {
        hit: "object",
        cursor: "move",
      }),
    ).toThrow(OracleUnknownKeyError);
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow({ hit: "object" }), {
        hit: "object",
        cursor: "move",
      }),
    ).toThrow('Observed key "cursor"');
  });

  it("throws OracleUnknownKeyError when the undefined-valued key is not in expect", () => {
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow({ hit: "object" }), {
        hit: "object",
        cursor: undefined,
      }),
    ).toThrow('Observed key "cursor"');
  });

  it("throws OracleUnknownKeyError for a misspelled key with no matching value", () => {
    expect(() =>
      compareOracleRow(FIXTURE_ID, fixtureRow({ hit: "object" }), {
        hitt: "object",
      }),
    ).toThrow('Observed key "hitt"');
  });
});
