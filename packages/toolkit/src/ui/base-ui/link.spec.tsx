// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Link, type LinkProps } from "./link.js";

afterEach(cleanup);

describe("Link part", () => {
  it("renders an anchor that underlines on hover by default", () => {
    render(<Link href="/docs">Docs</Link>);
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.className).toBe("link");
    expect(link.getAttribute("href")).toBe("/docs");
    expect(link.dataset.underline).toBe("auto");
    expect(link.dataset.size).toBeUndefined();
    expect(link.dataset.color).toBeUndefined();
  });

  it("writes its underline and text props", () => {
    render(
      <Link
        href="/docs"
        underline="always"
        weight="medium"
        color="gray"
        highContrast
      >
        Docs
      </Link>,
    );
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.dataset.underline).toBe("always");
    expect(link.dataset.weight).toBe("medium");
    expect(link.dataset.color).toBe("gray");
    expect(link.dataset.highContrast).toBe("");
  });

  it("refuses an underline mode it doesn't have", () => {
    const props = { underline: "dotted" } as unknown as LinkProps;
    expect(() => render(<Link {...props}>Docs</Link>)).toThrow(
      /underline="dotted" is not one of/,
    );
  });

  it("renders as a button through render, keeping its name and click", () => {
    const onClick = vi.fn();
    render(
      <Link render={<button type="button" />} onClick={onClick}>
        Show more
      </Link>,
    );
    const button = screen.getByRole("button", { name: "Show more" });
    expect(button.className).toBe("link");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
