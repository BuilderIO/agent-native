// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Card, type CardProps } from "./card.js";

afterEach(cleanup);

describe("Card part", () => {
  it("writes its variant, surface by default", () => {
    render(<Card data-testid="card">Usage</Card>);
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
    expect(card.className).toBe("card");
    expect(card.dataset.variant).toBe("surface");
  });

  it("writes the variant it is given", () => {
    render(
      <Card data-testid="card" variant="ghost">
        Usage
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card.dataset.variant).toBe("ghost");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "classic" } as unknown as CardProps;
    expect(() => render(<Card {...props} />)).toThrow(
      /variant="classic" is not one of/,
    );
  });

  it("renders as a link, keeping its name and the link's target", () => {
    render(<Card render={<a href="/runs/42" />}>Run 42</Card>);
    const link = screen.getByRole("link", { name: "Run 42" });
    expect(link.getAttribute("href")).toBe("/runs/42");
    expect(link.classList.contains("card")).toBe(true);
  });
});
