// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
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
  Object.defineProperty(move, "movementX", {
    value: movementX,
    configurable: true,
  });
  Object.defineProperty(move, "movementY", { value: 0 });
  act(() => {
    window.dispatchEvent(move);
  });
}

describe("Number Field part", () => {
  it("draws Input's frame at surface by default, with the input bare inside it", () => {
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

  it("honors explicit minimum precision for unit values", () => {
    render(
      <NumberField
        aria-label="Angle"
        locale="en-US"
        unit="degree"
        defaultValue={1.25}
        format={{ minimumFractionDigits: 4 }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Angle" })).toHaveProperty(
      "value",
      "1.2500°",
    );
  });

  it("keeps degree units inline and commits typed fractions at two-place precision", () => {
    const commit = vi.fn();
    render(
      <NumberField
        aria-label="Angle"
        name="angle"
        locale="en-US"
        defaultValue={0}
        unit="degree"
        onValueCommitted={commit}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Angle",
    });
    expect(input.value).toBe("0°");
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    expect(input.value).toBe("1°");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "-3.859" } });
    act(() => input.blur());
    expect(input.value).toBe("-3.86°");
    expect(commit).toHaveBeenLastCalledWith(-3.86, expect.anything());
    const submitted = document.querySelector<HTMLInputElement>(
      'input[name="angle"]',
    );
    expect(submitted?.valueAsNumber).toBe(-3.86);
    expect(submitted?.validity.valid).toBe(true);
  });

  it("writes variant, color and radius on the frame, with its class and style", () => {
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

  it("uses the caller's stepper elements and keeps their increment and decrement behavior", () => {
    render(
      <NumberField aria-label="Width" defaultValue={3}>
        <NumberFieldIncrement render={<button data-step="up" />} />
        <NumberFieldDecrement
          render={(props) => <button {...props} data-step="down" />}
        />
      </NumberField>,
    );
    const input = screen.getByRole("textbox", { name: "Width" });
    const up = screen.getByRole("button", { name: "Increase" });
    const down = screen.getByRole("button", { name: "Decrease" });
    expect(up.dataset.step).toBe("up");
    expect(down.dataset.step).toBe("down");
    fireEvent.click(up);
    expect(input).toHaveProperty("value", "4");
    fireEvent.click(down);
    expect(input).toHaveProperty("value", "3");
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
    scrub(2.75);
    expect(input).toHaveProperty("value", "122");
    scrub(3.25);
    expect(input).toHaveProperty("value", "126");
    scrub(-10);
    expect(input).toHaveProperty("value", "116");
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    expect(area.hasAttribute("data-scrubbing")).toBe(false);
    expect(onValueCommitted).toHaveBeenCalledWith(116, expect.anything());
  });

  it("uses the active scrub handle's theme on each replacement cursor", async () => {
    const originalLock = Object.getOwnPropertyDescriptor(
      document.body,
      "requestPointerLock",
    );
    Object.defineProperty(document.body, "requestPointerLock", {
      configurable: true,
      value: async () => {},
    });
    try {
      render(
        <NumberField defaultValue={12}>
          <NumberFieldScrubArea>Width</NumberFieldScrubArea>
        </NumberField>,
      );
      const handle = screen.getByText("Width").parentElement;
      if (!handle) throw new Error("Missing width scrub handle");
      for (const size of ["18px", "23px"]) {
        handle.style.setProperty("--control-icon-size-3", size);
        await act(async () => {
          fireEvent.pointerDown(handle, { pointerType: "mouse", button: 0 });
        });
        const cursor = document.body.querySelector<HTMLElement>(
          ".number-field-scrub-area-cursor",
        );
        expect(cursor?.style.getPropertyValue("--control-icon-size-3")).toBe(
          size,
        );
        fireEvent.pointerUp(window);
        expect(cursor?.isConnected).toBe(false);
      }
    } finally {
      if (originalLock)
        Object.defineProperty(
          document.body,
          "requestPointerLock",
          originalLock,
        );
      else Reflect.deleteProperty(document.body, "requestPointerLock");
    }
  });

  it("accumulates a burst of pointer movements in a controlled field before committing", () => {
    const commit = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<number | null>(100);
      return (
        <NumberField
          value={value}
          onValueChange={setValue}
          onValueCommitted={commit}
        >
          <NumberFieldScrubArea>Width</NumberFieldScrubArea>
        </NumberField>
      );
    }
    render(<Controlled />);
    fireEvent.pointerDown(screen.getByText("Width"), {
      pointerType: "mouse",
      button: 0,
    });
    act(() => {
      for (const delta of [4, 8, -4, 4]) {
        const move = new PointerEvent("pointermove", { bubbles: true });
        Object.defineProperty(move, "movementX", { value: delta });
        window.dispatchEvent(move);
      }
    });
    fireEvent.pointerUp(window);
    expect(screen.getByRole("textbox", { name: "Width" })).toHaveProperty(
      "value",
      "112",
    );
    expect(commit).toHaveBeenCalledWith(112, expect.anything());
  });

  it("keeps tracking an unlocked pointer when focus moves into the scrub field", () => {
    const commit = vi.fn();
    render(
      <>
        <button>Undo</button>
        <NumberField defaultValue={20} onValueCommitted={commit}>
          <NumberFieldScrubArea>Width</NumberFieldScrubArea>
        </NumberField>
      </>,
    );
    screen.getByRole("button", { name: "Undo" }).focus();
    const label = screen.getByText("Width");
    fireEvent.pointerDown(label, {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 7,
      button: 0,
      clientX: 80,
    });
    screen.getByRole("textbox", { name: "Width" }).focus();
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 90, movementX: 0 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 87, movementX: 0 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 87 });
    expect(screen.getByRole("textbox", { name: "Width" })).toHaveProperty(
      "value",
      "27",
    );
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(
      27,
      expect.objectContaining({ reason: "scrub" }),
    );
  });

  it("cancels once when a controlled field becomes read-only during a scrub", async () => {
    const cancel = vi.fn();
    const commit = vi.fn();
    function Width({ readOnly }: { readOnly: boolean }) {
      const [value, setValue] = useState<number | null>(40);
      return (
        <NumberField
          value={value}
          readOnly={readOnly}
          onValueChange={setValue}
          onValueCommitted={commit}
        >
          <NumberFieldScrubArea
            onScrubCancel={() => {
              cancel();
              setValue(40);
            }}
          >
            Width
          </NumberFieldScrubArea>
        </NumberField>
      );
    }
    const { rerender } = render(<Width readOnly={false} />);
    const start = () =>
      fireEvent.pointerDown(screen.getByText("Width"), {
        pointerType: "mouse",
        button: 0,
      });
    start();
    scrub(8);
    const input = screen.getByRole("textbox", { name: "Width" });
    expect(input).toHaveProperty("value", "48");
    await act(async () => rerender(<Width readOnly />));
    scrub(6);
    fireEvent.pointerUp(window);
    expect(input).toHaveProperty("value", "40");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    rerender(<Width readOnly={false} />);
    start();
    scrub(4);
    fireEvent.pointerUp(window);
    expect(commit).toHaveBeenCalledWith(
      44,
      expect.objectContaining({ reason: "scrub" }),
    );
  });

  it("removes German digit grouping while preserving the decimal comma", () => {
    const changed = vi.fn();
    render(
      <NumberField
        aria-label="Width"
        locale="de-DE"
        defaultValue={1280.5}
        onValueChange={changed}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Width" });
    expect(input).toHaveProperty("value", "1280,5");
    fireEvent.change(input, { target: { value: "2.048,25" } });
    expect(changed).toHaveBeenLastCalledWith(2048.25, expect.anything());
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
    expect(input).toHaveProperty("value", "$1234.50");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveProperty("value", "$1235.50");
    fireEvent.change(input, { target: { value: "$2,000" } });
    expect(onValueChange).toHaveBeenLastCalledWith(2000, expect.anything());
  });
});
