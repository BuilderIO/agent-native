import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import {
  IconComponents,
  IconNetwork,
  IconPlug,
  IconRobot,
  IconServer2,
  IconTerminal2,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import type React from "react";
import { Link } from "react-router";

import { cardsSchema, cardsMdx, type CardsData } from "./cards.config";

export type { CardsData };

const CARD_ICON: Record<string, TablerIcon> = {
  robot: IconRobot,
  components: IconComponents,
  server: IconServer2,
  plug: IconPlug,
  network: IconNetwork,
  terminal: IconTerminal2,
};

export function CardsBlock({ data, ctx }: BlockReadProps<CardsData>) {
  return (
    <ul
      className="docs-cards"
      role="list"
      style={{ "--cards-cols": data.columns ?? 3 } as React.CSSProperties}
    >
      {data.cards.map((card, i) => {
        const body = ctx.renderMarkdown?.(card.body) ?? <p>{card.body}</p>;
        const Icon = card.icon ? CARD_ICON[card.icon] : undefined;
        const gridClass = Icon
          ? "docs-card-grid docs-card-grid--icon"
          : "docs-card-grid";

        return (
          <li key={i} className="docs-card">
            {card.href ? (
              <Link
                to={card.href}
                prefetch="viewport"
                data-an-prefetch="viewport"
                className={`docs-card-link ${gridClass}`}
              >
                {Icon && <Icon className="docs-card-icon" aria-hidden="true" />}
                <div className="docs-card-title docs-card-heading">
                  {card.title}
                  <span className="docs-card-arrow" aria-hidden="true">
                    →
                  </span>
                </div>
                <div className="docs-card-body">{body}</div>
              </Link>
            ) : (
              <div className={gridClass}>
                {Icon && <Icon className="docs-card-icon" aria-hidden="true" />}
                <p className="docs-card-title">{card.title}</p>
                <div className="docs-card-body">{body}</div>
              </div>
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
    "A card grid for feature overviews. Each card has a title (optionally linked), a short description, and an optional icon. Grid width defaults to 3 columns, configurable 1-4.",
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
