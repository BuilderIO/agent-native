// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";
import { DesignColorPicker } from "./DesignColorPicker";

// Resolve copy from the real English catalog so a misspelled key fails here.
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

function renderOpenPicker(
  props: Partial<React.ComponentProps<typeof DesignColorPicker>> = {},
) {
  act(() => {
    root.render(
      <TooltipProvider>
        <DesignColorPicker
          value="#ff0000"
          onChange={() => {}}
          open
          onOpenChange={() => {}}
          trigger={<button type="button">Open picker</button>}
          {...props}
        />
      </TooltipProvider>,
    );
  });
}

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  )!;

function isBefore(first: Element, second: Element) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("DesignColorPicker surface", () => {
  it("is a 272px popover with an inset ring and no layout-taking border", () => {
    renderOpenPicker();
    const content = popover();
    expect(content.className).toContain("w-[272px]");
    expect(content.className).toContain("ring-inset");
    expect(content.className).toContain("border-0");
    expect(content.className).toContain("p-0");
  });

  it("lays out paint row, square, sliders, mode and fields, then document colors", () => {
    renderOpenPicker({ documentColors: ["#111111", "#222222"] });
    const content = popover();
    const query = (selector: string) =>
      content.querySelector<HTMLElement>(selector)!;

    const paintRow = query('button[aria-label="Solid"]');
    const square = query('[aria-label="Saturation and brightness"]');
    const eyedropper = query('button[aria-label="Pick color"]');
    const hue = query('[role="slider"][aria-label="H"]');
    const alpha = query('[role="slider"][aria-label="Opacity"]');
    const newSwatch = query('[role="img"][aria-label="New color"]');
    const mode = query('[aria-label="Color model"]');
    const hex = query('input[aria-label="Hex"]');
    const copy = query('button[aria-label="Copy value"]');
    const documentColors = query(".grid.grid-cols-8");

    const inOrder = [
      paintRow,
      square,
      eyedropper,
      hue,
      alpha,
      newSwatch,
      mode,
      hex,
      copy,
      documentColors,
    ];
    for (let i = 1; i < inOrder.length; i++) {
      expect(isBefore(inOrder[i - 1]!, inOrder[i]!)).toBe(true);
    }
    expect(mode.textContent).toContain("Hex");
    expect(documentColors.children).toHaveLength(2);
  });

  it("shows the Custom | Libraries header only when a token can be picked", () => {
    renderOpenPicker();
    expect(popover().querySelector('[role="tablist"]')).toBeNull();

    renderOpenPicker({
      onPickToken: () => {},
      tokens: {
        status: "ready",
        tokens: [{ name: "Brand", cssVar: "--brand", value: "#336699" }],
      },
    });
    const tabs = Array.from(
      popover().querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Custom", "Libraries"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(
      popover().querySelector('input[aria-label="Search tokens"]'),
    ).toBeNull();

    act(() => tabs[1]!.click());
    expect(
      popover().querySelector('input[aria-label="Search tokens"]'),
    ).not.toBeNull();
    expect(popover().querySelector('input[aria-label="Hex"]')).toBeNull();

    act(() => tabs[0]!.click());
    expect(popover().querySelector('input[aria-label="Hex"]')).not.toBeNull();
  });

  it("opens on the requested side of its trigger", () => {
    renderOpenPicker({ side: "right" });
    expect(popover().getAttribute("data-side")).toBe("right");
  });
});

describe("DesignColorPicker copy button", () => {
  async function clickCopy(writeText: () => Promise<void>) {
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderOpenPicker({ value: "#3b82f6" });
    const button = popover().querySelector<HTMLButtonElement>(
      'button[aria-label="Copy value"]',
    )!;
    await act(async () => {
      button.click();
    });
    return button;
  }

  it("copies the CSS the picker writes and confirms with a check", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const button = await clickCopy(writeText);
    expect(writeText).toHaveBeenCalledWith("#3b82f6");
    expect(button.querySelector(".tabler-icon-check")).not.toBeNull();
  });

  it("does not claim success when the clipboard write is refused", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const button = await clickCopy(writeText);
    expect(writeText).toHaveBeenCalledWith("#3b82f6");
    expect(button.querySelector(".tabler-icon-check")).toBeNull();
    expect(button.querySelector(".tabler-icon-copy")).not.toBeNull();
  });
});
