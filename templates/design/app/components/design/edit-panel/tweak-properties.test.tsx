// @vitest-environment happy-dom

import type { TweakDefinition } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { groupTweakRows, TweakProperties } from "./tweak-properties";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RIBBON_TWEAKS: TweakDefinition[] = [
  {
    id: "speed",
    label: "Flow speed",
    type: "slider",
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: 0.7,
    cssVar: "--speed",
  },
  {
    id: "folds",
    label: "Ribbon sharpness",
    type: "slider",
    min: 1,
    max: 10,
    step: 1,
    defaultValue: 4,
    cssVar: "--folds",
  },
  {
    id: "intensity",
    label: "Light intensity",
    type: "slider",
    min: 0.2,
    max: 2.5,
    step: 0.1,
    defaultValue: 1.3,
    cssVar: "--intensity",
  },
  {
    id: "tint",
    label: "Light color",
    type: "color-swatch",
    defaultValue: "#01C8F1",
    cssVar: "--tint",
  },
  {
    id: "grain",
    label: "Film grain",
    type: "toggle",
    defaultValue: false,
    cssVar: "--grain",
  },
];

describe("groupTweakRows", () => {
  it("pairs consecutive sliders and keeps other tweaks on their own rows", () => {
    expect(
      groupTweakRows(RIBBON_TWEAKS).map((row) =>
        row.kind === "slider"
          ? row.tweaks.map((tweak) => tweak.id).join("+")
          : row.tweak.id,
      ),
    ).toEqual(["speed+folds", "intensity", "tint", "grain"]);
  });
});

describe("TweakProperties", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(onChange = vi.fn()) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TweakProperties
            tweaks={RIBBON_TWEAKS}
            values={{ speed: 0.4, tint: "#8B7BFF" }}
            onChange={onChange}
          />
        </TooltipProvider>,
      );
    });
    return onChange;
  }

  it("lays tweaks out on the inspector grid instead of stacked sliders", async () => {
    await render();
    const rows = [...container.querySelectorAll("[data-tweak-row]")];
    expect(
      rows.map((row) => [
        row.getAttribute("data-tweak-row"),
        row.getAttribute("data-inspector-layout"),
      ]),
    ).toEqual([
      ["slider", "label-action-rows"],
      ["slider", "label-action-rows"],
      ["color", "label-field-action"],
      ["toggle", "field-action"],
    ]);
    expect(container.querySelector('input[type="range"]')).toBeNull();
    const speed = container.querySelector<HTMLInputElement>(
      'input[aria-label="Flow speed"]',
    );
    expect(speed?.value).toBe("0.4");
    expect(
      container.querySelector('[title="Ribbon sharpness"]')?.textContent,
    ).toBe("Ribbon sharpness");
  });

  it("commits a typed value clamped to the tweak's range", async () => {
    const onChange = await render();
    const folds = container.querySelector<HTMLInputElement>(
      'input[aria-label="Ribbon sharpness"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!folds || !setValue) throw new Error("Ribbon sharpness field missing");
    await act(async () => {
      folds.focus();
      setValue.call(folds, "25");
      folds.dispatchEvent(new Event("input", { bubbles: true }));
      folds.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith("folds", 10);
  });

  it("flips a toggle tweak from its switch", async () => {
    const onChange = await render();
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Film grain"]',
    );
    if (!toggle) throw new Error("Film grain switch missing");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenCalledWith("grain", true);
  });
});
