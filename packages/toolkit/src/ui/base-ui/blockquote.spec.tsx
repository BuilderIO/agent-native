// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Blockquote } from "./blockquote.js";

afterEach(cleanup);

describe("Blockquote part", () => {
  it("renders a blockquote that inherits its size", () => {
    render(<Blockquote cite="https://example.com">Ship it.</Blockquote>);
    const quote = screen.getByText("Ship it.");
    expect(quote.tagName).toBe("BLOCKQUOTE");
    expect(quote.className).toBe("blockquote");
    expect(quote.getAttribute("cite")).toBe("https://example.com");
    expect(quote.dataset.size).toBeUndefined();
  });

  it("writes the text props", () => {
    render(
      <Blockquote weight="light" color="accent" wrap="balance">
        Ship it.
      </Blockquote>,
    );
    const quote = screen.getByText("Ship it.");
    expect({ ...quote.dataset }).toEqual({
      weight: "light",
      color: "accent",
      wrap: "balance",
    });
  });
});
