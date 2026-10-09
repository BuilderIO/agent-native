// @vitest-environment happy-dom

import {
  rgbaToLinearSrgb,
  linearToRgbaGamutMapped,
} from "@shared/color-spaces";
import { parseCssColor, rgbaToHex } from "@shared/color-utils";
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
import { gamutFallbacks, readWideColor } from "./color-picker-model";
import type {
  DesignColorToken,
  DesignColorTokens,
} from "./color-picker-tokens";
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

interface Spies {
  onChange: Mock<(value: string) => void>;
  onChangeComplete: Mock<(value: string) => void>;
  onChangeCancel: Mock<(value: string) => void>;
  onPickToken: Mock<(token: DesignColorToken) => void>;
  setOpen: (open: boolean) => void;
}

/** A parent that owns the value the way the inspector does. */
function mountPicker(initial: {
  value: string;
  boundToken?: string;
  tokens?: DesignColorTokens;
  paintType?: "solid" | "linear";
}): Spies {
  const spies: Spies = {
    onChange: vi.fn<(value: string) => void>(),
    onChangeComplete: vi.fn<(value: string) => void>(),
    onChangeCancel: vi.fn<(value: string) => void>(),
    onPickToken: vi.fn<(token: DesignColorToken) => void>(),
    setOpen: (_open: boolean) => {},
  };
  function Harness() {
    const [value, setValue] = useState(initial.value);
    const [bound, setBound] = useState(initial.boundToken);
    const [open, setOpen] = useState(true);
    spies.setOpen = setOpen;
    return (
      <TooltipProvider>
        <DesignColorPicker
          value={value}
          open={open}
          onOpenChange={setOpen}
          trigger={<button type="button">Open picker</button>}
          tokens={initial.tokens}
          boundToken={bound}
          paintType={initial.paintType}
          onPickToken={(token) => {
            spies.onPickToken(token);
            setBound(token.cssVar);
          }}
          onChange={(next) => {
            spies.onChange(next);
            setValue(next);
            setBound(undefined);
          }}
          onChangeComplete={(next) => {
            spies.onChangeComplete(next);
            setValue(next);
            setBound(undefined);
          }}
          onChangeCancel={spies.onChangeCancel}
        />
      </TooltipProvider>
    );
  }
  act(() => root.render(<Harness />));
  return spies;
}

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  )!;
const newSwatch = () =>
  popover().querySelector<HTMLElement>('[role="img"][aria-label="New color"]')!;
const previousSwatch = () =>
  popover().querySelector<HTMLButtonElement>(
    'button[aria-label="Restore previous color"]',
  )!;

