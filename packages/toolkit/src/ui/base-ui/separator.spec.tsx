// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Separator } from "./separator.js";

afterEach(cleanup);

describe("Separator part", () => {
  it("is a full-length gray horizontal separator unless told otherwise", () => {
    render(<Separator />);
    const separator = screen.getByRole("separator");
    expect(separator.classList.contains("separator")).toBe(true);
    expect(separator.dataset.orientation).toBe("horizontal");
    expect(separator.dataset.color).toBe("gray");
  });

  it("writes its orientation and color", () => {
    render(<Separator orientation="vertical" color="accent" />);
    const separator = screen.getByRole("separator");
    expect(separator.dataset.orientation).toBe("vertical");
    expect(separator.dataset.color).toBe("accent");
  });
});
