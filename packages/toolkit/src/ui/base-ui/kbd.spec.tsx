// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Kbd, type KbdProps } from "./kbd.js";

afterEach(cleanup);

describe("Kbd part", () => {
  it("renders a kbd, surface by default, following the text's size", () => {
    render(<Kbd>⌘K</Kbd>);
    const key = screen.getByText("⌘K");
    expect(key.tagName).toBe("KBD");
    expect(key.className).toBe("kbd");
    expect(key.dataset.variant).toBe("surface");
    expect(key.dataset.size).toBeUndefined();
  });

  it("writes a step of the type scale and its variant", () => {
    render(<Kbd variant="soft">⇧⌘P</Kbd>);
    const key = screen.getByText("⇧⌘P");
    expect(key.dataset.variant).toBe("soft");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "classic" } as unknown as KbdProps;
    expect(() => render(<Kbd {...props}>/</Kbd>)).toThrow(
      /variant="classic" is not one of/,
    );
  });

  it("renders as a button through render, keeping its name", () => {
    render(
      <Kbd render={<button type="button" aria-label="Change shortcut" />}>
        ⌘S
      </Kbd>,
    );
    const button = screen.getByRole("button", { name: "Change shortcut" });
    expect(button.className).toBe("kbd");
  });
});
