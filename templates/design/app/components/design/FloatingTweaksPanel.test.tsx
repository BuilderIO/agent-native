// @vitest-environment happy-dom

import type { TweakDefinition } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  tweaksForSelection,
  tweakTargetsForSelection,
} from "./edit-panel/tweak-scope";
import { FloatingTweaksPanel } from "./FloatingTweaksPanel";

const TWEAKS: TweakDefinition[] = [
  {
    id: "shared",
    label: "Shared speed",
    type: "slider",
    min: 0,
    max: 10,
    defaultValue: 3,
    scope: { screenId: "screen-a", selector: ".other" },
  },
  {
    id: "part",
    label: "Animate part",
    type: "toggle",
    defaultValue: false,
    scope: { screenId: "screen-a", selector: ".selected" },
  },
];

describe("FloatingTweaksPanel", () => {
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

  it("renders the selected part's scoped controls and sends changes through the shared callback", async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div class="selected"></div>';
    const targets = tweakTargetsForSelection({
      elements: [{ selector: ".selected" } as never],
      fallbackScreenId: "screen-a",
      screenId: "screen-a",
    });
    const scoped = tweaksForSelection(
      TWEAKS,
      targets,
      () => doc.documentElement.outerHTML,
    );
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <TooltipProvider>
          <FloatingTweaksPanel
            tweaks={scoped}
            values={{ shared: 3, part: false }}
            onChange={onChange}
            open
            collapsed={false}
            position={{ x: 16, y: 64 }}
            onOpenChange={vi.fn()}
            onCollapsedChange={vi.fn()}
            onPositionChange={vi.fn()}
          />
        </TooltipProvider>,
      ),
    );

    expect(container.textContent).toContain("Animate part");
    expect(container.textContent).not.toContain("Shared speed");
    const input = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Animate part"]',
    );
    expect(input).not.toBeNull();
    if (!input) throw new Error("Part toggle control missing");
    await act(async () => {
      input.click();
    });
    expect(onChange).toHaveBeenCalledWith("part", true);
  });

  it("stays visible with the inspector closed and reports collapse changes for persistence", async () => {
    const onCollapsedChange = vi.fn();
    await act(async () =>
      root.render(
        <TooltipProvider>
          <FloatingTweaksPanel
            tweaks={TWEAKS.slice(0, 1)}
            values={{}}
            onChange={vi.fn()}
            open
            collapsed={false}
            position={{ x: 16, y: 64 }}
            onOpenChange={vi.fn()}
            onCollapsedChange={onCollapsedChange}
            onPositionChange={vi.fn()}
          />
        </TooltipProvider>,
      ),
    );
    expect(
      container.querySelector("[data-design-floating-tweaks]"),
    ).not.toBeNull();
    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse tweaks"]',
    );
    expect(collapse).not.toBeNull();
    await act(async () => collapse?.click());
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});
