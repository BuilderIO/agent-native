// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderScreen(rotation: number) {
  const onScreenGeometryChange = vi.fn();
  act(() =>
    root.render(
      <EditPanel
        selectedElement={null}
        selectedScreenGeometry={{
          id: "screen-1",
          title: "X ad",
          x: 1894,
          y: 10619,
          width: 1200,
          height: 1200,
          rotation,
        }}
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        readOnly={false}
        onScreenGeometryChange={onScreenGeometryChange}
      />,
    ),
  );
  const field = container.querySelector<HTMLInputElement>(
    'input[aria-label="editPanel.labels.rotation"]',
  );
  return { field, onScreenGeometryChange };
}

it("shows a rotated screen's angle with the inspector's counter-clockwise sign", () => {
  const { field } = renderScreen(15);
  expect(field).not.toBeNull();
  expect(field!.value).toMatch(/^-15/);
});

it("resets a rotated screen to 0 from the Rotation field", () => {
  const { field, onScreenGeometryChange } = renderScreen(15);
  act(() => {
    field!.focus();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(field, "0");
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    field!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onScreenGeometryChange).toHaveBeenCalledWith("screen-1", {
    rotation: 0,
  });
});

it("rotates a screen 90° clockwise from the Rotation row", () => {
  const { onScreenGeometryChange } = renderScreen(15);
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="canvasMenu.rotateClockwise"]',
  );
  expect(button).not.toBeNull();
  act(() => button!.click());
  expect(onScreenGeometryChange).toHaveBeenCalledWith("screen-1", {
    rotation: 105,
  });
});
