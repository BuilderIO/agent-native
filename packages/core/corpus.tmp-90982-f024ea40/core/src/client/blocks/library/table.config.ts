import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the standard `table` block: its data schema and MDX
 * round-trip config. Shared by the server MDX adapter (the plan
 * `plan-block-registry.ts` → `plan-mdx.ts`) and the client spec
 * (`table.tsx`). Keeping it React-free means a server module that imports it
 * never pulls React into the Nitro/SSR bundle.
 *
 * The schema MUST stay data-compatible with the legacy `table` branch of the
 * plan `planBlockSchema` (`{ columns: string[]; rows: string[][] }`), and the
 * MDX `tag` + attribute shape MUST match the legacy self-closing
 * `<Table … columns={…} rows={…} />` encoding (`plan-mdx.ts`
 * `serializeBlock`/`parseBlock`) so stored `.mdx` round-trips byte-compatibly.
 */

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

/**
 * MDX config: `columns` and `rows` are JSON attributes (no children) — exactly
 * the legacy self-closing `<Table id title summary editable columns={…} rows={…} />`
 * form. The legacy serializer emits `columns` before `rows`; `toAttrs` returns
 * the keys in that exact insertion order because `serializeSpecBlock` preserves
 * `Object.entries` order. `fromAttrs` mirrors the legacy parser's `?? []`
 * defaults so partial/older nodes stay tolerant.
 */
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
