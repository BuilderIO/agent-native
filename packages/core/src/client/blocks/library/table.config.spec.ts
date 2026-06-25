import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import { tableMdx, tableSchema, type TableData } from "./table.config.js";

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

function roundTrip(data: TableData): TableData {
  const attrs = tableMdx.toAttrs(data) as Record<string, unknown>;
  return tableMdx.fromAttrs(reader(attrs), "");
}

describe("table block config", () => {
  it("parses supported padding densities", () => {
    expect(
      tableSchema.parse({
        columns: ["Priority"],
        rows: [["1"]],
        density: "compact",
      }),
    ).toMatchObject({ density: "compact" });
  });

  it("round-trips non-default density through MDX attrs", () => {
    const data: TableData = {
      columns: ["Priority", "Candidate"],
      rows: [["1", "Normalize routes"]],
      density: "relaxed",
    };

    expect(roundTrip(data)).toEqual(data);
  });

  it("omits normal density from MDX attrs for source compatibility", () => {
    expect(
      tableMdx.toAttrs({
        columns: ["Priority"],
        rows: [["1"]],
        density: "normal",
      }),
    ).toEqual({
      columns: ["Priority"],
      rows: [["1"]],
      density: undefined,
    });
  });

  it("ignores unknown density attrs", () => {
    expect(
      tableMdx.fromAttrs(
        reader({
          columns: ["Priority"],
          rows: [["1"]],
          density: "giant",
        }),
        "",
      ),
    ).toEqual({
      columns: ["Priority"],
      rows: [["1"]],
      density: undefined,
    });
  });
});
