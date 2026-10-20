// @vitest-environment happy-dom

// Radix handles Escape before canvas hotkeys, so closing the picker must
// preserve both committed paint changes and the canvas selection.

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDesignHotkeys } from "@/hooks/useDesignHotkeys";

import {
  parseGradientLayer,
  splitCssLayers,
} from "../edit-panel/fill-gradient-helpers";
import { ColorInput } from "../edit-panel/panel-primitives";
import { DesignColorPicker } from "./DesignColorPicker";

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

function Harness({
  onPopoverEscape,
  onCanvasEscapeHotkey,
}: {
  onPopoverEscape: () => void;
  onCanvasEscapeHotkey: () => void;
}) {
  useDesignHotkeys({ onEscape: onCanvasEscapeHotkey });

  return (
    <Popover open onOpenChange={() => undefined}>
      <PopoverTrigger asChild>
        <button type="button">trigger</button>
      </PopoverTrigger>
      {/* portalled=false keeps this inline for the test; DesignColorPicker's
          real PopoverContent (portalled, default true) still binds Radix's
          document-level capture listener the same way regardless of portal
          placement — portalling only changes where the DOM node lives, not
          which document/capture phase the DismissableLayer effect uses. */}
      <PopoverContent portalled={false} onEscapeKeyDown={onPopoverEscape}>
        {/* A plain button — not input/textarea/select/contenteditable/
            role=textbox — matching the SV field / ColorTrack slider /
            gradient stop buttons the review named as targets that
            useDesignHotkeys' editable-target guard would NOT skip. */}
        <button type="button" data-testid="inner-target">
          inner
        </button>
      </PopoverContent>
    </Popover>
  );
}

describe("Escape ordering — DesignColorPicker popover vs canvas hotkeys", () => {
  it("closes the picker without reverting a committed hex edit or clearing selection", async () => {
    const onCanvasEscape = vi.fn();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    function PickerHarness() {
      const [value, setValue] = useState("#ffffff");
      useDesignHotkeys({ onEscape: onCanvasEscape });
      return (
        <TooltipProvider>
          <DesignColorPicker
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            onChangeComplete={(next) => {
              onCommit(next);
              setValue(next);
            }}
          />
        </TooltipProvider>
      );
    }
    await act(() => root.render(<PickerHarness />));
    await act(() =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Hex"]',
    )!;
    expect(input).not.toBeNull();
    await act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "DEDCF9");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Color"]')!
        .value,
    ).toBe("DEDCF9");
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#dedcf9");
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.querySelector('input[aria-label="Hex"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Color"]')!
        .value,
    ).toBe("DEDCF9");
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCanvasEscape).not.toHaveBeenCalled();

    await act(() =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const draft = document.querySelector<HTMLInputElement>(
      'input[aria-label="Hex"]',
    )!;
    await act(() => {
      draft.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(draft, "FF0000");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      draft.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Color"]')!
        .value,
    ).toBe("DEDCF9");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCanvasEscape).not.toHaveBeenCalled();
  });

  it("an Escape keydown on a non-editable popover-content target fires the popover's onEscapeKeyDown but never reaches useDesignHotkeys' onEscape", () => {
    const onPopoverEscape = vi.fn();
    const onCanvasEscapeHotkey = vi.fn();

    act(() => {
      root.render(
        <Harness
          onPopoverEscape={onPopoverEscape}
          onCanvasEscapeHotkey={onCanvasEscapeHotkey}
        />,
      );
    });

    const inner = container.querySelector<HTMLButtonElement>(
      '[data-testid="inner-target"]',
    );
    expect(inner).not.toBeNull();

    act(() => {
      inner!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onPopoverEscape).toHaveBeenCalledTimes(1);
    expect(onCanvasEscapeHotkey).not.toHaveBeenCalled();
  });

  it("a bare Escape keydown with no open popover DOES reach useDesignHotkeys' onEscape (control case — proves the hook itself is wired and working)", () => {
    const onCanvasEscapeHotkey = vi.fn();

    function ControlHarness() {
      useDesignHotkeys({ onEscape: onCanvasEscapeHotkey });
      return (
        <button type="button" data-testid="plain-target">
          plain
        </button>
      );
    }

    act(() => {
      root.render(<ControlHarness />);
    });

    const target = container.querySelector<HTMLButtonElement>(
      '[data-testid="plain-target"]',
    );
    act(() => {
      target!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onCanvasEscapeHotkey).toHaveBeenCalledTimes(1);
  });
});

