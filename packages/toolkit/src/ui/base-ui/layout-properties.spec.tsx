// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  LayoutDimensions,
  PropertyNumber,
  resizeLayout,
} from "./layout-properties.js";

afterEach(cleanup);
it("cancels pending work when a replacement selection unmounts its property input", () => {
  const first = vi.fn(),
    second = vi.fn();
  const view = render(
    <PropertyNumber key="a" label="Width" value={40} onEdit={first} />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Width" }), {
    target: { value: "90" },
  });
  expect(first).toHaveBeenLastCalledWith({ phase: "preview", value: 90 });
  view.rerender(
    <PropertyNumber key="b" label="Width" value={90} onEdit={second} />,
  );
  expect(first).toHaveBeenLastCalledWith({ phase: "cancel" });
  expect(second).not.toHaveBeenCalled();
});
it("keeps the visible numeric field and its text selection focused after Escape", () => {
  const onEdit = vi.fn();
  render(<PropertyNumber label="Width" value={123} onEdit={onEdit} />);
  const getInput = () =>
    screen.getByRole<HTMLInputElement>("textbox", { name: "Width" });
  const input = getInput();
  act(() => input.focus());
  fireEvent.input(input, { target: { value: "4567" } });
  input.setSelectionRange(1, 4, "backward");
  fireEvent.keyDown(input, { key: "Escape" });

  const restored = getInput();
  expect(restored.value).toBe("123");
  expect(restored.id).toBe(input.id);
  expect(document.activeElement).toBe(restored);
  expect([
    restored.selectionStart,
    restored.selectionEnd,
    restored.selectionDirection,
  ]).toEqual([1, 3, "backward"]);
  expect(onEdit).toHaveBeenLastCalledWith({ phase: "cancel" });
});

it.each(["readOnly", "disabled"] as const)(
  "discards a typed preview when the field becomes %s",
  (mode) => {
    const onEdit = vi.fn();
    const props = { label: "Width", value: 40, onEdit };
    const view = render(<PropertyNumber {...props} />);
    const field = () =>
      screen.getByRole<HTMLInputElement>("textbox", { name: "Width" });
    act(() => field().focus());
    fireEvent.input(field(), { target: { value: "90" } });
    view.rerender(<PropertyNumber {...props} {...{ [mode]: true }} />);
    expect(onEdit.mock.calls.map(([edit]) => edit)).toEqual([
      { phase: "preview", value: 90 },
      { phase: "cancel" },
    ]);
    expect(field().value).toBe("40");
    expect(document.activeElement === field()).toBe(mode === "readOnly");
    view.rerender(<PropertyNumber {...props} />);
    fireEvent.blur(field());
    expect(onEdit).toHaveBeenCalledTimes(2);
  },
);

it("cancels a nested field edit when an ancestor fieldset locks, respecting the first legend", async () => {
  const edit = vi.fn(),
    editLegend = vi.fn();
  const { container } = render(
    <fieldset>
      <legend>
        <PropertyNumber label="Scale" value={1} onEdit={editLegend} />
      </legend>
      <fieldset>
        <PropertyNumber label="Width" value={40} onEdit={edit} />
      </fieldset>
    </fieldset>,
  );
  const outer = container.querySelector("fieldset");
  if (!outer) throw new Error("Missing outer fieldset");
  const width = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Width",
  });
  act(() => width.focus());
  fireEvent.input(width, { target: { value: "90" } });
  await act(async () => {
    outer.disabled = true;
  });
  expect(edit.mock.calls.map(([change]) => change)).toEqual([
    { phase: "preview", value: 90 },
    { phase: "cancel" },
  ]);
  expect(screen.getByRole("textbox", { name: "Width" })).toHaveProperty(
    "value",
    "40",
  );
  outer.disabled = false;
  const scale = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Scale",
  });
  act(() => scale.focus());
  fireEvent.input(scale, { target: { value: "2" } });
  await act(async () => {
    outer.disabled = true;
  });
  expect(scale.value).toBe("2");
  expect(editLegend).toHaveBeenCalledTimes(1);
});

it("clamps a locked resize against both axes without discarding unrelated properties", () => {
  const initial = {
    id: "nav",
    width: 60,
    height: 30,
    aspectRatio: 2,
    padding: 8,
  };
  const limits = { min: 20, max: 100 };
  expect(resizeLayout(initial, { axis: "width", value: 26 }, limits)).toEqual({
    ...initial,
    width: 40,
    height: 20,
  });
  expect(resizeLayout(initial, { axis: "height", value: 80 }, limits)).toEqual({
    ...initial,
    width: 100,
    height: 50,
  });
  expect(
    resizeLayout(
      { ...initial, aspectRatio: null },
      { axis: "height", value: 80 },
      limits,
    ),
  ).toEqual({ ...initial, aspectRatio: null, height: 80 });
});

it("only offers a new ratio lock when both axes can fit the configured limits", () => {
  const props = {
    width: 401,
    height: 100,
    locked: false,
    limits: { min: 25, max: 100 },
    onLockChange: vi.fn(),
    onEdit: vi.fn(),
  };
  const view = render(<LayoutDimensions {...props} />);
  const lock = screen.getByRole("button", { name: "Lock aspect ratio" });
  fireEvent.click(lock);
  expect(props.onLockChange).not.toHaveBeenCalled();
  view.rerender(<LayoutDimensions {...props} width={400} />);
  fireEvent.click(lock);
  expect(props.onLockChange.mock.lastCall?.[0]).toBe(true);
  view.rerender(<LayoutDimensions {...props} locked />);
  fireEvent.click(lock);
  expect(props.onLockChange.mock.lastCall?.[0]).toBe(false);
});

it("keeps locked dimensions finite at the representable limits of a tall frame", () => {
  const frame = {
    width: Number.MIN_VALUE,
    height: 1,
    aspectRatio: Number.MIN_VALUE,
  };
  expect(resizeLayout(frame, { axis: "height", value: 2 })).toEqual({
    ...frame,
    width: 2 * Number.MIN_VALUE,
    height: 2,
  });
});

it("accepts the exact limit ratio from either resize handle", () => {
  const frame = { width: 9, height: 7, aspectRatio: 9 / 7 };
  for (const axis of ["width", "height"] as const) {
    expect(resizeLayout(frame, { axis, value: 8 }, { min: 7, max: 9 })).toBe(
      frame,
    );
  }
});

it("preserves the property draft when its host consumes Enter or Escape", () => {
  const onEdit = vi.fn();
  render(
    <div onKeyDownCapture={(event) => event.preventDefault()}>
      <PropertyNumber label="Width" value={40} onEdit={onEdit} />
    </div>,
  );
  const input = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Width",
  });
  act(() => input.focus());
  fireEvent.input(input, { target: { value: "91" } });
  for (const key of ["Enter", "Escape"]) {
    fireEvent.keyDown(input, { key });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("91");
  }
  expect(onEdit.mock.calls).toEqual([[{ phase: "preview", value: 91 }]]);
});
