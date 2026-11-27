// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import type { ElementInfo } from "../types";
import { ImageElementFill } from "./image-element-fill";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 16,
      width: 200,
      height: 16,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  act(() => root.unmount());
  container.remove();
});

const imageElement = {
  tagName: "img",
  id: "hero",
  classes: [],
  sourceId: "img-1",
  selector: "#hero",
  imageSource: "https://cdn.example.test/hero.png",
  computedStyles: {
    objectFit: "cover",
    filter: "contrast(1.05)",
  },
} as unknown as ElementInfo;

describe("ImageElementFill adjustment sliders", () => {
  it("keeps decorative track spans pointer-events-none and commits on lostpointercapture", () => {
    const onStyleChange = vi.fn();
    act(() => {
      root.render(
        <ImageElementFill
          element={imageElement}
          onStyleChange={onStyleChange}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.imageAdjustments"]',
    );
    expect(trigger).not.toBeNull();
    if (!trigger) throw new Error("Missing image adjustments trigger");
    act(() => {
      trigger.click();
    });

    const thumb = document.body.querySelector<HTMLElement>(
      '[role="slider"][aria-label="editPanel.labels.imageContrast"]',
    );
    expect(thumb).not.toBeNull();
    if (!thumb) throw new Error("Missing contrast slider thumb");
    const sliderRoot = thumb.closest("span[dir]") as HTMLElement | null;
    expect(sliderRoot).not.toBeNull();
    if (!sliderRoot) throw new Error("Missing slider root");
    const track = sliderRoot.firstElementChild as HTMLElement | null;
    expect(track).not.toBeNull();
    if (!track) throw new Error("Missing slider track");

    const decorativeSpans = [
      ...track.querySelectorAll<HTMLElement>("span"),
      ...thumb.querySelectorAll<HTMLElement>("span"),
    ];
    expect(decorativeSpans.length).toBeGreaterThanOrEqual(3);
    for (const decorative of decorativeSpans) {
      expect(decorative.className).toContain("pointer-events-none");
    }

    let captured = false;
    sliderRoot.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    sliderRoot.hasPointerCapture = vi.fn(() => captured);
    sliderRoot.releasePointerCapture = vi.fn(() => {
      captured = false;
    });

    act(() => {
      sliderRoot.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: 150,
          clientY: 8,
          button: 0,
          pointerId: 1,
        }),
      );
      sliderRoot.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 8,
          button: 0,
          pointerId: 1,
        }),
      );
      captured = false;
      sliderRoot.dispatchEvent(
        new PointerEvent("lostpointercapture", {
          bubbles: true,
          pointerId: 1,
        }),
      );
    });

    const commitCalls = onStyleChange.mock.calls.filter(
      ([, , opts]) => opts?.phase === "commit",
    );
    expect(commitCalls).toHaveLength(1);
  });
});
