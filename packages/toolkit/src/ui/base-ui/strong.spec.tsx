// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Strong } from "./strong.js";

afterEach(cleanup);

describe("Strong part", () => {
  it("renders its element with no attributes by default", () => {
    render(<Strong>now</Strong>);
    const element = screen.getByText("now");
    expect(element.tagName).toBe("STRONG");
    expect(element.className).toBe("strong");
    expect({ ...element.dataset }).toEqual({});
  });

  it("writes truncate and wrap", () => {
    render(
      <Strong truncate wrap="nowrap">
        now
      </Strong>,
    );
    expect({ ...screen.getByText("now").dataset }).toEqual({
      truncate: "",
      wrap: "nowrap",
    });
  });
});
