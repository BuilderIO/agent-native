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
  PaintColorField,
  PaintEditor,
  PaintGradientStops,
  type PaintColor,
  type PaintStop,
} from "./paint-editor.js";

afterEach(cleanup);

it.each([true, false])(
  "discards an unmounted stop editor without rewriting removed stops (cancel handler %s)",
  (withHandler) => {
    const stops: PaintStop[] = [
      { id: "a", offset: 0, color: { value: "transparent" } },
      { id: "b", offset: 100, color: { value: "currentColor" } },
    ];
    const onChange = vi.fn();
    const cancel = vi.fn();
    const editor = render(
      <PaintGradientStops
        stops={stops}
        onChange={onChange}
        onCancelPreview={withHandler ? cancel : undefined}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Stop position" }), {
      target: { value: "30" },
    });
    expect(onChange).toHaveBeenCalledWith(
      [{ ...stops[0], offset: 30 }, stops[1]],
      "preview",
    );
    onChange.mockClear();
    editor.unmount();
    expect(onChange).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(withHandler ? 1 : 0);
  },
);

it("discards a literal draft when the host binds the field to a token", () => {
  const onChange = vi.fn();
  const field = (value: PaintColor) => (
    <PaintColorField value={value} onChange={onChange} />
  );
  const editor = render(field({ value: "red" }));
  const input = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(input, { target: { value: "blue" } });
  editor.rerender(field({ token: "ink", value: "black" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("combobox").textContent).toContain(
    "Unavailable token",
  );
  fireEvent.blur(input);
  editor.rerender(field({ value: "green" }));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("green");
  expect(onChange).not.toHaveBeenCalled();
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "keeps a color draft active during input-method confirmation or cancellation (%o)",
  (composition) => {
    const onChange = vi.fn();
    render(<PaintColorField value={{ value: "red" }} onChange={onChange} />);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    input.focus();
    fireEvent.change(input, { target: { value: "blue" } });
    for (const key of ["Escape", "Enter"]) {
      expect(fireEvent.keyDown(input, { key, ...composition })).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("blue");
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("red");
  },
);

it("closes portaled paint controls and discards a preview when the panel locks", async () => {
  const onValueChange = vi.fn(),
    cancel = vi.fn();
  const { container } = render(
    <fieldset>
      <PaintEditor
        value={[
          {
            id: "ink",
            kind: "solid",
            visible: true,
            opacity: 100,
            color: { value: "red" },
          },
        ]}
        onValueChange={onValueChange}
        onCancelPreview={cancel}
      />
    </fieldset>,
  );
  const fieldset = container.querySelector("fieldset");
  if (!fieldset) throw new Error("Missing fieldset");
  const trigger = screen.getByRole("button", { name: /Edit Solid/i });
  fireEvent.click(trigger);
  const field = await screen.findByRole("textbox", { name: "Opacity" });
  fireEvent.input(field, { target: { value: "50" } });
  expect(onValueChange).toHaveBeenCalledTimes(1);
  await act(async () => {
    fieldset.disabled = true;
    fireEvent.input(field, { target: { value: "20" } });
    fireEvent.blur(field);
  });
  expect(onValueChange).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    fieldset.disabled = false;
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Edit Solid/i }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});
