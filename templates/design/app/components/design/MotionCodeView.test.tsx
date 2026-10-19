// @vitest-environment happy-dom

import type { MotionLayerCodeSource } from "@shared/motion-layer-code";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { MotionCodeView, type MotionCodeInput } from "./MotionCodeView";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const node = (
  id: string,
  layerName: string,
  children: string[] = [],
  style: Record<string, string> = {},
) => ({
  id,
  layerName,
  children,
  style,
  dataAttributes: { "data-agent-native-node-id": `motion-${id}` },
});

const nodes = [
  node("frame", "Frame", ["card"]),
  node("card", "Card", [], { opacity: "1" }),
  node("plain", "Plain"),
];

const source: MotionLayerCodeSource = {
  tracks: [
    {
      id: "card-fade",
      targetNodeId: "motion-card",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    },
  ],
  nativeStyles: [],
  textAnimations: [],
  durationMs: 1000,
  defaultEase: "ease",
};

const target = (id: string) => ({ nodeId: `motion-${id}`, label: id });

describe("MotionCodeView", () => {
  let container: HTMLDivElement;
  let root: Root;
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  async function render(
    overrides: {
      input?: Partial<MotionCodeInput>;
      hasList?: boolean;
    } = {},
  ) {
    const input: MotionCodeInput = {
      source,
      nodes,
      targets: [target("card")],
      ...overrides.input,
    };
    await act(async () => {
      root.render(
        <TooltipProvider>
          <MotionCodeView
            input={input}
            hasList={overrides.hasList ?? true}
            list={<div data-testid="list">rows</div>}
            t={(key) => key}
          />
        </TooltipProvider>,
      );
    });
  }

  const tab = (name: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (element) => element.textContent === name,
    )!;

  async function openCode() {
    await act(async () =>
      tab("designEditor.motion.code.code").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
  }

  it("starts on read-only CSS code and switches back to the list", async () => {
    await render();
    expect(container.querySelector('[data-testid="list"]')).toBeNull();
    const pre = Array.from(container.querySelectorAll("pre")).map(
      (element) => element.textContent,
    );
    expect(pre[0]).toContain('[data-agent-native-node-id="motion-card"]');
    expect(pre[0]).toContain("  opacity: 1;");
    expect(pre[1]).toContain("@keyframes an-motion-motion-card--opacity");
    expect(container.querySelector("textarea, [contenteditable]")).toBeNull();
    await act(async () =>
      tab("designEditor.motion.code.list").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(container.querySelector('[data-testid="list"]')).not.toBeNull();
  });

  it("explains text-only motion instead of showing an empty CSS pane", async () => {
    await render({
      input: {
        source: {
          ...source,
          tracks: [],
          textAnimations: [
            {
              targetNodeId: "motion-card",
              unit: "word",
              direction: "forward",
              staggerMs: 30,
              property: "opacity",
              durationMs: 500,
              keyframes: [{ t: 0, value: "0" }],
            },
          ],
        },
      },
    });
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).toContain(
      "designEditor.motion.code.unavailable",
    );
  });

  it("refreshes the text when the motion changes", async () => {
    await render();
    await openCode();
    expect(container.textContent).toContain("animation-duration: 1s;");
    await render({
      input: {
        source: { ...source, durationMs: 2000, tracks: [...source.tracks] },
      },
    });
    expect(container.textContent).toContain("animation-duration: 2s;");
  });

  it("disables a choice that has nothing to show", async () => {
    await render({ input: { targets: [target("plain")] }, hasList: true });
    expect(container.querySelector('[role="tab"]')).not.toBeNull();
    expect(tab("designEditor.motion.code.code").hasAttribute("disabled")).toBe(
      true,
    );
    await render({ hasList: false });
    expect(tab("designEditor.motion.code.list").hasAttribute("disabled")).toBe(
      true,
    );
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("shows only the list when neither form has anything", async () => {
    await render({ input: { targets: [target("plain")] }, hasList: false });
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="list"]')).not.toBeNull();
  });

  it("lists animated layers for a frame and shows no text until Data", async () => {
    const onHoverLayer = vi.fn();
    await render({
      input: { targets: [target("frame")], onHoverLayer },
      hasList: false,
    });
    expect(container.querySelector("pre")).toBeNull();
    const layerButton =
      container.querySelector<HTMLButtonElement>("ul button")!;
    expect(layerButton.textContent).toBe("Card");
    await act(async () =>
      layerButton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(onHoverLayer).toHaveBeenCalledWith("card");

    const trigger =
      container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(async () => trigger.click());
    const option = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find(
      (element) => element.textContent === "designEditor.motion.code.data",
    )!;
    await act(async () => option.click());
    expect(container.querySelector("pre")?.textContent).toContain(
      '"layer": "Card"',
    );
  });

  it("copies one section, or every section while the modifier is held", async () => {
    await render({ hasList: false });
    const copyButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.code.copy"]',
    );
    await act(async () => copyButtons[1]!.click());
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("@keyframes"),
    );
    expect(writeText.mock.lastCall?.[0]).not.toContain("animation-duration");

    await act(async () =>
      copyButtons[1]!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, altKey: true }),
      ),
    );
    expect(writeText.mock.lastCall?.[0]).toContain("animation-duration");
    expect(writeText.mock.lastCall?.[0]).toContain("@keyframes");
  });

  it("reveals the rest of a long section", async () => {
    const keyframes = Array.from({ length: 6 }, (_, index) => ({
      t: index / 5,
      value: String(index / 5),
    }));
    await render({
      hasList: false,
      input: {
        source: {
          ...source,
          tracks: [{ ...source.tracks[0]!, keyframes }],
        },
      },
    });
    const before = container.querySelectorAll("pre")[1]!.textContent!;
    // The styles section can be long too, so reveal every section, not just the first one.
    const showMores = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "designEditor.motion.code.showMore",
    );
    await act(async () => showMores.forEach((button) => button.click()));
    const after = container.querySelectorAll("pre")[1]!.textContent!;
    expect(after.split("\n").length).toBeGreaterThan(before.split("\n").length);
    expect(after.trimEnd().endsWith("}")).toBe(true);
  });

  it("opens the layer in the timeline", async () => {
    const onOpenInTimeline = vi.fn();
    await render({ hasList: false, input: { onOpenInTimeline } });
    const open = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.code.openInTimeline"]',
    )!;
    await act(async () => open.click());
    expect(onOpenInTimeline).toHaveBeenCalledTimes(1);
  });
});
