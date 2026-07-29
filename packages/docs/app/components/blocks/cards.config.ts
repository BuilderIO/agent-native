import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

export interface CardItem {
  title: string;
  href?: string;
  body: string;
}

export interface CardsData {
  cards: CardItem[];
}

export const cardsSchema = z.object({
  cards: z
    .array(
      z.object({
        title: z.string(),
        href: z.string().optional(),
        body: z.string(),
      }),
    )
    .min(1)
    .max(12),
}) as unknown as z.ZodType<CardsData>;

export function parseCardsFromMarkdown(children: string): CardItem[] {
  const parts = children.split(/\n(?=###\s)/);
  const cards: CardItem[] = [];
  for (const part of parts) {
    const match = part.match(/^###\s+(.+?)\n([\s\S]*)$/);
    if (!match) continue;
    const rawTitle = match[1].trim();
    const body = match[2].trim();
    const linkMatch = rawTitle.match(/^\[(.+?)\]\((.+?)\)$/);
    if (linkMatch) {
      cards.push({ title: linkMatch[1], href: linkMatch[2], body });
    } else {
      cards.push({ title: rawTitle, body });
    }
  }
  return cards;
}

export function serializeCardsToMarkdown(cards: CardItem[]): string {
  return cards
    .map((c) => {
      const heading = c.href ? `[${c.title}](${c.href})` : c.title;
      return `### ${heading}\n\n${c.body}`;
    })
    .join("\n\n");
}

export const cardsMdx: BlockMdxConfig<CardsData> = {
  tag: "Cards",
  childrenField: "cards" as never,
  toAttrs: () => ({}),
  fromAttrs: (_attrs, children) => ({
    cards: parseCardsFromMarkdown(children),
  }),
  serializeChildren: (data) => serializeCardsToMarkdown(data.cards),
};
