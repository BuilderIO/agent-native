import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

export const MAX_COLUMNS_PER_ROW = 3;

export interface SequenceItem {
  text: string;
  break?: boolean;
  accent?: string;
}

export interface SequenceData {
  items: SequenceItem[];
}

export const sequenceSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string(),
        break: z.boolean().optional(),
        accent: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
}) as unknown as z.ZodType<SequenceData>;

export function groupSequenceRows(items: SequenceItem[]): SequenceItem[][] {
  const rows: SequenceItem[][] = [];
  for (const item of items) {
    const currentRow = rows[rows.length - 1];
    const startsNewRow =
      !currentRow || item.break || currentRow.length >= MAX_COLUMNS_PER_ROW;
    if (startsNewRow) {
      rows.push([item]);
    } else {
      currentRow.push(item);
    }
  }
  return rows;
}

const THEMATIC_BREAK_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

export function parseSequenceFromMarkdown(children: string): SequenceItem[] {
  const sections = splitMarkdownHeadingSections(children);
  const items: SequenceItem[] = [];
  let nextStartsRow = false;
  for (const section of sections) {
    const colorMatch = /^:([a-z0-9-]+):\s*(.+)$/.exec(section.title);
    items.push({
      text: colorMatch ? colorMatch[2] : section.title,
      ...(colorMatch ? { accent: colorMatch[1] } : {}),
      ...(nextStartsRow ? { break: true } : {}),
    });
    nextStartsRow = THEMATIC_BREAK_RE.test(section.body.trim());
  }
  return items;
}

export function serializeSequenceToMarkdown(items: SequenceItem[]): string {
  const rows = groupSequenceRows(items);
  return rows
    .map((row, rowIndex) => {
      const isLastRow = rowIndex === rows.length - 1;
      return row
        .map((item, i) => {
          const isLastInRow = i === row.length - 1;
          const body = isLastInRow && !isLastRow ? "\n\n---" : "";
          const heading = item.accent
            ? `:${item.accent}: ${item.text}`
            : item.text;
          return `### ${heading}${body}`;
        })
        .join("\n\n");
    })
    .join("\n\n");
}

export const sequenceMdx: BlockMdxConfig<SequenceData> = {
  tag: "Sequence",
  childrenField: "items" as never,
  toAttrs: () => ({}),
  fromAttrs: (_attrs, children) => ({
    items: parseSequenceFromMarkdown(children),
  }),
  serializeChildren: (data) => serializeSequenceToMarkdown(data.items),
};
