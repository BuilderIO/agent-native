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

  it("opens the anchor controls with Alt+R and writes a selected position", async () => {
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

    const topRight = document.querySelector<HTMLButtonElement>(
      'button[role="radio"][aria-label="editPanel.scale.topRight"]',
    );
    expect(topRight).not.toBeNull();
    if (!topRight) throw new Error("Top-right origin anchor did not render.");

    await act(async () => topRight.click());
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "transform-origin",
      "100% 0%",
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

describe("PositionLayoutProperties X/Y on in-flow layers", () => {
  function flowChild(overrides: Partial<ElementInfo> = {}): ElementInfo {
    return {
      tagName: "div",
      classes: [],
      computedStyles: { display: "block", position: "static" },
      boundingRect: { x: 40, y: 142, width: 120, height: 40 },
      parentBoundingRect: { x: 0, y: 0, width: 400, height: 600 },
      isFlexChild: false,
      isFlexContainer: false,
      parentDisplay: "block",
      sourceId: "flow-child",
      ...overrides,
    } as ElementInfo;
  }

  async function renderPosition(element: ElementInfo) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    await act(async () => {
      root.render(
        <PositionLayoutProperties
          element={element}
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
        />,
      );
    });
    const input = (axis: "X" | "Y") =>
      container.querySelector<HTMLInputElement>(
        `input[aria-label="${axis}-position"]`,
      )!;
    const type = async (axis: "X" | "Y", text: string) => {
      const field = input(axis);
      await act(async () => {
        field.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
    };
    const cleanup = async () => {
      await act(async () => root.unmount());
      container.remove();
    };
    return { input, type, onStyleChange, onStylesChange, cleanup };
  }

  it("moves a block-flow child to the typed Y with a relative offset, leaving it in flow", async () => {
    const view = await renderPosition(flowChild());
    expect(view.input("Y").value).toBe("142");
    await view.type("Y", "150");
    expect(view.onStylesChange).toHaveBeenCalledTimes(1);
    const [patch] = view.onStylesChange.mock.calls[0]!;
    expect(patch).toEqual({ position: "relative", top: "8px" });
    await view.cleanup();
  });

  it("offsets an already-relative child from its current inset", async () => {
    const view = await renderPosition(
      flowChild({
        computedStyles: {
          display: "block",
          position: "relative",
          left: "10px",
          top: "0px",
        },
        boundingRect: { x: 50, y: 142, width: 120, height: 40 },
      }),
    );
    await view.type("X", "80");
    const [patch] = view.onStylesChange.mock.calls[0]!;
    expect(patch).toEqual({ left: "40px" });
    await view.cleanup();
  });

  it("keeps X/Y read-only when a relative offset would re-anchor absolute children", async () => {
    const view = await renderPosition(
      flowChild({
        childElementCount: 1,
        childLayouts: {
          complete: true,
          looseText: false,
          children: [
            {
              tagName: "div",
              position: "absolute",
              rect: { x: 0, y: 0, width: 10, height: 10 },
            },
          ],
        } as ElementInfo["childLayouts"],
      }),
    );
    expect(view.input("Y").disabled).toBe(true);
    await view.cleanup();
  });

  it("shows X/Y read-only for an in-flow auto layout child", async () => {
    const view = await renderPosition(
      flowChild({
        isFlexChild: true,
        parentDisplay: "flex",
        parentLayout: { display: "flex", flexDirection: "row" },
      }),
    );
    expect(view.input("X").disabled).toBe(true);
    expect(view.input("Y").disabled).toBe(true);
    expect(view.input("Y").value).toBe("142");
    await view.cleanup();
  });

  it("keeps X/Y editable for an absolute child of an auto layout parent", async () => {
    const view = await renderPosition(
      flowChild({
        isFlexChild: true,
        parentDisplay: "flex",
        computedStyles: {
          display: "block",
          position: "absolute",
          left: "40px",
          top: "142px",
        },
      }),
    );
    expect(view.input("Y").disabled).toBe(false);
    await view.type("Y", "150");
    const [patch] = view.onStylesChange.mock.calls[0]!;
    expect(patch).toEqual({ top: "150px" });
    await view.cleanup();
  });
});