/** A fill bound to a token opens on Libraries; the swatches live on Custom. */
function showCustom() {
  const tab = Array.from(
    popover().querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((candidate) => candidate.textContent === "Custom")!;
  act(() => tab.click());
}

function commitHex(hex: string) {
  const input = popover().querySelector<HTMLInputElement>(
    'input[aria-label="Hex"]',
  )!;
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, hex);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("Previous and New swatches", () => {
  it("shows the opening value as Previous while New follows edits", () => {
    mountPicker({ value: "#ff0000" });
    expect(newSwatch().style.backgroundColor).toBe("#ff0000");
    expect(previousSwatch().style.backgroundColor).toBe("#ff0000");

    commitHex("00ff00");

    expect(newSwatch().style.backgroundColor).toBe("#00ff00");
    expect(previousSwatch().style.backgroundColor).toBe("#ff0000");
  });

  it("restores Previous as a normal change: onChange, then onChangeComplete", () => {
    const spies = mountPicker({ value: "#ff0000" });
    commitHex("00ff00");
    spies.onChange.mockClear();
    spies.onChangeComplete.mockClear();

    act(() => previousSwatch().click());

    expect(spies.onChange).toHaveBeenCalledTimes(1);
    expect(spies.onChange).toHaveBeenCalledWith("#ff0000");
    expect(spies.onChangeComplete).toHaveBeenCalledTimes(1);
    expect(spies.onChangeComplete).toHaveBeenCalledWith("#ff0000");
    expect(spies.onChangeCancel).not.toHaveBeenCalled();
    expect(newSwatch().style.backgroundColor).toBe("#ff0000");
  });

  it("does nothing when the color is already the previous one", () => {
    const spies = mountPicker({ value: "#ff0000" });
    act(() => previousSwatch().click());
    expect(spies.onChange).not.toHaveBeenCalled();
    expect(spies.onChangeComplete).not.toHaveBeenCalled();
  });

  it("starts again from the current color when the picker is reopened", () => {
    const spies = mountPicker({ value: "#ff0000" });
    commitHex("00ff00");
    expect(previousSwatch().style.backgroundColor).toBe("#ff0000");

    act(() => spies.setOpen(false));
    act(() => spies.setOpen(true));

    expect(previousSwatch().style.backgroundColor).toBe("#00ff00");
    expect(newSwatch().style.backgroundColor).toBe("#00ff00");
  });

  it("binds the token again when Previous was a token", () => {
    const spies = mountPicker({
      value: "#0a6bd6",
      boundToken: "--link",
      tokens: TOKENS,
    });
    showCustom();
    commitHex("00ff00");
    spies.onChange.mockClear();
    spies.onChangeComplete.mockClear();

    act(() => previousSwatch().click());

    expect(spies.onPickToken).toHaveBeenCalledWith({
      name: "Link",
      cssVar: "--link",
      value: "#0a6bd6",
    });
    expect(spies.onChange).not.toHaveBeenCalled();
    expect(spies.onChangeComplete).not.toHaveBeenCalled();
  });

  it("cannot restore a token that was never defined", () => {
    const spies = mountPicker({ value: "var(--missing)", tokens: TOKENS });
    showCustom();
    expect(previousSwatch().disabled).toBe(true);
    expect(previousSwatch().style.backgroundColor).toBe("");
    expect(previousSwatch().className).toContain("repeating-linear-gradient");
    act(() => previousSwatch().click());
    expect(spies.onChange).not.toHaveBeenCalled();
    expect(spies.onChangeComplete).not.toHaveBeenCalled();
  });
});

function tooltipText() {
  return Array.from(document.querySelectorAll('[role="tooltip"]'))
    .map((node) => node.textContent)
    .join("|");
}

describe("New swatch tooltip", () => {
  it("only names the swatch for a color inside sRGB", () => {
    mountPicker({ value: "#ff0000" });
    act(() => newSwatch().focus());
    expect(tooltipText()).toBe("New");
  });

  it("says where a color outside sRGB falls back to", () => {
    const value = "color(display-p3 0 1 0.3)";
    mountPicker({ value });
    const wide = readWideColor(value)!;
    const expectedHex = rgbaToHex(
      linearToRgbaGamutMapped(wide.linear, 1),
    ).toUpperCase();
    expect(gamutFallbacks(wide.linear)).toEqual({ srgbHex: expectedHex });

    act(() => newSwatch().focus());

    expect(tooltipText()).toBe(
      `NewOutside sRGB. Falls back to ${expectedHex} there.`,
    );
  });

  it("also names the Display P3 fallback for a color past Display P3", () => {
    const value = "oklch(0.7 0.4 150)";
    mountPicker({ value });
    const fallbacks = gamutFallbacks(readWideColor(value)!.linear)!;
    expect(fallbacks.p3Css).toBeDefined();

    act(() => newSwatch().focus());

    expect(tooltipText()).toContain("Outside sRGB. Falls back to #");
    expect(tooltipText()).toContain(
      `Outside Display P3 too. Falls back to ${fallbacks.p3Css} there.`,
    );
  });
});

describe("gamutFallbacks", () => {
  it("is null for colors that fit in sRGB", () => {
    const red = parseCssColor("#ff0000")!;
    expect(gamutFallbacks(rgbaToLinearSrgb(red))).toBeNull();
  });
});
