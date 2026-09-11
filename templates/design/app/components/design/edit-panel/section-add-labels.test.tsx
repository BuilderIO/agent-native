// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { SectionIconButton } from "./inspector-controls";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("SectionIconButton tooltip reachability", () => {
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

  async function render(disabled: boolean) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SectionIconButton
            label="Add fill"
            disabled={disabled}
            onClick={vi.fn()}
          >
            <span>+</span>
          </SectionIconButton>
        </TooltipProvider>,
      );
    });
  }

  it("keeps a disabled control's tooltip reachable through a wrapper", async () => {
    // A disabled Button stops pointer events, so the tooltip explaining WHY it
    // is disabled would never open if the trigger were the button itself.
    await render(true);
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.disabled).toBe(true);
    const wrapper = button?.parentElement;
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.className).not.toContain("pointer-events-none");
  });

  it("still labels the control for assistive tech", async () => {
    await render(false);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Add fill",
    );
  });
});

describe("section add-action copy is per-section", () => {
  it("gives fill, stroke, and effects distinct catalog keys", async () => {
    // One shared "Add layer" label described three different actions: the
    // Stroke + said "Add layer", and Effects had no tooltip at all.
    const { messagesByLocale } = await import("@/i18n-data");
    const labels = (messagesByLocale["en-US"] as any).editPanel.labels;
    expect(labels.addFill).toBe("Add fill");
    expect(labels.addStroke).toBe("Add stroke");
    expect(labels.addEffect).toBe("Add effect");
    const distinct = new Set([
      labels.addFill,
      labels.addStroke,
      labels.addEffect,
    ]);
    expect(distinct.size).toBe(3);
  });
});
