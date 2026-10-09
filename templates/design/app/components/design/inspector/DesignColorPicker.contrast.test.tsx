// @vitest-environment happy-dom

import { parseCssColor } from "@shared/color-utils";
import type { TextBackground } from "@shared/text-background";
import { contrastRatio, formatContrastRatio } from "@shared/wcag-contrast";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";
import type {
  ContrastAgentRequest,
  DesignColorContrast,
} from "./color-picker-contrast";
import { DesignColorPicker } from "./DesignColorPicker";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, string>) => {
    const found = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enUS,
      );
    if (typeof found !== "string") throw new Error(`Missing i18n key ${key}`);
    return found.replace(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? "");
  },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const WHITE: TextBackground = {
  kind: "ready",
  color: { r: 255, g: 255, b: 255 },
};

interface Mounted {
  onChangeComplete: Mock<(value: string) => void>;
  onOpenChange: Mock<(open: boolean) => void>;
  readBackground: Mock<() => Promise<TextBackground>>;
  onAskAgent: Mock<(request: ContrastAgentRequest) => void>;
}

async function mount({
  value = "#9e9e9e",
  large = false as boolean | null,
  background = WHITE as TextBackground | Error,
  paintType,
}: {
  value?: string;
  large?: boolean | null;
  background?: TextBackground | Error;
  paintType?: "solid" | "linear";
} = {}): Promise<Mounted> {
  const spies: Mounted = {
    onChangeComplete: vi.fn<(value: string) => void>(),
    onOpenChange: vi.fn<(open: boolean) => void>(),
    readBackground: vi.fn<() => Promise<TextBackground>>(() =>
      background instanceof Error
        ? Promise.reject(background)
        : Promise.resolve(background),
    ),
    onAskAgent: vi.fn<(request: ContrastAgentRequest) => void>(),
  };
  const contrast: DesignColorContrast = {
    large,
    readBackground: spies.readBackground,
    onAskAgent: spies.onAskAgent,
  };
  function Harness() {
    const [current, setCurrent] = useState(value);
    return (
      <TooltipProvider>
        <DesignColorPicker
          value={current}
          open
          onOpenChange={spies.onOpenChange}
          trigger={<button type="button">Open picker</button>}
          paintType={paintType}
          contrast={contrast}
          onChange={setCurrent}
          onChangeComplete={(next) => {
            spies.onChangeComplete(next);
            setCurrent(next);
          }}
        />
      </TooltipProvider>
    );
  }
  await act(async () => root.render(<Harness />));
  return spies;
}

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  )!;
const toggle = () =>
  popover().querySelector<HTMLButtonElement>('button[aria-label="Contrast"]');
const chip = () =>
  popover().querySelector<HTMLButtonElement>(
    'button[aria-label^="Contrast ratio"], button[aria-label="Contrast"][aria-haspopup="menu"]',
  );
const overlayLine = () =>
  popover().querySelector('svg[aria-hidden="true"] path[stroke="white"]');

async function turnOn() {
  await act(async () => toggle()!.click());
}

async function openChipMenu() {
  const trigger = chip()!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

const menuItem = (menu: HTMLElement, label: string) =>
  Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent?.startsWith(label),
  )!;

const ratioOf = (hex: string) => {
  const color = parseCssColor(hex)!;
  return contrastRatio(color, { r: 255, g: 255, b: 255 });
};

