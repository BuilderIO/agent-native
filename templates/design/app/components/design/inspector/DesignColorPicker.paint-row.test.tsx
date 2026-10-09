// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";
import {
  BLEND_MODE_GROUPS,
  BLEND_MODE_OPTIONS,
} from "./color-picker-paint-types";
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

function renderPicker(
  props: Partial<React.ComponentProps<typeof DesignColorPicker>> = {},
) {
  act(() => {
    root.render(
      <TooltipProvider>
        <DesignColorPicker
          value="#336699"
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
const paintRow = () =>
  popover().querySelector<HTMLElement>("div.border-b.h-10")!;
const rowLabels = () =>
  Array.from(paintRow().querySelectorAll("button")).map((button) =>
    button.getAttribute("aria-label"),
  );
const rowButton = (label: string) =>
  paintRow().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe("paint row", () => {
  it("has Solid, Gradient, Image and Shader on the left, and no per-kind gradient icons", () => {
    renderPicker({
      supportedPaintTypes: ["solid", "linear", "radial", "image", "shader"],
      glslShaderContext: { designId: "d1" },
    });
    expect(rowLabels()).toEqual(["Solid", "Gradient", "Image", "Shader"]);
    for (const kind of ["Linear", "Radial", "Angular", "Diamond"]) {
      expect(
        popover().querySelector(`button[aria-label="${kind}"]`),
      ).toBeNull();
    }
  });

  it("keeps None reachable where a caller allows it, after the four paints", () => {
    renderPicker({ glslShaderContext: { designId: "d1" } });
    expect(rowLabels()).toEqual([
      "Solid",
      "Gradient",
      "Image",
      "Shader",
      "None",
    ]);
  });

  it("puts Blend and Contrast on the right, in that order, when both apply", () => {
    renderPicker({
      showBlendMode: true,
      onBlendModeChange: () => {},
      contrast: {
        large: false,
        readBackground: async () => ({
          kind: "unavailable",
          reason: "no-screen",
        }),
        onAskAgent: () => {},
      },
    });
    const labels = rowLabels();
    expect(labels.slice(-2)).toEqual(["Blend", "Contrast"]);
    const right = rowButton("Blend").parentElement!;
    expect(right.contains(rowButton("Contrast"))).toBe(true);
    expect(right.contains(rowButton("Solid"))).toBe(false);
  });

  it("has no Blend or Contrast without a reason for them", () => {
    renderPicker();
    expect(rowLabels()).not.toContain("Blend");
    expect(rowLabels()).not.toContain("Contrast");
  });

  it("has no row when there is one paint to choose and nothing to the right", () => {
    renderPicker({ supportedPaintTypes: ["solid"] });
    expect(popover().querySelector("div.border-b.h-10")).toBeNull();
  });

  it("shows the Gradient paint as active for any gradient kind", () => {
    renderPicker({
      value: "radial-gradient(circle, #000000 0%, #ffffff 100%)",
      paintType: "radial",
    });
    expect(rowButton("Gradient").getAttribute("aria-pressed")).toBe("true");
    expect(rowButton("Solid").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to a linear gradient from Gradient, and does not reset a gradient already chosen", () => {
    const onPaintTypeChange = vi.fn(() => true);
    renderPicker({ onPaintTypeChange });
    act(() => rowButton("Gradient").click());
    expect(onPaintTypeChange).toHaveBeenCalledTimes(1);
    expect(onPaintTypeChange).toHaveBeenCalledWith("linear");

    onPaintTypeChange.mockClear();
    renderPicker({
      value: "radial-gradient(circle, #000000 0%, #ffffff 100%)",
      paintType: "radial",
      onPaintTypeChange,
    });
    act(() => rowButton("Gradient").click());
    expect(onPaintTypeChange).not.toHaveBeenCalled();
  });

  it("clears the fill from None", () => {
    const onChange = vi.fn();
    renderPicker({ onChange, onChangeComplete: vi.fn() });
    act(() => rowButton("None").click());
    expect(onChange).toHaveBeenCalledWith("transparent");
  });
});

describe("Blend menu", () => {
  function Harness({ initial }: { initial: string }) {
    const [mode, setMode] = useState(initial);
    return (
      <TooltipProvider>
        <DesignColorPicker
          value="#336699"
          open
          onOpenChange={() => {}}
          trigger={<button type="button">Open picker</button>}
          onChange={() => {}}
          showBlendMode
          blendMode={mode}
          onBlendModeChange={(next) => {
            changes.push(next);
            setMode(next);
          }}
        />
      </TooltipProvider>
    );
  }
  let changes: string[] = [];

  async function openMenu() {
    const trigger = rowButton("Blend");
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

  beforeEach(() => {
    changes = [];
  });

  // oracle: none — the group order is read from the design file's Blend menu frame, not measured in native Figma.
  it("lists the sixteen modes in the designed groups", async () => {
    act(() => root.render(<Harness initial="normal" />));
    const menu = await openMenu();
    expect(menu).not.toBeNull();
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).map((item) => item.textContent);
    expect(items).toEqual([
      "Normal",
      "Darken",
      "Multiply",
      "Color burn",
      "Lighten",
      "Screen",
      "Color dodge",
      "Overlay",
      "Soft light",
      "Hard light",
      "Difference",
      "Exclusion",
      "Hue",
      "Saturation",
      "Color",
      "Luminosity",
    ]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(5);
  });

  it("checks the current mode and reads pressed only when it is not Normal", async () => {
    act(() => root.render(<Harness initial="normal" />));
    expect(rowButton("Blend").getAttribute("aria-pressed")).toBe("false");
    let menu = await openMenu();
    const checked = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLElement>('[aria-checked="true"]'),
      ).map((item) => item.textContent);
    expect(checked(menu)).toEqual(["Normal"]);

    act(() => root.render(<Harness key="multiply" initial="multiply" />));
    expect(rowButton("Blend").getAttribute("aria-pressed")).toBe("true");
    menu = await openMenu();
    expect(checked(menu)).toEqual(["Multiply"]);
  });

  it("changes the blend mode from the menu", async () => {
    act(() => root.render(<Harness initial="normal" />));
    const menu = await openMenu();
    const luminosity = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((item) => item.textContent === "Luminosity")!;
    await act(async () => {
      luminosity.click();
    });
    expect(changes).toEqual(["luminosity"]);
    expect(rowButton("Blend").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("blend mode groups", () => {
  it("cover each of the sixteen modes exactly once", () => {
    const grouped = BLEND_MODE_GROUPS.flat();
    expect(grouped).toHaveLength(BLEND_MODE_OPTIONS.length);
    expect(new Set(grouped).size).toBe(BLEND_MODE_OPTIONS.length);
    expect([...grouped].sort()).toEqual(
      BLEND_MODE_OPTIONS.map((option) => option.value).sort(),
    );
  });
});
