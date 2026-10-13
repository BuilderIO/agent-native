// @vitest-environment happy-dom

/**
 * The inspector's Fill field reads a paint in its own notation: `171717 100%`,
 * a token chip, `P3 0.09 0.09 0.09`, `OKLCH 72.4 0.181 153`, `Linear`, `Image`,
 * a shader's name. Only hex is uppercased, and P3 and OKLCH show the opacity
 * only when it is not 100. Typing into the field commits with Enter, cancels
 * with Escape, and writes the notation back.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { DesignColorTokens } from "./color-picker-tokens";
import { DesignColorPicker, type DesignPaintType } from "./DesignColorPicker";

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

const TOKENS: DesignColorTokens = {
  status: "ready",
  tokens: [{ name: "Link", cssVar: "--link", value: "#0a6bd6" }],
};

function mount(
  props: Partial<React.ComponentProps<typeof DesignColorPicker>> & {
    value: string;
  },
) {
  const onChange = vi.fn();
  const onChangeComplete = vi.fn();
  const onOpacityChange = vi.fn();
  act(() =>
    root.render(
      <TooltipProvider>
        <DesignColorPicker
          onChange={onChange}
          onChangeComplete={onChangeComplete}
          onOpacityChange={onOpacityChange}
          {...props}
        />
      </TooltipProvider>,
    ),
  );
  return { onChange, onChangeComplete, onOpacityChange };
}

const field = () =>
  container.querySelector<HTMLElement>('[class*="rounded-md border"]')!;
const text = () => field().textContent;
const colorInput = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Color"]');
const opacityInput = () =>
  container.querySelector<HTMLInputElement>(
    'input[aria-label="Paint opacity"]',
  );

function type(input: HTMLInputElement, value: string, key = "Enter") {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("a solid hex fill", () => {
  it("reads in capitals with its opacity: 171717 100%", () => {
    mount({ value: "#171717" });
    expect(colorInput()!.value).toBe("171717");
    expect(opacityInput()!.value).toBe("100");
    expect(text()).toContain("%");
    expect(colorInput()!.className).toContain("uppercase");
  });

  it("reads an sRGB fill authored as rgb() as hex", () => {
    mount({
      value: "rgb(23, 23, 23)",
      authoredValue: "rgb(23, 23, 23)",
    });
    expect(colorInput()!.value).toBe("171717");
  });

  it("commits typed hex with Enter, keeping the opacity", () => {
    const { onChangeComplete } = mount({ value: "rgba(23, 23, 23, 0.5)" });
    expect(opacityInput()!.value).toBe("50");
    type(colorInput()!, "0A6BD6");
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
    expect(onChangeComplete).toHaveBeenCalledWith("rgba(10, 107, 214, 0.5)");
  });

  it("puts the reading back on Escape and writes nothing", () => {
    const { onChange, onChangeComplete } = mount({ value: "#171717" });
    type(colorInput()!, "FF0000", "Escape");
    expect(colorInput()!.value).toBe("171717");
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeComplete).not.toHaveBeenCalled();
  });

  it("drops text that is not a color instead of writing it", () => {
    const { onChange, onChangeComplete } = mount({ value: "#171717" });
    type(colorInput()!, "not a color");
    expect(colorInput()!.value).toBe("171717");
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeComplete).not.toHaveBeenCalled();
  });

  it("accepts the other notations typed into it, and writes them as typed", () => {
    const { onChangeComplete } = mount({ value: "#171717" });
    type(colorInput()!, "P3 0.09 0.09 0.09");
    expect(onChangeComplete).toHaveBeenLastCalledWith(
      "color(display-p3 0.09 0.09 0.09)",
    );
  });

  it("changes the opacity from its own field", () => {
    const { onChangeComplete, onOpacityChange } = mount({ value: "#171717" });
    type(opacityInput()!, "40");
    expect(onOpacityChange).toHaveBeenCalledWith(40);
    expect(onChangeComplete).toHaveBeenLastCalledWith("rgba(23, 23, 23, 0.4)");
  });
});

describe("a Display P3 or OKLCH fill", () => {
  it("reads P3 as its numbers behind a muted name, and leaves out 100%", () => {
    mount({ value: "color(display-p3 0.09 0.09 0.09)" });
    const button = container.querySelector<HTMLElement>(
      'button[aria-label="Color"]',
    )!;
    expect(button.textContent).toBe("P3 0.09 0.09 0.09");
    expect(button.querySelector(".text-muted-foreground")?.textContent).toBe(
      "P3",
    );
    expect(opacityInput()).toBeNull();
    expect(text()).not.toContain("%");
  });

  it("reads OKLCH the same way, with the lightness as a percent number", () => {
    mount({ value: "oklch(72.4% 0.181 153)" });
    expect(
      container.querySelector<HTMLElement>('button[aria-label="Color"]')!
        .textContent,
    ).toBe("OKLCH 72.4 0.181 153");
  });

  it("shows the opacity once it is not 100", () => {
    mount({ value: "color(display-p3 0.09 0.09 0.09 / 0.5)" });
    expect(opacityInput()!.value).toBe("50");
  });

  it("opens as one line of text to edit, and commits what is typed as that notation", () => {
    const { onChangeComplete } = mount({
      value: "oklch(72.4% 0.181 153)",
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Color"]')!
        .click(),
    );
    expect(colorInput()!.value).toBe("OKLCH 72.4 0.181 153");
    expect(document.activeElement).toBe(colorInput());
    type(colorInput()!, "OKLCH 50 0.1 20");
    expect(onChangeComplete).toHaveBeenCalledWith("oklch(50% 0.1 20)");
  });
});

describe("other CSS colors", () => {
  it("read as written, keeping their case", () => {
    mount({ value: "rgb(102, 51, 153)", authoredValue: "rebeccapurple" });
    expect(colorInput()!.value).toBe("rebeccapurple");
    expect(colorInput()!.className).not.toContain("uppercase");
  });

  it("are written back as typed", () => {
    const { onChangeComplete } = mount({
      value: "rgb(102, 51, 153)",
      authoredValue: "rebeccapurple",
    });
    type(colorInput()!, "hsl(210, 50%, 40%)");
    expect(onChangeComplete).toHaveBeenCalledWith("hsl(210, 50%, 40%)");
  });
});

describe("a fill bound to a token", () => {
  it("shows the token's chip, its resolved color on the swatch, and the opacity", () => {
    mount({
      value: "#0a6bd6",
      boundToken: "--link",
      tokens: TOKENS,
      onPickToken: vi.fn(),
    });
    expect(text()).toBe("Link100%");
    expect(colorInput()).toBeNull();
    const swatch = container.querySelector<HTMLElement>("span.size-3\\.5")!;
    expect(swatch.style.backgroundColor).toBe("#0a6bd6");
  });

  it("names the property until the token list has loaded", () => {
    mount({
      value: "#0a6bd6",
      boundToken: "--link",
      tokens: { status: "loading" },
      onPickToken: vi.fn(),
    });
    expect(text()).toBe("--link100%");
  });

  it("asks for the token list even while closed, to name the token", () => {
    const onRequestTokens = vi.fn();
    mount({
      value: "#0a6bd6",
      boundToken: "--link",
      onRequestTokens,
    });
    expect(onRequestTokens).toHaveBeenCalled();
  });
});

describe("a paint that is not a color", () => {
  const paint = (type: DesignPaintType, extra: object = {}) =>
    mount({
      value:
        type === "image"
          ? 'url("https://example.test/a.png")'
          : "linear-gradient(90deg, #171717 0%, #0a6bd6 100%)",
      paintType: type,
      ...extra,
    });

  it.each([
    ["linear", "Linear"],
    ["radial", "Radial"],
    ["angular", "Angular"],
    ["diamond", "Diamond"],
    ["image", "Image"],
  ] as const)("%s names itself %s, with its opacity", (type, name) => {
    paint(type);
    expect(text()).toBe(`${name}100%`);
    expect(colorInput()).toBeNull();
  });

  it("names a shader after the shader on the element", () => {
    mount({
      value: "#ff9a9e",
      paintType: "shader",
      glslShaderContext: { designId: "d1" },
      paintLabel: "Mesh Gradient",
    });
    expect(text()).toBe("Mesh Gradient100%");
  });

  it("has no field to type into: the whole row opens the picker", () => {
    paint("linear");
    expect(
      container.querySelector('button[aria-label="Open color picker"]'),
    ).not.toBeNull();
  });
});

describe("the chevron", () => {
  it("opens the picker like the swatch does", () => {
    const onOpenChange = vi.fn();
    mount({ value: "#171717", onOpenChange });
    const chevron = container.querySelector<HTMLButtonElement>(
      'button[aria-hidden="true"]',
    )!;
    act(() => chevron.click());
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
