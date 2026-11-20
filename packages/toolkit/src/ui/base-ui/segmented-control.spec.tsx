// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SegmentedControl,
  type SegmentedControlProps,
  SegmentedControlItem,
} from "./segmented-control.js";

afterEach(cleanup);

function Example(props: Partial<SegmentedControlProps>) {
  return (
    <SegmentedControl aria-label="Easing" defaultValue="curve" {...props}>
      <SegmentedControlItem value="curve">Curve</SegmentedControlItem>
      <SegmentedControlItem value="spring">Spring</SegmentedControlItem>
    </SegmentedControl>
  );
}

describe("SegmentedControl part", () => {
  it("writes its variant, surface by default", () => {
    render(<Example />);
    const group = screen.getByRole("group", { name: "Easing" });
    expect(group.classList.contains("segmented-control")).toBe(true);
    expect(group.dataset.size).toBe("md");
    expect(group.dataset.variant).toBe("surface");
    expect(group.dataset.radius).toBeUndefined();
    const curve = screen.getByRole("button", { name: "Curve" });
    expect(curve.classList.contains("segmented-control-item")).toBe(true);
    expect(curve.getAttribute("aria-pressed")).toBe("true");
    expect(curve.hasAttribute("data-pressed")).toBe(true);
  });

  it("writes variant and radius as Radix names them", () => {
    render(<Example size="sm" variant="soft" radius="full" />);
    const group = screen.getByRole("group", { name: "Easing" });
    expect(group.dataset.size).toBe("sm");
    expect(group.dataset.variant).toBe("soft");
    expect(group.dataset.radius).toBe("full");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "ghost" } as unknown as SegmentedControlProps;
    expect(() => render(<Example {...props} />)).toThrow(
      /variant="ghost" is not one of/,
    );
  });

  it("selects one value at a time and reports it as a string", () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    const spring = screen.getByRole("button", { name: "Spring" });
    fireEvent.click(spring);
    expect(onValueChange).toHaveBeenCalledWith("spring", expect.anything());
    expect(spring.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Curve" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("keeps the selected value when it's pressed again", () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    const curve = screen.getByRole("button", { name: "Curve" });
    fireEvent.click(curve);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(curve.getAttribute("aria-pressed")).toBe("true");
  });

  it("follows a controlled value", () => {
    const { rerender } = render(<Example value="curve" />);
    rerender(<Example value="spring" />);
    expect(
      screen
        .getByRole("button", { name: "Spring" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("moves between items with the arrow keys", async () => {
    render(<Example />);
    const curve = screen.getByRole("button", { name: "Curve" });
    const spring = screen.getByRole("button", { name: "Spring" });
    act(() => curve.focus());
    fireEvent.keyDown(curve, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(spring));
  });

  it("ignores presses while disabled", () => {
    const onValueChange = vi.fn();
    render(<Example disabled onValueChange={onValueChange} />);
    const group = screen.getByRole("group", { name: "Easing" });
    expect(group.hasAttribute("data-disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Spring" }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
