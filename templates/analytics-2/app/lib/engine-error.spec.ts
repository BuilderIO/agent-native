import { describe, expect, it } from "vitest";

import { classifyEngineError, describeEngineError } from "./engine-error";

describe("classifyEngineError", () => {
  it.each([
    [
      "Schema error: No field named foo. Valid fields are t.a.",
      "columnNotFound",
    ],
    ["Error during planning: table 'x.y.z' not found", "tableNotFound"],
    ['SQL error: ParserError("syntax error at or near FROM")', "syntax"],
    ["Cannot coerce Utf8 to Int64", "typeMismatch"],
    ["Arrow error: Divide by zero error", "divisionByZero"],
    ["Query timed out after 30s", "timeout"],
    ["permission denied for table users", "permissionDenied"],
    ["Resources exhausted: Failed to allocate memory", "outOfMemory"],
  ])("maps %s", (raw, key) => {
    expect(classifyEngineError(raw)).toBe(key);
  });

  it("returns null for unrecognized text", () => {
    expect(classifyEngineError("something odd happened")).toBeNull();
  });
});

describe("describeEngineError", () => {
  const t = (key: string) => `msg:${key}`;
  it("keeps the diagnostic alongside the mapped message", () => {
    expect(describeEngineError("DataFusionError: Divide by zero", t)).toBe(
      "msg:engineErrors.divisionByZero\nDataFusionError: Divide by zero",
    );
  });
  it("preserves the missing relation name", () => {
    expect(
      describeEngineError('relation "unknown_table" does not exist', t),
    ).toBe(
      'msg:engineErrors.tableNotFound\nrelation "unknown_table" does not exist',
    );
  });
  it("does not duplicate an identical summary", () => {
    expect(
      describeEngineError("division by zero", () => "division by zero"),
    ).toBe("division by zero");
  });
  it("falls back to the raw text", () => {
    expect(describeEngineError("weird failure", t)).toBe("weird failure");
  });
});
