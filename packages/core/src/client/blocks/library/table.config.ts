import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export interface TableData {
  columns: string[];
  rows: string[][];
  density?: TableDensity;
}

export const TABLE_DENSITIES = ["compact", "normal", "relaxed"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

export const tableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  density: z.enum(TABLE_DENSITIES).optional(),
}) as unknown as z.ZodType<TableData>;

export const tableMdx: BlockMdxConfig<TableData> = {
  tag: "Table",
  toAttrs: (data) => ({
    columns: data.columns,
    rows: data.rows,
    density:
      data.density && data.density !== "normal" ? data.density : undefined,
  }),
  fromAttrs: (attrs) => ({
    columns: attrs.array<string>("columns") ?? [],
    rows: attrs.array<string[]>("rows") ?? [],
    density: parseDensity(attrs.string("density")),
  }),
};

function parseDensity(value: string | undefined): TableDensity | undefined {
  return value && TABLE_DENSITIES.includes(value as TableDensity)
    ? (value as TableDensity)
    : undefined;
}
