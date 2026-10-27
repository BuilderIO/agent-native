import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";
import type { NestedBlock } from "../types.js";

export interface ColumnsColumn {
  id: string;
  label?: string;
  blocks: NestedBlock[];
}

export interface ColumnsData {
  columns: ColumnsColumn[];
}

const columnIdSchema = z.string().trim().min(1).max(120);

export const columnsSchema = z.object({
  columns: z
    .array(
      z.object({
        id: columnIdSchema,
        label: z.string().trim().min(1).max(120).optional(),
        blocks: z.array(z.any()).max(40),
      }),
    )
    .min(1)
    .max(4),
}) as unknown as z.ZodType<ColumnsData>;

export const columnsMdx: BlockMdxConfig<ColumnsData> = {
  tag: "Columns",
  toAttrs: (data) => ({ columns: data.columns }),
  fromAttrs: (attrs) => ({
    columns: (attrs.array<ColumnsColumn>("columns") ?? []) as ColumnsColumn[],
  }),
};
