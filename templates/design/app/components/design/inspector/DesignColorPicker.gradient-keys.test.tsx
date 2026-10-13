// @vitest-environment happy-dom

/**
 * Backspace and Delete on a gradient pin, driven the way a browser drives them:
 * the pin is clicked with pointer events, and the key goes to whatever holds
 * focus, not to the pin.
 *
 * The pin's pointerdown is cancelled (it starts a drag), and cancelling
 * pointerdown also cancels the browser's focus change. Nothing focused the pin
 * afterwards, so focus stayed on the popover and Backspace never reached the
 * gradient editor. It went on to the editor's delete hotkey, which listens on
 * `window` and takes the press as aimed at the selected canvas layer.
 *
 * The real `useDesignHotkeys` is mounted here as that hotkey.
 */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { useDesignHotkeys } from "@/hooks/useDesignHotkeys";

import { DesignColorPicker } from "./DesignColorPicker";

const THREE_STOPS =
  "linear-gradient(90deg, #171717 0%, #00ff00 50%, #0a6bd6 100%)";
const TWO_STOPS = "linear-gradient(90deg, #171717 0%, #0a6bd6 100%)";

function Harness({
  initial,
  onDelete,
  paintType = "linear",
}: {
  initial: string;
  onDelete: () => void;
  paintType?: "linear" | "solid";
}) {
  const [value, setValue] = useState(initial);
  // The editor's delete hotkey: a listener on `window`, as in the editor.
  useDesignHotkeys({ onDelete });
  return (
    <DesignColorPicker
      open
      onOpenChange={() => {}}
      value={value}
      paintType={paintType}
      onChange={setValue}
      onPaintValueChange={setValue}
      trigger={<button type="button">Open</button>}
    />
  );
}

let container: HTMLDivElement;
let root: Root;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 24,
      width: 200,
      height: 24,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  )!;
// A pin is labelled `<color> at <position>%`; the paint row's buttons are pressed too.
const pins = () =>
  Array.from(
    popover().querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  ).filter((button) => / at \d+%$/.test(button.getAttribute("aria-label")!));
const pinAt = (label: string) =>
  popover().querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
const stopRows = () => popover().querySelectorAll("[data-stop-row]");

function pointer(type: string, clientX: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    pointerId: 1,
  });
}

/** A click on a pin: pointerdown starts the drag, pointerup ends it. */
function clickPin(pin: HTMLElement) {
  act(() => {
    pin.dispatchEvent(pointer("pointerdown", 100));
    pin.dispatchEvent(pointer("pointerup", 100));
  });
}

/** The key goes to the element that has focus, as it does in a browser. */
function press(key: string) {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function render(
  initial: string,
  onDelete = vi.fn(),
  paintType: "linear" | "solid" = "linear",
) {
  act(() =>
    root.render(
      <Harness initial={initial} onDelete={onDelete} paintType={paintType} />,
    ),
  );
  // Opening the popover puts focus on its content, as onOpenAutoFocus does.
  act(() => popover().focus());
  return onDelete;
}

describe("Backspace and Delete on a gradient pin", () => {
  it("gives a clicked pin the keyboard focus", () => {
    render(THREE_STOPS);
    const middle = pinAt("#00ff00");
    clickPin(middle);
    expect(document.activeElement).toBe(middle);
  });

  it.each(["Backspace", "Delete"])(
    "%s removes the pin that was clicked, and the canvas layer stays",
    (key) => {
      const onDelete = render(THREE_STOPS);
      expect(pins()).toHaveLength(3);

      clickPin(pinAt("#00ff00"));
      const event = press(key);

      expect(pins()).toHaveLength(2);
      expect(pinAt("#00ff00")).toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(onDelete).not.toHaveBeenCalled();
    },
  );

  it("keeps the last two stops: the press does nothing, and still does not delete the layer", () => {
    const onDelete = render(TWO_STOPS);
    clickPin(pinAt("#0a6bd6"));
    press("Backspace");
    expect(pins()).toHaveLength(2);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("removes a pin added by clicking the bar", () => {
    const onDelete = render(TWO_STOPS);
    const bar = popover().querySelector<HTMLElement>(
      '[role="group"][aria-label="Gradient stops"]',
    )!;
    act(() => {
      bar.dispatchEvent(pointer("pointerdown", 100));
      bar.dispatchEvent(pointer("pointerup", 100));
    });
    expect(pins()).toHaveLength(3);

    press("Backspace");
    expect(pins()).toHaveLength(2);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps focus on a pin after one is removed, so the next press cannot reach the canvas", () => {
    const onDelete = render(
      "linear-gradient(90deg, #111111 0%, #222222 33%, #333333 66%, #444444 100%)",
    );
    clickPin(pinAt("#222222"));
    press("Backspace");
    press("Backspace");
    expect(pins()).toHaveLength(2);
    // A third press has no stop left to remove and no layer to delete.
    press("Backspace");
    expect(pins()).toHaveLength(2);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("does nothing from a stop's text field, which edits its own text", () => {
    const onDelete = render(THREE_STOPS);
    const color = stopRows()[1]!.querySelector<HTMLInputElement>(
      'input[aria-label="editPanel.colorPicker.stopColor"]',
    )!;
    act(() => color.focus());

    const event = press("Backspace");

    expect(pins()).toHaveLength(3);
    // The field keeps its default: the browser deletes the character.
    expect(event.defaultPrevented).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("does nothing from the hex field, which edits its own text", () => {
    const onDelete = render("#336699", vi.fn(), "solid");
    const hex = popover().querySelector<HTMLInputElement>(
      'input[aria-label="Hex"]',
    )!;
    act(() => hex.focus());

    const event = press("Backspace");

    expect(event.defaultPrevented).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps Backspace from the popover itself away from the canvas layer", () => {
    const onDelete = render("#336699", vi.fn(), "solid");
    // Nothing inside is focused: the key lands on the popover.
    expect(document.activeElement).toBe(popover());
    press("Backspace");
    press("Delete");
    expect(onDelete).not.toHaveBeenCalled();
  });
});
