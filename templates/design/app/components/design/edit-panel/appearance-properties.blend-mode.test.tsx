// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { ElementInfo } from "../types";
import {
  AppearanceProperties,
  resolveBlendMenuSelection,
} from "./appearance-properties";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function element(computedStyles: Record<string, string>): ElementInfo {
  return {
    tagName: "H1",
    selector: "h1",
    classes: [],
    computedStyles: { opacity: "1", borderRadius: "0px", ...computedStyles },
    boundingRect: { x: 0, y: 0, width: 200, height: 100 },
    isFlexChild: false,
    isFlexContainer: false,
  };
}

describe("resolveBlendMenuSelection", () => {
  it("separates pass-through, an explicit Normal, a real mode, and mixed", () => {
    expect(resolveBlendMenuSelection({ mixBlendMode: "normal" })).toBe(
      "pass-through",
    );
    expect(
      resolveBlendMenuSelection({
        mixBlendMode: "normal",
        isolation: "isolate",
      }),
    ).toBe("normal");
    expect(resolveBlendMenuSelection({ mixBlendMode: "difference" })).toBe(
      "difference",
    );
    expect(resolveBlendMenuSelection({ mixBlendMode: "Mixed" })).toBe("Mixed");
  });
});

describe("Appearance blend mode row", () => {
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

  async function render(
    computedStyles: Record<string, string>,
    onStyleChange = vi.fn(),
  ) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AppearanceProperties
            element={element(computedStyles)}
            onStyleChange={onStyleChange}
            hidden={false}
          />
        </TooltipProvider>,
      );
    });
    return onStyleChange;
  }

  const buttonLabels = () =>
    [...container.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? "",
    );

  it("names the active blend mode instead of hiding it behind the droplet", async () => {
    await render({ mixBlendMode: "difference" });
    expect(container.textContent).toContain("Difference");
    expect(buttonLabels()).toContain("Blend mode: Difference");
    expect(buttonLabels()).toContain("Remove blend mode");
  });

  it("shows no blend row while the layer passes through", async () => {
    await render({ mixBlendMode: "normal", isolation: "auto" });
    expect(container.textContent).not.toContain("Difference");
    expect(buttonLabels()).not.toContain("Remove blend mode");
    expect(buttonLabels()).toContain("Blend mode");
  });

  it("removes the blend mode back to pass-through", async () => {
    const onStyleChange = await render({ mixBlendMode: "difference" });
    const remove = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Remove blend mode",
    );
    expect(remove).toBeDefined();
    await act(async () => remove!.click());
    expect(onStyleChange).toHaveBeenCalledWith("mixBlendMode", "normal");
    expect(onStyleChange).toHaveBeenCalledWith("isolation", "auto");
  });
});
