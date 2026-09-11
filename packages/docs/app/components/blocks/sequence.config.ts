import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

/** Rows cap at this many cards; a longer sequence wraps automatically with an
 * elbow connector instead of overflowing. Shared by the row-grouping logic
 * and the `Read` renderer's decision to stretch a row to full width. */
export const MAX_COLUMNS_PER_ROW = 3;

export interface SequenceItem {
  /** Short markdown phrase for one card, e.g. "The **#marketing** channel
   * receives an update". Supports inline markdown (bold, code, links) but
   * is meant to stay a single short line, not a paragraph. */
  text: string;
  /** True when this item starts a new row, connected to the previous row
   * by an elbow instead of a plain arrow. Authored as a lone `---` line
   * between two cards, not as a per-card attribute. A row also breaks
   * automatically once it reaches `MAX_COLUMNS_PER_ROW`, with no `---`
   * needed. */
  break?: boolean;
  /** Optional accent key ("blue" | "green" | "red" | "yellow"), the same
   * set Comparison uses, so authors reach for the same word everywhere on
   * the site. Authored as a `:color:` prefix on the card's heading, e.g.
   * `### :blue: Dispatch sees the message`. Omit for the neutral default —
   * reserve an accent for the one card that matters, not every card. */
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

/** Groups a flat item list into rows: at each `break` boundary, or every
 * `MAX_COLUMNS_PER_ROW` items if the author never broke sooner. Shared by
 * the `Read` renderer and the markdown serializer so the row logic exists
 * once. */
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

// A thematic break survives the MDX authoring pipeline's remark
// parse-then-stringify round trip, which re-renders `---` as `***` (remark
// stringify's default rule character) before this function ever sees it —
// so this must accept any valid CommonMark thematic-break form, not just
// the literal three dashes an author typed.
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
    // A lone thematic-break line is the only body content a Sequence card
    // accepts — it marks "the next card starts a new row", not real
    // card content.
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
