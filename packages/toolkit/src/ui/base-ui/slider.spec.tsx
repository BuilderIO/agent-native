// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Slider, type SliderProps } from "./slider.js";

afterEach(cleanup);

describe("Slider part", () => {
  it("renders the part structure and one named thumb for a number", () => {
    const { container } = render(
      <Slider defaultValue={40} thumbLabel="Volume" />,
    );
    const root = container.querySelector(".slider");
    expect(root?.getAttribute("data-orientation")).toBe("horizontal");
    expect(root?.getAttribute("data-variant")).toBe("surface");
    expect(root?.hasAttribute("data-color")).toBe(false);
    expect(root?.querySelector(".slider-control .slider-track")).not.toBeNull();
    expect(root?.querySelector(".slider-indicator")).not.toBeNull();
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs).toHaveLength(1);
    expect(screen.getByRole("slider", { name: "Volume" })).toBeTruthy();
    expect(thumbs[0]?.getAttribute("aria-valuenow")).toBe("40");
  });

  it("renders a thumb per value for a range, named by index", () => {
    render(
      <Slider
        defaultValue={[20, 80]}
        thumbLabel={(index) => (index === 0 ? "Minimum" : "Maximum")}
      />,
    );
    expect(screen.getByRole("slider", { name: "Minimum" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Maximum" })).toBeTruthy();
  });

  it("writes variant, color, high contrast and radius as Radix names them", () => {
    const { container } = render(
      <Slider
        defaultValue={40}
        thumbLabel="Volume"
        variant="soft"
        color="info"
        highContrast
        radius="small"
      />,
    );
    const root = container.querySelector(".slider");
    expect(root?.getAttribute("data-variant")).toBe("soft");
    expect(root?.getAttribute("data-color")).toBe("info");
    expect(root?.getAttribute("data-high-contrast")).toBe("");
    expect(root?.getAttribute("data-radius")).toBe("small");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "classic" } as unknown as SliderProps;
    expect(() =>
      render(<Slider defaultValue={40} thumbLabel="Volume" {...props} />),
    ).toThrow(/variant="classic" is not one of/);
  });

  it("steps with the arrow keys and reports the value", () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        defaultValue={50}
        step={5}
        thumbLabel="Zoom"
        onValueChange={onValueChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Zoom" }), {
      key: "ArrowRight",
    });
    expect(onValueChange).toHaveBeenCalledWith(55, expect.anything());
  });
});
