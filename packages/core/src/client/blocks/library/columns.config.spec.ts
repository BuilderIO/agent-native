import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  columnsMdx,
  columnsSchema,
  type ColumnsData,
} from "./columns.config.js";

/**
 * Minimal `BlockAttrReader` over a plain attribute bag, mirroring the runtime
 * `createAttrReader` value-domain narrowing (string-vs-number-vs-object). Lets
 * the test assert the `toAttrs` → `fromAttrs` round-trip without spinning up the
 * full MDX serialize/parse pipeline.
 */
function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) =>
      typeof read(name) === "string" ? (read(name) as string) : undefined,
    number: (name) =>
      typeof read(name) === "number" ? (read(name) as number) : undefined,
    bool: (name) =>
      typeof read(name) === "boolean" ? (read(name) as boolean) : undefined,
    array: <T = unknown>(name: string) =>
      Array.isArray(read(name)) ? (read(name) as T[]) : undefined,
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

/** Re-decode data from the attribute bag `toAttrs` produced. */
function roundTrip(data: ColumnsData): ColumnsData {
  const attrs = columnsMdx.toAttrs(data) as Record<string, unknown>;
  return columnsMdx.fromAttrs(reader(attrs), "");
}

describe("columns block config", () => {
  it("parses a valid two-column layout with labels", () => {
    const data = {
      columns: [
        { id: "col-before", label: "Before", blocks: [] },
        { id: "col-after", label: "After", blocks: [] },
      ],
    };
    expect(columnsSchema.parse(data)).toEqual(data);
  });

  it("parses columns without labels (label is optional)", () => {
    const data = {
      columns: [
        { id: "col-1", blocks: [] },
        { id: "col-2", blocks: [] },
      ],
    };
    expect(columnsSchema.parse(data)).toEqual(data);
  });

  it("accepts the maximum of four columns", () => {
    const data = {
      columns: [
        { id: "col-1", blocks: [] },
        { id: "col-2", blocks: [] },
        { id: "col-3", blocks: [] },
        { id: "col-4", blocks: [] },
      ],
    };
    expect(columnsSchema.parse(data).columns).toHaveLength(4);
  });

  it("accepts one remaining column after another column is removed", () => {
    expect(
      columnsSchema.parse({ columns: [{ id: "col-1", blocks: [] }] }).columns,
    ).toHaveLength(1);
  });

  it("rejects five columns (max 4)", () => {
    expect(() =>
      columnsSchema.parse({
        columns: [
          { id: "col-1", blocks: [] },
          { id: "col-2", blocks: [] },
          { id: "col-3", blocks: [] },
          { id: "col-4", blocks: [] },
          { id: "col-5", blocks: [] },
        ],
      }),
    ).toThrow();
  });

  it("rejects a non-array columns field", () => {
    expect(() => columnsSchema.parse({ columns: "before,after" })).toThrow();
  });

  it("uses the stable Columns MDX tag", () => {
    expect(columnsMdx.tag).toBe("Columns");
  });

  it("round-trips columns (incl. nested child blocks) through toAttrs/fromAttrs", () => {
    const data: ColumnsData = {
      columns: [
        {
          id: "col-before",
          label: "Before",
          blocks: [
            {
              id: "blk-old",
              type: "rich-text",
              data: { markdown: "The old flow." },
            },
          ],
        },
        {
          id: "col-after",
          label: "After",
          blocks: [
            {
              id: "blk-new",
              type: "rich-text",
              data: { markdown: "The new flow." },
            },
            {
              id: "blk-note",
              type: "callout",
              data: { tone: "success", body: "Faster." },
            },
          ],
        },
      ],
    };
    expect(roundTrip(data)).toEqual(data);
  });

  it("decodes a missing columns attribute to an empty array", () => {
    expect(columnsMdx.fromAttrs(reader({}), "")).toEqual({ columns: [] });
  });
});
