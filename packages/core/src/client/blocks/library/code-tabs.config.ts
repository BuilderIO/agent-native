import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export interface CodeTabsTab {
  id: string;
  label: string;
  language?: string;
  code: string;
  caption?: string;
  maxLines?: number;
}

export interface CodeTabsData {
  tabs: CodeTabsTab[];
}

const tabIdSchema = z.string().trim().min(1).max(120);

export const codeTabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        id: tabIdSchema,
        label: z.string().trim().min(1).max(120),
        language: z.string().trim().max(40).optional(),
        code: z.string().max(100_000),
        caption: z.string().trim().max(400).optional(),
        maxLines: z.number().int().min(0).max(2000).optional(),
      }),
    )
    .min(1)
    .max(12),
}) as unknown as z.ZodType<CodeTabsData>;

export const codeTabsMdx: BlockMdxConfig<CodeTabsData> = {
  tag: "CodeTabs",
  toAttrs: (data) => ({ tabs: data.tabs }),
  fromAttrs: (attrs) => ({
    tabs: attrs.array<CodeTabsTab>("tabs") ?? [],
  }),
};
