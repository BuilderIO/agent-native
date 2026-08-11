import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

export interface ComparisonSide {
  label: string;
  body: string;
}

export interface ComparisonData {
  sides: ComparisonSide[];
}

export const comparisonSchema = z.object({
  sides: z
    .array(z.object({ label: z.string(), body: z.string() }))
    .min(2)
    .max(4),
}) as unknown as z.ZodType<ComparisonData>;

export function parseSidesFromMarkdown(children: string): ComparisonSide[] {
  return splitMarkdownHeadingSections(children).map((section) => ({
    label: section.title,
    body: section.body,
  }));
}

export function serializeSidesToMarkdown(sides: ComparisonSide[]): string {
  return sides.map((s) => `### ${s.label}\n\n${s.body}`).join("\n\n");
}

export const comparisonMdx: BlockMdxConfig<ComparisonData> = {
  tag: "Comparison",
  childrenField: "sides" as never,
  toAttrs: () => ({}),
  fromAttrs: (_attrs, children) => ({
    sides: parseSidesFromMarkdown(children),
  }),
  serializeChildren: (data) => serializeSidesToMarkdown(data.sides),
};
