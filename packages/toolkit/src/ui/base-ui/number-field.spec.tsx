// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldIncrement,
  type NumberFieldProps,
  NumberFieldScrubArea,
} from "./number-field.js";

afterEach(cleanup);

function scrub(movementX: number) {
  const move = new PointerEvent("pointermove", { bubbles: true });
  Object.defineProperty(move, "movementX", { value: movementX });
  Object.defineProperty(move, "movementY", { value: 0 });
  act(() => {
    window.dispatchEvent(move);
  });
}

describe("Number Field part", () => {
  it("draws Input's frame at size 3 surface by default, with the input bare inside it", () => {
    render(<NumberField aria-label="Quantity" defaultValue={2} />);
    const input = screen.getByRole("textbox", { name: "Quantity" });
    expect(input.classList.contains("input-control")).toBe(true);
    expect(input).toHaveProperty("value", "2");
    const frame = input.closest<HTMLElement>(".number-field");
    expect(frame?.classList.contains("input")).toBe(true);
    expect(frame?.dataset.size).toBe("md");
    expect(frame?.dataset.variant).toBe("surface");
    expect(frame?.dataset.color).toBeUndefined();
  });

  it("writes size, variant, color and radius on the frame, with its class and style", () => {
    render(
      <NumberField
        aria-label="Width"
        size="sm"
        variant="soft"
        color="danger"
        radius="full"
        className="w-24"
        style={{ maxWidth: 96 }}
      />,
    );
    const frame = screen
      .getByRole("textbox", { name: "Width" })
      .closest<HTMLElement>(".number-field");
    expect(frame?.dataset.size).toBe("sm");
    expect(frame?.dataset.variant).toBe("soft");
    expect(frame?.dataset.color).toBe("danger");
    expect(frame?.dataset.radius).toBe("full");
    expect(frame?.classList.contains("w-24")).toBe(true);
    expect(frame?.style.maxWidth).toBe("96px");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "ghost" } as unknown as NumberFieldProps;
    expect(() => render(<NumberField aria-label="X" {...props} />)).toThrow(
      /variant="ghost" is not one of/,
    );
  });

  it("steps with the arrow keys, ten at a time with Shift, and stops at max", () => {
    const onValueChange = vi.fn();
    render(
      <NumberField
        aria-label="Opacity"
        defaultValue={90}
        max={100}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Opacity" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveProperty("value", "91");
    expect(onValueChange).toHaveBeenLastCalledWith(91, expect.anything());
    fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
    expect(input).toHaveProperty("value", "81");
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(input).toHaveProperty("value", "100");
  });

  it("steps by its step from ghost icon-button steppers sized one below the field", () => {
    render(
      <NumberField aria-label="Gap" defaultValue={8} step={4} min={4} size="md">
        <NumberFieldDecrement />
        <NumberFieldIncrement />
      </NumberField>,
    );
    const input = screen.getByRole("textbox", { name: "Gap" });
    const increase = screen.getByRole("button", { name: "Increase" });
    const decrease = screen.getByRole("button", { name: "Decrease" });
    expect(increase.classList.contains("icon-button")).toBe(true);
    expect(increase.classList.contains("number-field-increment")).toBe(true);
    expect(increase.dataset.variant).toBe("ghost");
    expect(increase.dataset.size).toBe("sm");
    expect(increase.dataset.color).toBe("gray");
    expect(increase.closest(".number-field")).not.toBeNull();
    fireEvent.click(increase);
    expect(input).toHaveProperty("value", "12");
    fireEvent.click(decrease);
    fireEvent.click(decrease);
    expect(input).toHaveProperty("value", "4");
    expect(decrease.hasAttribute("disabled")).toBe(true);
  });

  it("tints a soft field's steppers with the field's color", () => {
    render(
      <NumberField aria-label="Count" variant="soft" color="success">
        <NumberFieldIncrement />
      </NumberField>,
    );
    const increase = screen.getByRole("button", { name: "Increase" });
    expect(increase.dataset.color).toBeUndefined();
    expect(increase.dataset.size).toBe("sm");
  });

  it("names the input from its scrub area and changes the value when the area is dragged", () => {
    const onValueCommitted = vi.fn();
    render(
      <NumberField defaultValue={120} onValueCommitted={onValueCommitted}>
        <NumberFieldScrubArea>X</NumberFieldScrubArea>
      </NumberField>,
    );
    const input = screen.getByRole("textbox", { name: "X" });
    const area = screen
      .getByText("X")
      .closest<HTMLElement>(".number-field-scrub-area");
    expect(area?.classList.contains("input-slot")).toBe(true);
    expect(area?.dataset.side).toBe("left");
    if (area === null) throw new Error("no scrub area");
    act(() => {
      fireEvent.pointerDown(area, { pointerType: "mouse", button: 0 });
    });
    expect(area.hasAttribute("data-scrubbing")).toBe(true);
    scrub(6);
    expect(input).toHaveProperty("value", "126");
    scrub(-10);
    expect(input).toHaveProperty("value", "116");
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    expect(area.hasAttribute("data-scrubbing")).toBe(false);
    expect(onValueCommitted).toHaveBeenCalledWith(116, expect.anything());
  });

  it("formats its value with Intl options and parses what is typed back", () => {
    const onValueChange = vi.fn();
    render(
      <NumberField
        aria-label="Price"
        locale="en-US"
        format={{ style: "currency", currency: "USD" }}
        defaultValue={1234.5}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Price" });
    expect(input).toHaveProperty("value", "$1,234.50");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveProperty("value", "$1,235.50");
    fireEvent.change(input, { target: { value: "$2,000" } });
    expect(onValueChange).toHaveBeenLastCalledWith(2000, expect.anything());
  });
});
