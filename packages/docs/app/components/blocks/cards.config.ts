import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

export interface CardItem {
  title: string;
  href?: string;
  icon?: string;
  body: string;
}

export interface CardsData {
  cards: CardItem[];
  /** Grid column count, 1-4. Defaults to 3. */
  columns?: number;
}

export const cardsSchema = z.object({
  cards: z
    .array(
      z.object({
        title: z.string(),
        href: z.string().optional(),
        icon: z.string().optional(),
        body: z.string(),
      }),
    )
    .min(1)
    .max(12),
  columns: z.number().int().min(1).max(4).optional(),
}) as unknown as z.ZodType<CardsData>;

export function parseCardsFromMarkdown(children: string): CardItem[] {
  return splitMarkdownHeadingSections(children).map(({ title, body }) => {
    const iconMatch = title.match(/^:([a-z0-9-]+):\s*(.+)$/);
    const icon = iconMatch?.[1];
    const rest = iconMatch ? iconMatch[2] : title;

    const linkMatch = rest.match(/^\[(.+?)\]\((.+?)\)$/);
    return linkMatch
      ? { title: linkMatch[1], href: linkMatch[2], icon, body }
      : { title: rest, icon, body };
  });
}

export function serializeCardsToMarkdown(cards: CardItem[]): string {
  return cards
    .map((c) => {
      const heading = c.href ? `[${c.title}](${c.href})` : c.title;
      const prefixed = c.icon ? `:${c.icon}: ${heading}` : heading;
      return `### ${prefixed}\n\n${c.body}`;
    })
    .join("\n\n");
}

export const cardsMdx: BlockMdxConfig<CardsData> = {
  tag: "Cards",
  childrenField: "cards" as never,
  toAttrs: (data) => ({ columns: data.columns }),
  fromAttrs: (attrs, children) => ({
    cards: parseCardsFromMarkdown(children),
    columns: attrs.number("columns"),
  }),
  serializeChildren: (data) => serializeCardsToMarkdown(data.cards),
};
