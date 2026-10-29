// @vitest-environment happy-dom

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
  FONT_SIZE_SCALE,
  FontSizeField,
  parseFontSizeInput,
  stepFontSize,
  type FontSizeFieldProps,
} from "./font-size.js";
import { cancelActiveScrubInputs } from "./scrub-input.js";

const SCALE = [12, 16, 24, 32, 48] as const;
const COMMIT = { phase: "commit" };

function ScrubGlyph({ className }: { className?: string }) {
  return <svg className={className} />;
}

function renderField(overrides: Partial<FontSizeFieldProps> = {}) {
  const onChange = vi.fn<FontSizeFieldProps["onChange"]>();
  render(
    <FontSizeField
      label="Size"
      openLabel="Font sizes"
      mixedLabel="Mixed"
      value={24}
      scale={SCALE}
      min={8}
      max={160}
      unit="px"
      onChange={onChange}
      {...overrides}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("Size");
  return { onChange, input };
}

function typeAndEnter(input: HTMLInputElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function openList() {
  fireEvent.click(screen.getByRole("button", { name: "Font sizes" }));
  return screen.getAllByRole("option");
}

describe("FontSizeField", () => {
  afterEach(cleanup);

  it("offers the shared type scale by default and marks the current size", () => {
    render(
      <FontSizeField
        label="Default size"
        openLabel="Default sizes"
        mixedLabel="Mixed"
        value={96}
        min={8}
        max={160}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Default sizes" }));
    const options = screen.getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual(
      FONT_SIZE_SCALE.map(String),
    );
    const current = options.find((option) => option.textContent === "96");
    if (!current) throw new Error("Expected the 96 option");
    expect(current.getAttribute("data-current")).toBe("true");
    expect(current.querySelector("svg")).not.toBeNull();
    const other = options.find((option) => option.textContent === "16");
    if (!other) throw new Error("Expected the 16 option");
    expect(other.querySelector("svg")).toBeNull();
  });

  it("commits a typed size on Enter, keeping one decimal", () => {
    const { onChange, input } = renderField();

    typeAndEnter(input, "18.25");

    expect(onChange).toHaveBeenCalledWith(18.3, COMMIT);
  });

  it("reverts invalid input instead of committing NaN or 0", () => {
    const { onChange, input } = renderField();

    typeAndEnter(input, "abc");
    expect(input.value).toBe("24");
    typeAndEnter(input, "0");
    expect(input.value).toBe("24");
    typeAndEnter(input, "-4");

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("24");
  });

  it("clamps typed sizes to the caller's range", () => {
    const { onChange, input } = renderField();

    typeAndEnter(input, "400");
    typeAndEnter(input, "2");

    expect(onChange.mock.calls).toEqual([
      [160, COMMIT],
      [8, COMMIT],
    ]);
  });

  it("shows the bare number with no unit suffix and no stepper buttons", () => {
    renderField();

    expect(screen.queryByText("px")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("opens the scale from the chevron with the current size highlighted", () => {
    renderField();

    const options = openList();

    expect(options.map((option) => option.textContent)).toEqual([
      "12",
      "16",
      "24",
      "32",
      "48",
    ]);
    const current = options.at(2);
    if (!current) throw new Error("missing current option");
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(current.getAttribute("data-current")).toBe("true");
  });

  it("opens the scale with Alt+ArrowDown", () => {
    const { input } = renderField();

    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });

    expect(screen.getAllByRole("option")).toHaveLength(SCALE.length);
  });

  it("commits a picked size and closes the list", () => {
    const { onChange } = renderField();

    const option = openList().at(4);
    if (!option) throw new Error("missing option");
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(48, COMMIT);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("steps to the next and previous size on the scale with the arrow keys", () => {
    function Controlled() {
      const [value, setValue] = useState(20);
      return (
        <FontSizeField
          label="Size"
          openLabel="Font sizes"
          mixedLabel="Mixed"
          value={value}
          scale={SCALE}
          onChange={setValue}
        />
      );
    }
    render(<Controlled />);
    const input = screen.getByLabelText<HTMLInputElement>("Size");
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("24");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("32");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("16");
  });

  it("shows the mixed label and applies a picked size to all", () => {
    const { onChange, input } = renderField({ mixed: true });

    expect(input.value).toBe("Mixed");
    expect(screen.queryByText("px")).toBeNull();
    const options = openList();
    expect(
      options.some((option) => option.getAttribute("data-current") === "true"),
    ).toBe(false);
    const option = options.at(0);
    if (!option) throw new Error("missing option");
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(12, COMMIT);
  });

  it("leaves a mixed selection alone when Enter is pressed on the label", () => {
    const { onChange, input } = renderField({ mixed: true });

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reverts a typed draft on Escape", () => {
    const { onChange, input } = renderField();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "99" } });
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("24");
  });

  it("lists named sizes after the scale under their group label", () => {
    renderField({
      value: 56,
      namedSizes: [
        { label: "Heading 1", value: 56 },
        { label: "Heading 2", value: 34 },
      ],
      namedSizesLabel: "Deck",
    });

    const options = openList();

    expect(screen.getByText("Deck")).toBeTruthy();
    expect(options.map((option) => option.textContent)).toEqual([
      "56",
      ...SCALE.map(String),
      "Heading 156",
      "Heading 234",
    ]);
  });

  it("pins a size that is off the scale above the list, checked", () => {
    const { onChange } = renderField({ value: 58 });

    const options = openList();
    const pinned = options.at(0);
    if (!pinned) throw new Error("missing pinned size");

    expect(pinned.textContent).toBe("58");
    expect(pinned.getAttribute("data-current")).toBe("true");
    expect(pinned.querySelector("svg")).not.toBeNull();
    expect(
      options
        .slice(1)
        .some((option) => option.getAttribute("data-current") === "true"),
    ).toBe(false);
    fireEvent.click(pinned);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pins nothing when the size is on the scale", () => {
    renderField({ value: 24 });

    const options = openList();

    expect(options.map((option) => option.textContent)).toEqual(
      SCALE.map(String),
    );
  });
});

describe("FontSizeField scrub handle", () => {
  afterEach(cleanup);

  function scrubHandle() {
    const handle = document.querySelector<HTMLElement>(
      "[data-font-size-scrub]",
    );
    if (!handle) throw new Error("missing scrub handle");
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();
    return handle;
  }

  function pointer(type: string, clientX: number) {
    return Object.assign(new Event(type, { bubbles: true }), {
      pointerId: 1,
      clientX,
      button: 0,
    });
  }

  it("has no handle unless the caller asks for one", () => {
    renderField();

    expect(document.querySelector("[data-font-size-scrub]")).toBeNull();
  });

  it("previews while dragging and commits once on release", () => {
    const { onChange, input } = renderField({ scrubIcon: ScrubGlyph });
    const handle = scrubHandle();

    act(() => handle.dispatchEvent(pointer("pointerdown", 0)));
    act(() => handle.dispatchEvent(pointer("pointermove", 10)));
    expect(input.value).toBe("34");
    act(() => handle.dispatchEvent(pointer("pointerup", 10)));

    expect(onChange.mock.calls).toEqual([
      [34, { phase: "preview" }],
      [34, COMMIT],
    ]);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("ignores movement under the drag threshold and focuses the field on a click", () => {
    const { onChange, input } = renderField({ scrubIcon: ScrubGlyph });
    const handle = scrubHandle();

    act(() => handle.dispatchEvent(pointer("pointerdown", 0)));
    act(() => handle.dispatchEvent(pointer("pointermove", 2)));
    act(() => handle.dispatchEvent(pointer("pointerup", 2)));

    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("restores the starting size when a scrub is cancelled", () => {
    const { onChange, input } = renderField({ scrubIcon: ScrubGlyph });
    const handle = scrubHandle();

    act(() => handle.dispatchEvent(pointer("pointerdown", 0)));
    act(() => handle.dispatchEvent(pointer("pointermove", 10)));
    act(() => cancelActiveScrubInputs());
    act(() => handle.dispatchEvent(pointer("pointerup", 10)));

    expect(onChange.mock.calls).toEqual([
      [34, { phase: "preview" }],
      [24, { phase: "preview" }],
      [24, { phase: "cancel" }],
    ]);
    expect(input.value).toBe("24");
  });

  it("clamps a scrub to the caller's range", () => {
    const { onChange } = renderField({ scrubIcon: ScrubGlyph, max: 30 });
    const handle = scrubHandle();

    act(() => handle.dispatchEvent(pointer("pointerdown", 0)));
    act(() => handle.dispatchEvent(pointer("pointermove", 50)));
    act(() => handle.dispatchEvent(pointer("pointerup", 50)));

    expect(onChange).toHaveBeenLastCalledWith(30, COMMIT);
  });
});

describe("FontSizeField mixed relative expressions", () => {
  afterEach(cleanup);

  it("reports a typed Mixed expression so each object changes by it", () => {
    const { onChange, input } = renderField({
      mixed: true,
      value: 20,
      allowRelativeExpressions: true,
    });

    typeAndEnter(input, "Mixed+2");

    expect(onChange).toHaveBeenCalledWith(22, {
      phase: "commit",
      relativeExpression: {
        expression: "Mixed+2",
        min: 8,
        max: 160,
        unit: "px",
        precision: 1,
      },
    });
    expect(input.value).toBe("Mixed");
  });

  it("treats a Mixed expression as invalid when the caller does not allow it", () => {
    const { onChange, input } = renderField({ mixed: true, value: 20 });

    typeAndEnter(input, "Mixed+2");

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("Mixed");
  });

  it("still sets one size for all when a plain number is typed", () => {
    const { onChange, input } = renderField({
      mixed: true,
      value: 20,
      allowRelativeExpressions: true,
    });

    typeAndEnter(input, "30");

    expect(onChange).toHaveBeenCalledWith(30, COMMIT);
  });
});

describe("font size helpers", () => {
  it("parses sizes with units and rejects non-positive values", () => {
    expect(parseFontSizeInput("24px", 16, { unit: "px" })).toBe(24);
    expect(parseFontSizeInput("12*2", 16)).toBe(24);
    expect(parseFontSizeInput("", 16)).toBeNull();
    expect(parseFontSizeInput("0", 16, { min: 1 })).toBeNull();
    expect(parseFontSizeInput("0.5", 16, { min: 1 })).toBe(1);
  });

  it("steps within the caller's bounds and stops at the ends of the scale", () => {
    expect(stepFontSize(24, SCALE, 1)).toBe(32);
    expect(stepFontSize(25, SCALE, -1)).toBe(24);
    expect(stepFontSize(48, SCALE, 1)).toBeNull();
    expect(stepFontSize(24, SCALE, 1, { max: 30 })).toBeNull();
  });
});
