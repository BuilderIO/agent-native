// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Quote } from "./quote.js";

afterEach(cleanup);

describe("Quote part", () => {
  it("renders its element with no attributes by default", () => {
    render(<Quote>ship it</Quote>);
    const element = screen.getByText("ship it");
    expect(element.tagName).toBe("Q");
    expect(element.className).toBe("quote");
    expect({ ...element.dataset }).toEqual({});
  });

  it("writes truncate and wrap", () => {
    render(
      <Quote truncate wrap="nowrap">
        ship it
      </Quote>,
    );
    expect({ ...screen.getByText("ship it").dataset }).toEqual({
      truncate: "",
      wrap: "nowrap",
    });
  });
});