describe("DesignColorPicker Hex commit callbacks", () => {
  /** Types a hex into the Hex field, or into the nth gradient stop's own field. */
  async function enterHex(hex: string, stopIndex?: number) {
    await act(() =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const input =
      stopIndex === undefined
        ? document.querySelector<HTMLInputElement>('input[aria-label="Hex"]')!
        : document.querySelectorAll<HTMLInputElement>(
            'input[aria-label="Stop color"]',
          )[stopIndex]!;
    await act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, hex);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }

  it("uses the authoritative completion callback without sending a preview", async () => {
    const onChange = vi.fn();
    const onChangeComplete = vi.fn();

    await act(() =>
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value="#ffffff"
            onChange={onChange}
            onChangeComplete={onChangeComplete}
          />
        </TooltipProvider>,
      ),
    );
    await enterHex("EC4899");

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
    expect(onChangeComplete).toHaveBeenCalledWith("#ec4899");
  });

  it("falls back to onPaintValueChange for a gradient Hex commit", async () => {
    const onChange = vi.fn();
    const onPaintValueChange = vi.fn();

    await act(() =>
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value="linear-gradient(90deg, #000000 0%, #ffffff 100%)"
            paintType="linear"
            onChange={onChange}
            onPaintValueChange={onPaintValueChange}
          />
        </TooltipProvider>,
      ),
    );
    await enterHex("EC4899", 0);

    expect(onPaintValueChange).toHaveBeenCalledTimes(1);
    expect(onPaintValueChange.mock.calls[0]?.[0]).toMatch(/#ec4899/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("routes a gradient Hex commit through the paint callback when provided", async () => {
    const onChange = vi.fn();
    const onPaintValueChange = vi.fn();
    const onChangeComplete = vi.fn();

    await act(() =>
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value="linear-gradient(90deg, #000000 0%, #ffffff 100%)"
            paintType="linear"
            onChange={onChange}
            onPaintValueChange={onPaintValueChange}
            onChangeComplete={onChangeComplete}
          />
        </TooltipProvider>,
      ),
    );
    await enterHex("EC4899", 0);

    expect(onPaintValueChange).toHaveBeenCalledTimes(1);
    expect(onPaintValueChange.mock.calls[0]?.[0]).toMatch(/#ec4899/i);
    expect(onChangeComplete).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  async function enterStopHex(hex: string, stopIndex: number) {
    const input = document.querySelectorAll<HTMLInputElement>(
      'input[aria-label="Stop color"]',
    )[stopIndex]!;
    await act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, hex);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }

  it("commits a layered gradient Hex edit without touching sibling paints or the solid callback", async () => {
    const firstSibling = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const secondSibling =
      "radial-gradient(circle at center, #00ff00 0%, #ff00ff 100%)";
    const onChange = vi.fn();
    const onBackgroundImageChange = vi.fn();

    function LayeredColorInput() {
      const [backgroundImage, setBackgroundImage] = useState(
        `${firstSibling}, ${secondSibling}`,
      );
      return (
        <TooltipProvider>
          <ColorInput
            label="Fill"
            value="#123456"
            onChange={onChange}
            open
            supportsLayeredFills
            backgroundImage={backgroundImage}
            onBackgroundImageChange={(next) => {
              onBackgroundImageChange(next);
              setBackgroundImage(next);
            }}
          />
        </TooltipProvider>
      );
    }

    await act(() => root.render(<LayeredColorInput />));
    await act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Gradient"]')!
        .click(),
    );
    onChange.mockClear();
    onBackgroundImageChange.mockClear();

    await enterStopHex("EC4899", 0);

    expect(onBackgroundImageChange).toHaveBeenCalledTimes(1);
    const layers = splitCssLayers(onBackgroundImageChange.mock.calls[0]![0]);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toBe(firstSibling);
    expect(layers[1]).toBe(secondSibling);
    expect(parseGradientLayer(layers[2])?.stops[0]?.color).toBe("#ec4899");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits one solid value when a native vector gradient has no CSS layer stack", async () => {
    const gradient =
      "linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, #0000ff 100%)";
    const onChange = vi.fn();
    const onBackgroundImageChange = vi.fn();

    await act(() =>
      root.render(
        <TooltipProvider>
          <ColorInput
            label="Fill"
            value={gradient}
            onChange={onChange}
            open
            singlePaint
            onBackgroundImageChange={onBackgroundImageChange}
          />
        </TooltipProvider>,
      ),
    );

    await act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Solid"]')!
        .click(),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe("rgba(255, 0, 0, 0.5)");
    expect(onChange.mock.calls[0]?.[1]).toMatchObject({ phase: "commit" });
    expect(onBackgroundImageChange).not.toHaveBeenCalled();
  });

  it("keeps a native vector gradient as the paint source across a solid round trip", async () => {
    const writes: string[] = [];
    function NativeVectorPaint() {
      const [value, setValue] = useState("#ef4444");
      return (
        <TooltipProvider>
          <ColorInput
            label="Fill"
            value={value}
            open
            singlePaint
            supportedPaintTypes={["solid", "linear", "radial"]}
            onChange={(next) => {
              writes.push(next);
              setValue(next);
            }}
            onSolidToGradientChange={(patch) => {
              writes.push(patch.backgroundImage);
              setValue(patch.backgroundImage);
            }}
          />
        </TooltipProvider>
      );
    }

    await act(() => root.render(<NativeVectorPaint />));
    await act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Gradient"]')!
        .click(),
    );
    expect(writes[0]).toMatch(/^linear-gradient\(/);
    expect(document.querySelector('[aria-label="Solid"]')).not.toBeNull();

    await act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Solid"]')!
        .click(),
    );

    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe("#ef4444");
    expect(writes[1]).not.toBe("#000000");
  });

  it("edits only the stop whose own field was typed in", async () => {
    const onPaintValueChange = vi.fn();

    await act(() =>
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value="linear-gradient(90deg, #000000 0%, #ffffff 100%)"
            paintType="linear"
            onChange={vi.fn()}
            onPaintValueChange={onPaintValueChange}
          />
        </TooltipProvider>,
      ),
    );
    await enterHex("00FF00", 1);

    expect(onPaintValueChange).toHaveBeenCalledTimes(1);
    const gradient = parseGradientLayer(onPaintValueChange.mock.calls[0]![0]);
    expect(gradient?.stops[0]?.color).toBe("#000000");
    expect(gradient?.stops[1]?.color).toBe("#00ff00");
  });

  it("falls back to onChange for a solid Hex commit without a completion callback", async () => {
    const onChange = vi.fn();

    await act(() =>
      root.render(
        <TooltipProvider>
          <DesignColorPicker value="#ffffff" onChange={onChange} />
        </TooltipProvider>,
      ),
    );
    await enterHex("EC4899");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("#ec4899");
  });
});

