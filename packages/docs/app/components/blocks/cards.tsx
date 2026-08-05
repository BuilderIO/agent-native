import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import { Link } from "react-router";

import { cardsSchema, cardsMdx, type CardsData } from "./cards.config";

export type { CardsData };

export function CardsBlock({ data, ctx }: BlockReadProps<CardsData>) {
  return (
    <ul className="docs-cards" role="list">
      {data.cards.map((card, i) => {
        const body = ctx.renderMarkdown?.(card.body) ?? <p>{card.body}</p>;

        return (
          <li key={i} className="docs-card">
            {card.href ? (
              <Link
                to={card.href}
                prefetch="viewport"
                data-an-prefetch="viewport"
                className="docs-card-link"
              >
                <div className="docs-card-title docs-card-heading">
                  {card.title}
                  <span className="docs-card-arrow" aria-hidden="true">
                    →
                  </span>
                </div>
                <div className="docs-card-body">{body}</div>
              </Link>
            ) : (
              <>
                <p className="docs-card-title">{card.title}</p>
                <div className="docs-card-body">{body}</div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const cardsBlock = defineBlock<CardsData>({
  type: "cards",
  schema: cardsSchema,
  mdx: cardsMdx,
  Read: CardsBlock,
  placement: ["block"],
  label: "Cards",
  description:
    "A responsive card grid for feature overviews. Each card has a title (optionally linked) and a short description.",
  empty: () => ({
    cards: [
      {
        title: "Feature name",
        href: "/docs/feature",
        body: "Short description.",
      },
    ],
  }),
});
