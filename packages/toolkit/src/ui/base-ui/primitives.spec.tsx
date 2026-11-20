// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Badge } from "./badge.js";
import { Spinner } from "./spinner.js";
import { ToggleGroup } from "./toggle-group.js";
import { Toggle, type ToggleProps } from "./toggle.js";

afterEach(cleanup);

describe("Toggle part", () => {
  it("writes its size and variant, size md ghost by default, inheriting its color", () => {
    render(<Toggle aria-label="Bold" />);
    const toggle = screen.getByRole("button", { name: "Bold" });
    expect(toggle.dataset.size).toBe("md");
    expect(toggle.dataset.variant).toBe("ghost");
    expect(toggle.dataset.color).toBeUndefined();
    expect(toggle.dataset.radius).toBeUndefined();
  });

  it("writes variant, color, high contrast and radius as Radix names them", () => {
    render(
      <Toggle
        aria-label="Bold"
        variant="outline"
        color="gray"
        highContrast
        radius="full"
      />,
    );
    const toggle = screen.getByRole("button", { name: "Bold" });
    expect(toggle.dataset.variant).toBe("outline");
    expect(toggle.dataset.color).toBe("gray");
    expect(toggle.dataset.highContrast).toBe("");
    expect(toggle.dataset.radius).toBe("full");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "solid" } as unknown as ToggleProps;
    expect(() => render(<Toggle aria-label="Bold" {...props} />)).toThrow(
      /variant="solid" is not one of/,
    );
  });

  it("stays pressed after a press and reports it", () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle aria-label="Bold" size="sm" onPressedChange={onPressedChange} />,
    );
    const toggle = screen.getByRole("button", { name: "Bold" });
    expect(toggle.classList.contains("toggle")).toBe(true);
    expect(toggle.dataset.size).toBe("sm");
    fireEvent.click(toggle);
    expect(onPressedChange).toHaveBeenCalledWith(true, expect.anything());
    expect(toggle.hasAttribute("data-pressed")).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("holds one pressed value in a group", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup defaultValue={["left"]} onValueChange={onValueChange}>
        <Toggle value="left" aria-label="Left" />
        <Toggle value="center" aria-label="Center" />
      </ToggleGroup>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Center" }));
    expect(onValueChange).toHaveBeenCalledWith(["center"], expect.anything());
    expect(screen.getByRole("group").classList.contains("toggle-group")).toBe(
      true,
    );
  });
  it("draws its toggles with the group's props, and a toggle's own win", () => {
    render(
      <ToggleGroup aria-label="Align" size="sm" variant="soft" color="gray">
        <Toggle value="left" aria-label="Left" />
        <Toggle value="center" aria-label="Center" variant="outline" />
      </ToggleGroup>,
    );
    const left = screen.getByRole("button", { name: "Left" });
    expect(left.dataset.size).toBe("sm");
    expect(left.dataset.variant).toBe("soft");
    expect(left.dataset.color).toBe("gray");
    const center = screen.getByRole("button", { name: "Center" });
    expect(center.dataset.size).toBe("sm");
    expect(center.dataset.variant).toBe("outline");
  });

  it("does not press a toggle in a disabled group", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup aria-label="Align" disabled onValueChange={onValueChange}>
        <Toggle value="left" aria-label="Left" />
      </ToggleGroup>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("Badge and Spinner parts", () => {
  it("writes a badge's color and variant, and takes render", () => {
    render(
      <>
        <Badge color="success" variant="solid">
          Live
        </Badge>
        <Badge render={<a href="/drafts" />}>Draft</Badge>
      </>,
    );
    const live = screen.getByText("Live");
    expect(live.className).toBe("badge");
    expect(live.dataset.color).toBe("success");
    expect(live.dataset.variant).toBe("solid");
    const draft = screen.getByText("Draft");
    expect(draft.tagName).toBe("A");
    expect(draft.dataset.variant).toBe("soft");
  });

  it("hides a spinner without a label, and announces one with it", () => {
    const { container } = render(
      <>
        <Spinner />
        <Spinner label="Saving" />
      </>,
    );
    const spinners = container.querySelectorAll(".spinner");
    expect(spinners[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status", { name: "Saving" })).toBeTruthy();
  });
});
