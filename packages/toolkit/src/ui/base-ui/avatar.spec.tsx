// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";

afterEach(cleanup);

describe("Avatar part", () => {
  it("writes its variant, soft by default, inheriting its color", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>,
    );
    const avatar = container.querySelector(".avatar");
    expect(avatar?.getAttribute("data-variant")).toBe("soft");
    expect(avatar?.hasAttribute("data-color")).toBe(false);
    expect(avatar?.hasAttribute("data-radius")).toBe(false);
  });

  it("writes color, high contrast and radius as Radix names them", () => {
    const { container } = render(
      <Avatar variant="solid" color="info" highContrast radius="none">
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>,
    );
    const avatar = container.querySelector(".avatar");
    expect(avatar?.getAttribute("data-variant")).toBe("solid");
    expect(avatar?.getAttribute("data-color")).toBe("info");
    expect(avatar?.getAttribute("data-high-contrast")).toBe("");
    expect(avatar?.getAttribute("data-radius")).toBe("none");
  });

  it("shows the fallback while the image has not loaded", () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/ada.png" alt="" />
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("AL").classList.contains("avatar-fallback")).toBe(
      true,
    );
  });
});