describe("Contrast toggle", () => {
  it("is in the paint row for a text fill's solid paint and starts off", async () => {
    const mounted = await mount();
    expect(toggle()).not.toBeNull();
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    expect(chip()).toBeNull();
    expect(overlayLine()).toBeNull();
    expect(mounted.readBackground).not.toHaveBeenCalled();
  });

  it("is not offered for a gradient, which has no single ratio", async () => {
    await mount({
      value: "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
      paintType: "linear",
    });
    expect(toggle()).toBeNull();
  });

  it("reads the background once, when turned on, and not again as the color changes", async () => {
    const mounted = await mount();
    await turnOn();
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(mounted.readBackground).toHaveBeenCalledTimes(1);

    const hex = popover().querySelector<HTMLInputElement>(
      'input[aria-label="Hex"]',
    )!;
    await act(async () => {
      hex.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(hex, "888888");
      hex.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      hex.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(mounted.readBackground).toHaveBeenCalledTimes(1);
  });
});

describe("the ratio chip", () => {
  it("shows the ratio against the background and the level it misses", async () => {
    await mount({ value: "#9e9e9e" });
    await turnOn();
    const expected = formatContrastRatio(ratioOf("#9e9e9e"));
    expect(chip()!.textContent).toBe(`${expected} : 1`);
    expect(chip()!.getAttribute("aria-label")).toBe(
      `Contrast ratio ${expected} to 1`,
    );
    const level = popover().querySelector<HTMLElement>("span.text-amber-600")!;
    expect(level.textContent).toBe("AA");
    expect(level.title).toBe("Needs 4.5:1");
  });

  it("fails #777777 on white, which is 4.47:1 cut, not 4.48 rounded", async () => {
    await mount({ value: "#777777" });
    await turnOn();
    expect(chip()!.textContent).toBe("4.47 : 1");
    expect(popover().querySelector("span.text-amber-600")).not.toBeNull();
    expect(popover().querySelector("span.text-emerald-600")).toBeNull();
  });

  it("passes #767676 on white", async () => {
    await mount({ value: "#767676" });
    await turnOn();
    expect(chip()!.textContent).toBe("4.54 : 1");
    const level = popover().querySelector<HTMLElement>(
      "span.text-emerald-600",
    )!;
    expect(level.textContent).toBe("AA");
    expect(level.title).toBe("Meets AA");
  });

  it("reaches AAA for black on white", async () => {
    await mount({ value: "#000000" });
    await turnOn();
    expect(chip()!.textContent).toBe("21.00 : 1");
    expect(
      popover().querySelector<HTMLElement>("span.text-emerald-600")!
        .textContent,
    ).toBe("AAA");
  });

  it("uses the large-text bar for large text", async () => {
    await mount({ value: "#777777", large: true });
    await turnOn();
    expect(popover().querySelector("span.text-emerald-600")!.textContent).toBe(
      "AA",
    );
  });

  it("draws the line where the target is met over the square", async () => {
    await mount();
    await turnOn();
    expect(overlayLine()).not.toBeNull();
    expect(overlayLine()!.getAttribute("d")).toMatch(/^M /);
  });

  it("names the pair on its tooltip", async () => {
    await mount({ value: "#9e9e9e" });
    await turnOn();
    expect(chip()!.title).toBe("Text #9e9e9e on #FFFFFF");
  });
});

describe("the chip menu", () => {
  it("offers each fix with the ratio it needs, and Ask Agent below a divider", async () => {
    await mount({ value: "#9e9e9e" });
    await turnOn();
    const menu = await openChipMenu();
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent);
    expect(items).toEqual([
      "Fix for AANeeds 4.5:1",
      "Fix for AAANeeds 7:1",
      "Ask Agent to fix contrast",
    ]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it("needs 3:1 and 4.5:1 for large text", async () => {
    await mount({ value: "#cccccc", large: true });
    await turnOn();
    const menu = await openChipMenu();
    expect(menuItem(menu, "Fix for AA").textContent).toBe(
      "Fix for AANeeds 3:1",
    );
    expect(menuItem(menu, "Fix for AAA").textContent).toBe(
      "Fix for AAANeeds 4.5:1",
    );
  });

  it("turns a fix off once its level is met", async () => {
    await mount({ value: "#767676" });
    await turnOn();
    const menu = await openChipMenu();
    const aa = menuItem(menu, "Fix for AA");
    expect(aa.textContent).toBe("Fix for AAPasses");
    expect(aa.getAttribute("aria-disabled")).toBe("true");
    const aaa = menuItem(menu, "Fix for AAA");
    expect(aaa.getAttribute("aria-disabled")).toBeNull();
    expect(aaa.textContent).toBe("Fix for AAANeeds 7:1");
  });

  it("fixes for AA by moving lightness, committing a color that passes", async () => {
    const mounted = await mount({ value: "#9e9e9e" });
    await turnOn();
    const menu = await openChipMenu();
    await act(async () => menuItem(menu, "Fix for AA").click());

    expect(mounted.onChangeComplete).toHaveBeenCalledTimes(1);
    const fixed = mounted.onChangeComplete.mock.calls[0]![0];
    const ratio = ratioOf(fixed);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // The nearest passing lightness, not black.
    expect(ratio).toBeLessThan(4.7);
    // Still a gray: lightness moved, hue and chroma did not.
    const color = parseCssColor(fixed)!;
    expect(Math.abs(color.r - color.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(color.g - color.b)).toBeLessThanOrEqual(1);
    expect(color.r).toBeLessThan(0x9e);

    // The chip follows the new color.
    expect(chip()!.textContent).toBe(`${formatContrastRatio(ratio)} : 1`);
    expect(popover().querySelector("span.text-emerald-600")).not.toBeNull();
  });

  it("fixes for AAA", async () => {
    const mounted = await mount({ value: "#767676" });
    await turnOn();
    const menu = await openChipMenu();
    await act(async () => menuItem(menu, "Fix for AAA").click());
    expect(
      ratioOf(mounted.onChangeComplete.mock.calls[0]![0]),
    ).toBeGreaterThanOrEqual(7);
  });

  it("keeps the hue of a colored text when it fixes", async () => {
    const mounted = await mount({ value: "#e07a5f" });
    await turnOn();
    const menu = await openChipMenu();
    await act(async () => menuItem(menu, "Fix for AA").click());
    const fixed = parseCssColor(mounted.onChangeComplete.mock.calls[0]![0])!;
    // Still a warm red-orange: red leads, blue trails.
    expect(fixed.r).toBeGreaterThan(fixed.g);
    expect(fixed.g).toBeGreaterThan(fixed.b);
    expect(
      ratioOf(mounted.onChangeComplete.mock.calls[0]![0]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("says a level cannot be reached, and turns it off, when nothing reaches it", async () => {
    // Gray text half-transparent: no lightness at this opacity reaches 7:1.
    await mount({ value: "rgba(119, 119, 119, 0.5)" });
    await turnOn();
    const menu = await openChipMenu();
    const aaa = menuItem(menu, "Fix for AAA");
    expect(aaa.textContent).toBe("Fix for AAACan't reach");
    expect(aaa.getAttribute("aria-disabled")).toBe("true");
  });

  it("hands the pairing to the agent and closes the picker", async () => {
    const mounted = await mount({ value: "#9e9e9e" });
    await turnOn();
    const menu = await openChipMenu();
    await act(async () => menuItem(menu, "Ask Agent to fix contrast").click());
    expect(mounted.onAskAgent).toHaveBeenCalledTimes(1);
    const request = mounted.onAskAgent.mock.calls[0]![0];
    expect(request).toMatchObject({
      targetRatio: 4.5,
      large: false,
      background: "#FFFFFF",
      foreground: "#9e9e9e",
    });
    expect(request.ratio).toBeCloseTo(ratioOf("#9e9e9e"), 6);
    expect(mounted.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(mounted.onChangeComplete).not.toHaveBeenCalled();
  });
});

describe("when there is no background to measure against", () => {
  const unavailable = (reason: string) =>
    ({ kind: "unavailable", reason }) as TextBackground;

  async function expectUnavailable(title: string) {
    expect(chip()!.textContent).toBe("Contrast unavailable");
    expect(chip()!.title).toBe(title);
    expect(popover().textContent).not.toMatch(/\d : 1/);
    expect(overlayLine()).toBeNull();
    expect(popover().querySelector("span.text-amber-600")).toBeNull();
    expect(popover().querySelector("span.text-emerald-600")).toBeNull();
  }

  it.each([
    ["no-opaque-background", "No solid background found behind this text"],
    ["image", "A gradient or image sits behind this text"],
    ["blending", "Opacity or blending changes what is behind this text"],
    ["unreadable-color", "The background color can't be read"],
    ["no-screen", "The screen behind this text can't be read"],
  ])("says so for %s, with a ratio of none", async (reason, title) => {
    await mount({ background: unavailable(reason) });
    await turnOn();
    await expectUnavailable(title);
  });

  it("says so when the read fails, never as a ratio", async () => {
    await mount({ background: new Error("bridge went away") });
    await turnOn();
    await expectUnavailable("The screen behind this text can't be read");
  });

  it("says so when the text size cannot be read", async () => {
    await mount({ large: null });
    await turnOn();
    await expectUnavailable("The text size can't be read");
  });

  it("still offers the agent, and no fixes", async () => {
    const mounted = await mount({ background: unavailable("image") });
    await turnOn();
    const menu = await openChipMenu();
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent);
    expect(items).toEqual(["Ask Agent to fix contrast"]);
    await act(async () => menuItem(menu, "Ask Agent").click());
    expect(mounted.onAskAgent.mock.calls[0]![0]).toMatchObject({
      ratio: null,
      background: null,
      targetRatio: 4.5,
    });
  });

  it("shows a placeholder, not a ratio, while the background is read", async () => {
    let release: (background: TextBackground) => void = () => {};
    const pending = new Promise<TextBackground>((resolve) => {
      release = resolve;
    });
    const spies: Mounted = await mount({ background: WHITE });
    spies.readBackground.mockReturnValueOnce(pending);
    await turnOn();
    expect(chip()!.textContent).toBe("");
    expect(popover().textContent).not.toMatch(/\d : 1/);
    await act(async () => release(WHITE));
    expect(chip()!.textContent).toMatch(/ : 1$/);
  });
});
