// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Heading, type HeadingProps } from "./heading.js";

afterEach(cleanup);

describe("Heading part", () => {
  it("renders an h1 in the title-large text style by default", () => {
    render(<Heading>Billing</Heading>);
    const heading = screen.getByRole("heading", { level: 1, name: "Billing" });
    expect(heading.className).toBe("heading");
    expect(heading.dataset.textStyle).toBe("title-large");
    expect(heading.dataset.size).toBeUndefined();
    expect(heading.dataset.weight).toBeUndefined();
    expect(heading.hasAttribute("data-as")).toBe(false);
  });

  it("takes another text style, which a size or weight overrides", () => {
    render(
      <Heading as="h2" textStyle="title-small" size="5">
        Members
      </Heading>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Members" });
    expect({
      textStyle: heading.dataset.textStyle,
      size: heading.dataset.size,
    }).toEqual({ textStyle: "title-small", size: "5" });
  });

  it("chooses its level and its size apart", () => {
    render(
      <Heading as="h3" size="2" weight="bold" color="gray" highContrast>
        Invoices
      </Heading>,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Invoices" });
    expect(heading.dataset.size).toBe("2");
    expect(heading.dataset.weight).toBe("bold");
    expect(heading.dataset.color).toBe("gray");
    expect(heading.dataset.highContrast).toBe("");
  });

  it("refuses a size off the type scale", () => {
    const props = { size: "10" } as unknown as HeadingProps;
    expect(() => render(<Heading {...props}>Billing</Heading>)).toThrow(
      /size="10" is not one of/,
    );
  });
});