describe("Escape ordering for a color outside sRGB", () => {
  function setInput(input: HTMLInputElement, text: string) {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const press = (target: Element, key: string) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );

  async function renderWide() {
    const onCanvasEscape = vi.fn();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    function PickerHarness() {
      const [value, setValue] = useState("oklch(70% 0.3 150)");
      useDesignHotkeys({ onEscape: onCanvasEscape });
      return (
        <TooltipProvider>
          <DesignColorPicker
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            onChangeComplete={(next) => {
              onCommit(next);
              setValue(next);
            }}
          />
        </TooltipProvider>
      );
    }
    await act(() => root.render(<PickerHarness />));
    await act(() =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    return { onCanvasEscape, onChange, onCommit };
  }

  it("opens the wide mode and keeps a committed OKLCH edit when Escape closes it", async () => {
    const { onCanvasEscape, onChange, onCommit } = await renderWide();
    const lightness = document.querySelector<HTMLInputElement>(
      'input[aria-label="L"]',
    )!;
    expect(lightness.value).toBe("70");
    await act(() => {
      lightness.focus();
      setInput(lightness, "80");
    });
    await act(() => press(lightness, "Enter"));
    expect(onChange).toHaveBeenLastCalledWith("oklch(80% 0.3 150)");
    expect(onCommit).toHaveBeenLastCalledWith("oklch(80% 0.3 150)");

    await act(() => press(lightness, "Escape"));
    expect(document.querySelector('input[aria-label="L"]')).toBeNull();
    expect(
      container.querySelector<HTMLElement>('[aria-label="Color"]')!.textContent,
    ).toBe("OKLCH 80 0.3 150");
    expect(onCanvasEscape).not.toHaveBeenCalled();
  });

  it("drops an uncommitted OKLCH draft on Escape and writes nothing", async () => {
    const { onCanvasEscape, onChange, onCommit } = await renderWide();
    const chroma = document.querySelector<HTMLInputElement>(
      'input[aria-label="C"]',
    )!;
    await act(() => {
      chroma.focus();
      setInput(chroma, "0.1");
    });
    await act(() => press(chroma, "Escape"));
    expect(document.querySelector('input[aria-label="C"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLElement>('[aria-label="Color"]')!.textContent,
    ).toBe("OKLCH 70 0.3 150");
    expect(onCanvasEscape).not.toHaveBeenCalled();
  });

  it("shows a wide fill in its own notation in the trigger field and does not flatten it on Escape", async () => {
    const { onChange, onCommit } = await renderWide();
    const field = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Color"]',
    )!;
    expect(field.textContent).toBe("OKLCH 70 0.3 150");
    await act(() => field.click());
    const inline = container.querySelector<HTMLInputElement>(
      'input[aria-label="Color"]',
    )!;
    expect(inline.value).toBe("OKLCH 70 0.3 150");
    await act(() => {
      inline.focus();
      setInput(inline, "OKLCH 60 0.2 20");
    });
    await act(() => press(inline, "Escape"));
    expect(container.querySelector('input[aria-label="Color"]')).toBeNull();
    expect(
      container.querySelector<HTMLElement>('[aria-label="Color"]')!.textContent,
    ).toBe("OKLCH 70 0.3 150");
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits what was typed in the field's own notation, as that notation", async () => {
    const { onCommit } = await renderWide();
    await act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Color"]')!
        .click(),
    );
    const inline = container.querySelector<HTMLInputElement>(
      'input[aria-label="Color"]',
    )!;
    await act(() => {
      inline.focus();
      setInput(inline, "OKLCH 60 0.2 20");
    });
    await act(() => press(inline, "Enter"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("oklch(60% 0.2 20)");

    await act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Color"]')!
        .click(),
    );
    const again = container.querySelector<HTMLInputElement>(
      'input[aria-label="Color"]',
    )!;
    await act(() => {
      again.focus();
      setInput(again, "P3 0.1 0.2 0.3");
    });
    await act(() => press(again, "Enter"));
    expect(onCommit).toHaveBeenLastCalledWith("color(display-p3 0.1 0.2 0.3)");
  });
});
