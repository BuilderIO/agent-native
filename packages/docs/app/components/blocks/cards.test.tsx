import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CardsBlock } from "./cards";

describe("CardsBlock", () => {
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
