import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

export interface ComparisonSide {
  label: string;
  body: string;
  /** Optional explicit accent, e.g. "blue" — see ACCENT_COLOR_KEYS in
   * comparison.tsx. Authored as a `:color:` prefix on the heading, same
   * shortcode idiom Cards uses for `:icon:`. Omit to fall back to the
   * legacy Before/After-label heuristic in comparison.tsx. */
  color?: string;
}

export interface ComparisonData {
  sides: ComparisonSide[];
}

export const comparisonSchema = z.object({
  sides: z
    .array(
      z.object({
        label: z.string(),
        body: z.string(),
        color: z.string().optional(),
      }),
    )
    .min(2)
    .max(4),
}) as unknown as z.ZodType<ComparisonData>;

export function parseSidesFromMarkdown(children: string): ComparisonSide[] {
  return splitMarkdownHeadingSections(children).map(({ title, body }) => {
    const colorMatch = title.match(/^:([a-z0-9-]+):\s*(.+)$/);
    return {
      label: colorMatch ? colorMatch[2] : title,
      color: colorMatch?.[1],
      body,
    };
  });
}

export function serializeSidesToMarkdown(sides: ComparisonSide[]): string {
  return sides
    .map((s) => {
      const heading = s.color ? `:${s.color}: ${s.label}` : s.label;
      return `### ${heading}\n\n${s.body}`;
    })
    .join("\n\n");
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
