import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CardsBlock } from "./cards";
import {
  parseCardsFromMarkdown,
  serializeCardsToMarkdown,
} from "./cards.config";

describe("parseCardsFromMarkdown", () => {
  it("extracts a leading :icon: shortcode from the heading", () => {
    const [card] = parseCardsFromMarkdown(
      "### :robot: Agent tool\n\nCallable from chat.",
    );

    expect(card).toEqual({
      title: "Agent tool",
      icon: "robot",
      body: "Callable from chat.",
    });
  });

  it("combines an :icon: shortcode with a linked title", () => {
    const [card] = parseCardsFromMarkdown(
      "### :components: [Actions](/docs/actions)\n\nTyped operations.",
    );

    expect(card).toEqual({
      title: "Actions",
      href: "/docs/actions",
      icon: "components",
      body: "Typed operations.",
    });
  });

  it("round-trips an iconed card through serialize + parse", () => {
    const original = [{ title: "Agent tool", icon: "robot", body: "Body." }];
    const [card] = parseCardsFromMarkdown(serializeCardsToMarkdown(original));

    expect(card).toEqual(original[0]);
  });
});

describe("CardsBlock", () => {
  it("renders the icon for a card that has one", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CardsBlock
          blockId="cards"
          ctx={{}}
          data={{
            cards: [{ title: "Agent tool", icon: "robot", body: "Body." }],
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("docs-card-icon");
  });

  it("defaults the grid to 3 columns", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CardsBlock
          blockId="cards"
          ctx={{}}
          data={{ cards: [{ title: "One", body: "Body." }] }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("--cards-cols:3");
  });

  it("honors an explicit column count", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CardsBlock
          blockId="cards"
          ctx={{}}
          data={{ cards: [{ title: "One", body: "Body." }], columns: 2 }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("--cards-cols:2");
  });

  it("wraps linked card content in a prefetching router link", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CardsBlock
          blockId="cards"
          ctx={{}}
          data={{
            cards: [
              {
                title: "Add an Action",
                href: "/docs/getting-started-actions",
                body: "Define your first typed action.",
              },
            ],
          }}
        />
      </MemoryRouter>,
    );
    const link = html.match(
      /<a\b[^>]*href="\/docs\/getting-started-actions"[^>]*>[\s\S]*?<\/a>/,
    )?.[0];

    expect(link).toBeDefined();
    expect(link).toContain('data-an-prefetch="viewport"');
    expect(link).toContain('data-discover="true"');
    expect(link).toContain("Add an Action");
    expect(link).toContain("Define your first typed action.");
  });
});
