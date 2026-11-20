// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Separator, type SeparatorProps } from "./separator.js";

afterEach(cleanup);

describe("Separator part", () => {
  it("is a full-length gray horizontal separator unless told otherwise", () => {
    render(<Separator />);
    const separator = screen.getByRole("separator");
    expect(separator.classList.contains("separator")).toBe(true);
    expect(separator.dataset.orientation).toBe("horizontal");
    expect(separator.dataset.size).toBe("4");
    expect(separator.dataset.color).toBe("gray");
  });

  it("writes its orientation, size and color", () => {
    render(<Separator orientation="vertical" size="1" color="accent" />);
    const separator = screen.getByRole("separator");
    expect(separator.dataset.orientation).toBe("vertical");
    expect(separator.dataset.size).toBe("1");
    expect(separator.dataset.color).toBe("accent");
  });

  it("refuses a size it doesn't have instead of drawing the default", () => {
    const props = { size: "5" } as unknown as SeparatorProps;
    expect(() => render(<Separator {...props} />)).toThrow(
      /size="5" is not one of/,
    );
  });
});
