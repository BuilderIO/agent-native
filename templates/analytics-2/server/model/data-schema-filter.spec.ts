import { describe, expect, it } from "vitest";

import {
  parseSchemaFilterConfig,
  schemaFilterForSubmit,
  validateSchemaFilter,
  validateSchemaFilterConfig,
  validateStringOrRegexFilter,
  type SchemaFilter,
} from "./data-schema-filter.js";

const filter = (
  match: "EXACT" | "PREFIX" | "SUFFIX" | "REGEX",
  mode: "INCLUDE" | "EXCLUDE",
  options: readonly string[],
) => ({ match, mode, options });

describe("canonical schema filter validator", () => {
  it("keeps the validation order and messages", () => {
    expect(validateStringOrRegexFilter(filter("REGEX", "EXCLUDE", []))).toBe(
      "Filter options must be provided",
    );
    expect(
      validateStringOrRegexFilter(filter("REGEX", "EXCLUDE", ["a", "b"])),
    ).toBe("Regex matching is only supported for include-mode filters");
    expect(
      validateStringOrRegexFilter(filter("REGEX", "INCLUDE", ["a", "b"])),
    ).toBe("Regex matching only supports one regex");
    expect(validateStringOrRegexFilter(filter("REGEX", "INCLUDE", [""]))).toBe(
      "RegEx cannot be empty",
    );
    expect(
      validateStringOrRegexFilter(filter("REGEX", "INCLUDE", ["  /x"])),
    ).toBe("RegEx cannot start with '/'");
    expect(
      validateStringOrRegexFilter(filter("PREFIX", "INCLUDE", ["/x"])),
    ).toBeUndefined();
    expect(
      validateStringOrRegexFilter(filter("EXACT", "INCLUDE", [""])),
    ).toBeUndefined();
  });

  it("keeps database/schema/table precedence and prefixed messages", () => {
    expect(
      validateSchemaFilter({
        schemaFilter: {
          databaseFilter: filter("EXACT", "INCLUDE", []),
          schemaFilter: filter("REGEX", "INCLUDE", ["/s"]),
        },
      }),
    ).toEqual({
      schemaFilter: { message: "database: Filter options must be provided" },
    });
    expect(
      validateSchemaFilterConfig({
        schemaFilter: filter("REGEX", "INCLUDE", ["/s"]),
        tableFilter: filter("REGEX", "INCLUDE", []),
      }),
    ).toEqual({
      schemaFilter: { message: "schema: RegEx cannot start with '/'" },
    });
    expect(validateSchemaFilterConfig({})).toBeUndefined();
    expect(validateSchemaFilterConfig(undefined)).toBeUndefined();
  });

  it("accepts untrusted regex-looking text without executing it", () => {
    const pathological = filter("REGEX", "INCLUDE", ["(a+)+$"]);
    expect(validateStringOrRegexFilter(pathological)).toBeUndefined();
    expect(
      validateSchemaFilterConfig({ schemaFilter: pathological }),
    ).toBeUndefined();
  });
});

describe("schema filter read result", () => {
  it("distinguishes malformed values from absent and preserves the clear state", () => {
    expect(parseSchemaFilterConfig(undefined)).toEqual({ status: "absent" });
    expect(parseSchemaFilterConfig(null)).toEqual({
      status: "cleared",
      value: null,
    });
    expect(parseSchemaFilterConfig("schemaFilter")).toEqual({
      status: "malformed",
      reason: "not_an_object",
    });
    expect(parseSchemaFilterConfig([])).toEqual({
      status: "malformed",
      reason: "not_an_object",
    });
    expect(parseSchemaFilterConfig({ unexpected: true })).toEqual({
      status: "malformed",
      reason: "unknown_key",
    });
    expect(
      parseSchemaFilterConfig({
        schemaFilter: { match: "EXACT", mode: "INCLUDE" },
      }),
    ).toEqual({ status: "malformed", reason: "invalid_filter" });
    expect(parseSchemaFilterConfig({ schemaFilters: [1] })).toEqual({
      status: "malformed",
      reason: "invalid_legacy_filter",
    });
  });

  it("returns valid values without coercion", () => {
    const valid: SchemaFilter = {
      databaseFilter: filter("EXACT", "INCLUDE", ["db"]),
      schemaFilter: filter("PREFIX", "EXCLUDE", ["tmp"]),
      tableFilter: filter("REGEX", "INCLUDE", ["^analytics"]),
      schemaFilters: ["legacy"],
    };
    expect(parseSchemaFilterConfig(valid)).toEqual({
      status: "valid",
      value: valid,
    });
    expect(parseSchemaFilterConfig({})).toEqual({
      status: "valid",
      value: {},
    });
  });

  it("submits exactly the stored object and keeps the clear state", () => {
    const valid: SchemaFilter = {
      tableFilter: filter("SUFFIX", "INCLUDE", ["_raw"]),
    };
    expect(schemaFilterForSubmit(valid)).toBe(valid);
    expect(schemaFilterForSubmit({})).toEqual({});
    expect(schemaFilterForSubmit(null)).toBeNull();
    expect(schemaFilterForSubmit(undefined)).toBeNull();
  });
});
