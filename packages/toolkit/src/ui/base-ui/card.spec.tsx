// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Card, type CardProps } from "./card.js";

afterEach(cleanup);

describe("Card part", () => {
  it("writes its size and variant, size 2 surface by default", () => {
    render(<Card data-testid="card">Usage</Card>);
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
    expect(card.className).toBe("card");
    expect(card.dataset.size).toBe("2");
    expect(card.dataset.variant).toBe("surface");
  });

  it("writes the size and variant it is given", () => {
    render(
      <Card data-testid="card" size="5" variant="ghost">
        Usage
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card.dataset.size).toBe("5");
    expect(card.dataset.variant).toBe("ghost");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "classic" } as unknown as CardProps;
    expect(() => render(<Card {...props} />)).toThrow(
      /variant="classic" is not one of/,
    );
  });

  it("renders as a link, keeping its name and the link's target", () => {
    render(
      <Card render={<a href="/runs/42" />} size="3">
        Run 42
      </Card>,
    );
    const link = screen.getByRole("link", { name: "Run 42" });
    expect(link.getAttribute("href")).toBe("/runs/42");
    expect(link.classList.contains("card")).toBe(true);
    expect(link.dataset.size).toBe("3");
  });
});
