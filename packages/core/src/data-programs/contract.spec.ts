import { describe, expect, it } from "vitest";

import {
  DATA_PROGRAM_SENTINEL,
  buildDataProgramPrelude,
  inferDataProgramSchema,
  parseDataProgramResult,
} from "./contract.js";

const CAPS = { maxRows: 10_000, maxBytes: 4 * 1024 * 1024 };

describe("data-programs/contract", () => {
  describe("buildDataProgramPrelude", () => {
    it("defines a frozen params global from the passed JSON", () => {
      const prelude = buildDataProgramPrelude({ foo: "bar", n: 1 });
      expect(prelude).toContain(
        'const params = Object.freeze({"foo":"bar","n":1});',
      );
    });

    it("defaults to an empty object when params is undefined", () => {
      const prelude = buildDataProgramPrelude(undefined);
      expect(prelude).toContain("const params = Object.freeze({});");
    });

    it("defines an emit() that writes the sentinel line and guards double-calls", () => {
      const prelude = buildDataProgramPrelude({});
      expect(prelude).toContain("function emit(rows, schema)");
      expect(prelude).toContain("__dataProgramEmitted");
      expect(prelude).toContain(JSON.stringify(DATA_PROGRAM_SENTINEL));
    });
  });

  describe("parseDataProgramResult", () => {
    it("extracts rows and schema from a clean emit() line", () => {
      const stdout =
        DATA_PROGRAM_SENTINEL +
        JSON.stringify({
          rows: [{ a: 1, b: "x" }],
          schema: [
            { name: "a", type: "number" },
            { name: "b", type: "string" },
          ],
        });
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.rows).toEqual([{ a: 1, b: "x" }]);
      expect(result.result.schema).toEqual([
        { name: "a", type: "number" },
        { name: "b", type: "string" },
      ]);
      expect(result.result.truncated).toBe(false);
    });

    it("ignores console.log debug noise before and after the sentinel line", () => {
      const stdout = [
        "starting up...",
        "fetched 3 pages",
        DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ x: 1 }] }),
        "done",
      ].join("\n");
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.rows).toEqual([{ x: 1 }]);
    });

    it("uses the LAST sentinel line when multiple are present", () => {
      const stdout = [
        DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ x: 1 }] }),
        "some debug output that happens to echo the sentinel text: " +
          DATA_PROGRAM_SENTINEL +
          "not-json",
        DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ x: 2 }] }),
      ].join("\n");
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.rows).toEqual([{ x: 2 }]);
    });

    it("infers schema from the first 50 rows when schema is omitted", () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: i,
        name: `row-${i}`,
        active: i % 2 === 0,
        meta: { nested: true },
      }));
      const stdout = DATA_PROGRAM_SENTINEL + JSON.stringify({ rows });
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const byName = Object.fromEntries(
        result.result.schema.map((c) => [c.name, c.type]),
      );
      expect(byName.id).toBe("number");
      expect(byName.name).toBe("string");
      expect(byName.active).toBe("boolean");
      expect(byName.meta).toBe("json");
    });

    it("returns emit_missing when there is no sentinel line", () => {
      const result = parseDataProgramResult(
        "just some console.log output",
        CAPS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("emit_missing");
    });

    it("returns emit_shape_invalid for malformed JSON after the sentinel", () => {
      const result = parseDataProgramResult(
        DATA_PROGRAM_SENTINEL + "{not valid json",
        CAPS,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("emit_shape_invalid");
    });

    it("returns emit_shape_invalid when rows is not an array", () => {
      const stdout = DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: "nope" });
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("emit_shape_invalid");
    });

    it("returns emit_shape_invalid when a row is not a plain object", () => {
      const stdout =
        DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [1, 2, 3] });
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("emit_shape_invalid");
    });

    it("returns emit_shape_invalid when schema entries are malformed", () => {
      const stdout =
        DATA_PROGRAM_SENTINEL +
        JSON.stringify({ rows: [{ a: 1 }], schema: [{ name: "a" }] });
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("emit_shape_invalid");
    });

    it("truncates rows exceeding maxRows and reports truncated: true", () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ i }));
      const stdout = DATA_PROGRAM_SENTINEL + JSON.stringify({ rows });
      const result = parseDataProgramResult(stdout, {
        maxRows: 5,
        maxBytes: 1_000_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.rows).toHaveLength(5);
      expect(result.result.truncated).toBe(true);
    });

    it("truncates rows exceeding the byte cap and reports truncated: true", () => {
      const bigString = "x".repeat(1000);
      const rows = Array.from({ length: 10 }, (_, i) => ({ i, bigString }));
      const stdout = DATA_PROGRAM_SENTINEL + JSON.stringify({ rows });
      // Cap small enough that only a few rows fit.
      const result = parseDataProgramResult(stdout, {
        maxRows: 10_000,
        maxBytes: 3_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.rows.length).toBeLessThan(10);
      expect(result.result.truncated).toBe(true);
    });

    it("returns result_too_large when a single row alone exceeds the byte cap", () => {
      const bigString = "x".repeat(10_000);
      const stdout =
        DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [{ bigString }] });
      const result = parseDataProgramResult(stdout, {
        maxRows: 10_000,
        maxBytes: 100,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("result_too_large");
    });

    it("handles an empty rows array without truncation", () => {
      const stdout = DATA_PROGRAM_SENTINEL + JSON.stringify({ rows: [] });
      const result = parseDataProgramResult(stdout, CAPS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.result.rows).toEqual([]);
      expect(result.result.truncated).toBe(false);
    });
  });

  describe("inferDataProgramSchema", () => {
    it("marks a column json when sampled rows disagree on primitive type", () => {
      const schema = inferDataProgramSchema([{ v: 1 }, { v: "two" }]);
      expect(schema).toEqual([{ name: "v", type: "json" }]);
    });

    it("only surveys the first sampleSize rows", () => {
      const rows = [
        ...Array.from({ length: 5 }, () => ({ v: 1 })),
        { v: "should not be surveyed" },
      ];
      const schema = inferDataProgramSchema(rows, 5);
      expect(schema).toEqual([{ name: "v", type: "number" }]);
    });
  });
});
