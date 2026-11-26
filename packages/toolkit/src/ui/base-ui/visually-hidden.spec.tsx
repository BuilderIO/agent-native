// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IconButton } from "./button.js";
import { VisuallyHidden } from "./visually-hidden.js";

afterEach(cleanup);

describe("Visually Hidden part", () => {
  it("names a control while staying in the accessibility tree", () => {
    render(
      <IconButton>
        <svg aria-hidden="true" />
        <VisuallyHidden>Close</VisuallyHidden>
      </IconButton>,
    );
    const hidden = screen.getByText("Close");
    expect({
      named: screen.getByRole("button", { name: "Close" }).contains(hidden),
      tag: hidden.tagName,
      className: hidden.className,
      ariaHidden: hidden.getAttribute("aria-hidden"),
    }).toEqual({
      named: true,
      tag: "SPAN",
      className: "visually-hidden",
      ariaHidden: null,
    });
  });

  it("renders as another element and merges the caller's class", () => {
    render(
      <VisuallyHidden render={<h2 />} className="extra" id="title">
        Settings
      </VisuallyHidden>,
    );
    const heading = screen.getByRole("heading", { name: "Settings" });
    expect({
      tag: heading.tagName,
      classes: [...heading.classList].sort(),
      id: heading.id,
    }).toEqual({
      tag: "H2",
      classes: ["extra", "visually-hidden"],
      id: "title",
    });
  });
});
