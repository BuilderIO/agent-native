// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Em } from "./em.js";

afterEach(cleanup);

describe("Em part", () => {
  it("renders its element with no attributes by default", () => {
    render(<Em>faster</Em>);
    const element = screen.getByText("faster");
    expect(element.tagName).toBe("EM");
    expect(element.className).toBe("em");
    expect({ ...element.dataset }).toEqual({});
  });

  it("writes truncate and wrap", () => {
    render(
      <Em truncate wrap="nowrap">
        faster
      </Em>,
    );
    expect({ ...screen.getByText("faster").dataset }).toEqual({
      truncate: "",
      wrap: "nowrap",
    });
  });
});
