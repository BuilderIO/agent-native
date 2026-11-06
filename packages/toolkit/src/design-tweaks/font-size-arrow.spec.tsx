// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { FontSizeField } from "./font-size.js";

afterEach(cleanup);

it("steps font sizes by one pixel, or ten pixels with Shift", () => {
  function Controlled() {
    const [value, setValue] = useState(40);
    return (
      <FontSizeField
        label="Size"
        openLabel="Font sizes"
        mixedLabel="Mixed"
        value={value}
        onChange={setValue}
      />
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText<HTMLInputElement>("Size");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("41");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.value).toBe("40");
  fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
  expect(input.value).toBe("50");
  fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
  expect(input.value).toBe("40");
});

it("commits repeated mixed arrow steps as relative expressions even at representative bounds", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <FontSizeField
      label="Size"
      openLabel="Font sizes"
      mixedLabel="Valores mixtos"
      mixed
      allowRelativeExpressions
      value={30}
      min={8}
      max={30}
      unit="px"
      onChange={onChange}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("Size");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
  expect(input.value).toBe("Valores mixtos");

  rerender(
    <FontSizeField
      label="Size"
      openLabel="Font sizes"
      mixedLabel="Valores mixtos"
      mixed
      allowRelativeExpressions
      value={8}
      min={8}
      max={30}
      unit="px"
      onChange={onChange}
    />,
  );
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
  fireEvent.blur(input);
  expect(input.value).toBe("Valores mixtos");
  const meta = (expression: string) => ({
    phase: "commit",
    relativeExpression: {
      expression,
      min: 8,
      max: 30,
      unit: "px",
      precision: 1,
    },
  });
  expect(onChange.mock.calls).toEqual([
    [30, meta("Mixed+1")],
    [30, meta("Mixed+1")],
    [30, meta("Mixed+10")],
    [8, meta("Mixed-1")],
    [8, meta("Mixed-10")],
  ]);
});

it("keeps absolute stepping for mixed selections without relative expressions and for typed numbers", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <FontSizeField
      label="Size"
      openLabel="Font sizes"
      mixedLabel="Mixed"
      mixed
      value={20}
      onChange={onChange}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("Size");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(onChange).toHaveBeenLastCalledWith(21, { phase: "commit" });

  rerender(
    <FontSizeField
      label="Size"
      openLabel="Font sizes"
      mixedLabel="Mixed"
      mixed
      allowRelativeExpressions
      value={20}
      onChange={onChange}
    />,
  );
  fireEvent.change(input, { target: { value: "25" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(onChange).toHaveBeenLastCalledWith(24, { phase: "commit" });
});

it.each([
  { value: 40, outward: "ArrowUp" },
  { value: 5, outward: "ArrowDown" },
])(
  "does not reverse a mixed absolute step from $value",
  ({ value, outward }) => {
    const onChange = vi.fn();
    render(
      <FontSizeField
        label="Size"
        openLabel="Font sizes"
        mixedLabel="Mixed"
        mixed
        value={value}
        min={8}
        max={30}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Size");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: outward });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("Mixed");
  },
);

it.each([
  { value: 40, outward: "ArrowUp", inward: "ArrowDown", expected: 30 },
  { value: 5, outward: "ArrowDown", inward: "ArrowUp", expected: 8 },
])(
  "never reverses an arrow step when $value is outside the bounds",
  ({ value, outward, inward, expected }) => {
    const onChange = vi.fn();
    render(
      <FontSizeField
        label="Size"
        openLabel="Font sizes"
        mixedLabel="Mixed"
        value={value}
        min={8}
        max={30}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Size");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: outward });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: inward });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(expected, { phase: "commit" });
  },
);
