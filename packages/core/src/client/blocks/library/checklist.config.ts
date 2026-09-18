import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the standard `checklist` block: its data schema and
 * MDX round-trip config. Lives in core because checklist is a STANDARD block
 * shared across apps (plan today, content later). The React renderer/editor live
 * in `./checklist.tsx`; this file is safe to import from server / agent code
 * (the plan server MDX adapter registers it) without pulling React into the
 * bundle.
 *
 * The schema MUST stay data-compatible with the `checklist` branch of the plan
 * `planBlockSchema` (`items[]` of `{ id, label, checked?, note? }`), and the MDX
 * `tag` + attribute shape MUST match the legacy
 * `<Checklist id title summary editable items />` encoding
 * (`plan-mdx.ts` `serializeBlock` L322 / `parseBlock` L626) so stored `.mdx`
 * round-trips byte-compatibly.
 */

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

/**
 * MDX config: a self-closing `<Checklist … items />` element. `items` is the
 * only data attribute (always a JSON expression via the shared `prop()` encoder,
 * matching the legacy `prop("items", block.data.items)` output). `fromAttrs`
 * reads `items` and defaults to `[]` for backward-compat, mirroring the legacy
 * `arrayAttr(node, "items") ?? []`.
 */
export const checklistMdx: BlockMdxConfig<ChecklistData> = {
  tag: "Checklist",
  toAttrs: (data) => ({ items: data.items }),
  fromAttrs: (attrs) => ({
    items: (attrs.array<ChecklistItem>("items") ?? []) as ChecklistItem[],
  }),
};
