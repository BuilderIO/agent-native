// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  type AvatarProps,
} from "./avatar.js";

afterEach(cleanup);

describe("Avatar part", () => {
  it("writes its size and variant, size 3 soft by default, inheriting its color", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>,
    );
    const avatar = container.querySelector(".avatar");
    expect(avatar?.getAttribute("data-size")).toBe("md");
    expect(avatar?.getAttribute("data-variant")).toBe("soft");
    expect(avatar?.hasAttribute("data-color")).toBe(false);
    expect(avatar?.hasAttribute("data-radius")).toBe(false);
  });

  it("writes color, high contrast and radius as Radix names them", () => {
    const { container } = render(
      <Avatar size="xs" variant="solid" color="info" highContrast radius="none">
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>,
    );
    const avatar = container.querySelector(".avatar");
    expect(avatar?.getAttribute("data-size")).toBe("xs");
    expect(avatar?.getAttribute("data-variant")).toBe("solid");
    expect(avatar?.getAttribute("data-color")).toBe("info");
    expect(avatar?.getAttribute("data-high-contrast")).toBe("");
    expect(avatar?.getAttribute("data-radius")).toBe("none");
  });

  it("refuses a size it doesn't have instead of drawing the default", () => {
    const props = { size: "xl" } as unknown as AvatarProps;
    expect(() => render(<Avatar {...props} />)).toThrow(
      /size="xl" is not one of/,
    );
  });

  it("shows the fallback while the image has not loaded", () => {
    render(
      <Avatar size="lg">
        <AvatarImage src="https://example.com/ada.png" alt="" />
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("AL").classList.contains("avatar-fallback")).toBe(
      true,
    );
  });
});
