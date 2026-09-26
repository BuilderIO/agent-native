import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export interface ChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
  note?: string;
}

export interface ChecklistData {
  items: ChecklistItem[];
}

const checklistItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(400),
  checked: z.boolean().optional(),
  note: z.string().trim().max(800).optional(),
});

export const checklistSchema = z.object({
  items: z.array(checklistItemSchema).max(200),
}) as unknown as z.ZodType<ChecklistData>;

export const checklistMdx: BlockMdxConfig<ChecklistData> = {
  tag: "Checklist",
  toAttrs: (data) => ({ items: data.items }),
  fromAttrs: (attrs) => ({
    items: (attrs.array<ChecklistItem>("items") ?? []) as ChecklistItem[],
  }),
};
