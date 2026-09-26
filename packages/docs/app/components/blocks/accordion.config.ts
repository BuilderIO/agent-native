import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

export interface AccordionItem {
  title: string;
  body: string;
}

export interface AccordionData {
  items: AccordionItem[];
}

export const accordionSchema = z.object({
  items: z
    .array(z.object({ title: z.string(), body: z.string() }))
    .min(1)
    .max(30),
}) as unknown as z.ZodType<AccordionData>;

export function parseAccordionFromMarkdown(children: string): AccordionItem[] {
  return splitMarkdownHeadingSections(children);
}

export function serializeAccordionToMarkdown(items: AccordionItem[]): string {
  return items.map((s) => `### ${s.title}\n\n${s.body}`).join("\n\n");
}

export const accordionMdx: BlockMdxConfig<AccordionData> = {
  tag: "Accordion",
  childrenField: "items" as never,
  toAttrs: () => ({}),
  fromAttrs: (_attrs, children) => ({
    items: parseAccordionFromMarkdown(children),
  }),
  serializeChildren: (data) => serializeAccordionToMarkdown(data.items),
};
