// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

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
import { MotionOriginControl } from "./motion-inspector-properties";
import { PositionLayoutProperties } from "./position-layout-properties";

describe("PositionLayoutProperties interactions", () => {
  it("keyframes both axes through the shared CSS scale track", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onToggle = vi.fn();
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "block",
        position: "absolute",
        left: "0px",
        top: "0px",
        transform: "none",
        scale: "2 3",
      },
      inlineStyles: { scale: "2 3" },
      boundingRect: { x: 0, y: 0, width: 120, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: false,
      hasOwnText: true,
      childElementCount: 0,
      sourceId: "motion-scale",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <PositionLayoutProperties
          element={element}
          onStyleChange={vi.fn()}
          motionKeyframeContext={{
            hasTimeline: true,
            keyframedProperties: ["scale"],
            onToggle,
          }}
        />,
      );
    });

    const scaleDiamond = container.querySelector<HTMLButtonElement>(
      'button[data-motion-css-property="scale"]',
    );
    expect(
      container.querySelectorAll('button[data-motion-css-property="scale"]'),
    ).toHaveLength(1);
    expect(scaleDiamond?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('input[aria-label="editPanel.scale.factor X"]'),
    ).toBeNull();

    await act(async () => scaleDiamond?.click());
    expect(onToggle.mock.calls).toEqual([["scale"]]);

    await act(async () => root.unmount());
    container.remove();
  });

  it("matches Motion scale locking and keyframes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const onToggle = vi.fn();
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "block",
        position: "absolute",
        left: "0px",
        top: "0px",
        transform: "none",
        scale: "2 3",
      },
      inlineStyles: { scale: "2 3" },
      boundingRect: { x: 0, y: 0, width: 120, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: false,
      hasOwnText: true,
      childElementCount: 0,
      sourceId: "motion-scale",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <PositionLayoutProperties
          element={element}
          onStyleChange={onStyleChange}
          motionInspector
          motionKeyframeContext={{
            hasTimeline: true,
            keyframedProperties: ["scale"],
            onToggle,
          }}
        />,
      );
    });

    const scaleX = container.querySelector<HTMLInputElement>(
      'input[aria-label="editPanel.scale.factor X"]',
    );
    const scaleY = container.querySelector<HTMLInputElement>(
      'input[aria-label="editPanel.scale.factor Y"]',
    );
    const unlockAspectRatio = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.unlockAspectRatio"]',
    );
    expect(Number.parseFloat(scaleX?.value ?? "")).toBe(200);
    expect(Number.parseFloat(scaleY?.value ?? "")).toBe(300);
    expect(unlockAspectRatio?.getAttribute("aria-pressed")).toBe("true");
    const scaleDiamonds = container.querySelectorAll<HTMLButtonElement>(
      'button[data-motion-css-property="scale"]',
    );
    expect(scaleDiamonds).toHaveLength(1);

    await act(async () => scaleDiamonds[0]?.click());
    expect(onToggle.mock.calls).toEqual([["scale"]]);

    await act(async () => {
      scaleX?.focus();
      if (!scaleX) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(scaleX, "400");
      scaleX.dispatchEvent(new Event("input", { bubbles: true }));
      scaleX.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(onStyleChange).toHaveBeenLastCalledWith("scale", "4 6", {
      source: "commit",
      expression: "400",
      phase: "commit",
    });

    expect(
      container.querySelector(
        'button[aria-label="editPanel.labels.flipHorizontal"]',
      ),
    ).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the anchor target with Alt+R and writes its dragged position", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: { "transform-origin": "50% 50%" },
      inlineStyles: { "transform-origin": "50% 50%" },
      boundingRect: { x: 0, y: 0, width: 120, height: 80 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: false,
    } as ElementInfo;

    await act(async () => {
      root.render(
        <MotionOriginControl element={element} onStyleChange={onStyleChange} />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.origin"]',
    );
    expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Alt+R");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyR",
          key: "r",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    const surface = document.querySelector<HTMLDivElement>(
      "[data-motion-origin-surface]",
    );
    const handle = document.querySelector<HTMLButtonElement>(
      "[data-motion-origin-handle]",
    );
    expect(surface).not.toBeNull();
    expect(handle).not.toBeNull();
    if (!surface || !handle) throw new Error("Anchor target did not open.");
    surface.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          clientX: 50,
          clientY: 50,
        }),
      );
      handle.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          clientX: 72,
          clientY: 25,
        }),
      );
      handle.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
        }),
      );
    });
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "transform-origin",
      "72% 25%",
      undefined,
    );
    expect(
      document.querySelectorAll(
        '[role="radio"][aria-label^="editPanel.scale."]',
      ),
    ).toHaveLength(9);
    expect(
      document.querySelector(
        'input[aria-label="designEditor.motion.origin X"]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        'input[aria-label="designEditor.motion.origin Y"]',
      ),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
