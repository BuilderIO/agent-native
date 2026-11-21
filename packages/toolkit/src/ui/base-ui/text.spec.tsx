// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Text, type TextProps } from "./text.js";

afterEach(cleanup);

describe("Text part", () => {
  it("renders a span that inherits its size and color", () => {
    render(<Text>Saved</Text>);
    const text = screen.getByText("Saved");
    expect(text.tagName).toBe("SPAN");
    expect(text.className).toBe("text");
    expect(text.dataset.size).toBeUndefined();
    expect(text.dataset.textStyle).toBeUndefined();
    expect(text.dataset.color).toBeUndefined();
    expect(text.hasAttribute("data-as")).toBe(false);
  });

  it("sets a text style, and refuses a name the system doesn't define", () => {
    render(
      <Text as="p" textStyle="caption">
        Updated 2 minutes ago
      </Text>,
    );
    expect(screen.getByText("Updated 2 minutes ago").dataset.textStyle).toBe(
      "caption",
    );
    const props = { textStyle: "subtitle" } as unknown as TextProps;
    expect(() => render(<Text {...props}>Bad</Text>)).toThrow(
      /textStyle="subtitle" is not one of/,
    );
  });

  it("renders the element `as` picks, keeping its attributes", () => {
    render(
      <>
        <Text as="label" htmlFor="name">
          Name
        </Text>
        <input id="name" />
      </>,
    );
    const label = screen.getByText("Name");
    expect(label.tagName).toBe("LABEL");
    expect(screen.getByLabelText("Name").id).toBe("name");
  });

  it("writes the text props as Radix names them", () => {
    render(
      <Text
        as="p"
        size="3"
        weight="medium"
        align="center"
        trim="both"
        truncate
        wrap="pretty"
        color="danger"
        highContrast
      >
        Failed to save
      </Text>,
    );
    const text = screen.getByText("Failed to save");
    expect(text.tagName).toBe("P");
    expect({ ...text.dataset }).toEqual({
      size: "3",
      weight: "medium",
      align: "center",
      trim: "both",
      truncate: "",
      wrap: "pretty",
      color: "danger",
      highContrast: "",
    });
  });

  it("refuses an element it doesn't allow instead of drawing a span", () => {
    const props = { as: "h1" } as unknown as TextProps;
    expect(() => render(<Text {...props}>Title</Text>)).toThrow(
      /as="h1" is not one of/,
    );
  });

  it("renders any other element through render", () => {
    render(<Text render={<dt />}>Plan</Text>);
    const text = screen.getByText("Plan");
    expect(text.tagName).toBe("DT");
    expect(text.className).toBe("text");
  });
});
