// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const screen = (id: string) => ({
  id,
  filename: `${id}.html`,
  content: "<!doctype html><html><body>Preview</body></html>",
});

describe("MultiScreenCanvas device frame corners in Interact", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 800,
        bottom: 600,
        left: 0,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  async function render({
    cornerClass,
    interact = true,
  }: {
    cornerClass: string | null;
    interact?: boolean;
  }) {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[screen("screen-a"), screen("screen-b")]}
          zoom={100}
          creation={{ activeTool: "move" }}
          activeId="screen-a"
          interactScreenId={interact ? "screen-a" : null}
          focusedInteractViewport={
            interact ? { width: 402, height: 874 } : null
          }
          focusedInteractCornerClass={cornerClass}
          screenRootComputedStylesById={{
            "screen-a": { borderTopLeftRadius: "3px" },
            "screen-b": { borderTopLeftRadius: "3px" },
          }}
          geometry={{
            geometryById: {
              "screen-a": { x: 0, y: 0, width: 402, height: 874 },
              "screen-b": { x: 600, y: 0, width: 402, height: 874 },
            },
          }}
          onPick={() => {}}
        />,
      );
    });
    const card = (id: string) =>
      container.querySelector<HTMLElement>(
        `[data-frame-id="${id}"] [data-screen-card]`,
      )!;
    const content = (id: string) =>
      card(id).querySelector<HTMLElement>("[data-screen-content]")!;
    return { card, content };
  }

  it("rounds and lifts the focused frame with the device's corner", async () => {
    const { card, content } = await render({ cornerClass: "rounded-4xl" });

    expect(card("screen-a").classList.contains("rounded-4xl")).toBe(true);
    expect(card("screen-a").classList.contains("shadow-md")).toBe(true);
    // The clip that holds the page inherits the corner, so the page is cut to it.
    expect(content("screen-a").className).toContain("rounded-[inherit]");
    expect(content("screen-a").className).toContain("overflow-clip");
  });

  it("lets the device corner win over the page's own root radius", async () => {
    const { content } = await render({ cornerClass: "rounded-xl" });

    expect(content("screen-a").getAttribute("style")).not.toContain("radius");
    // A screen that is not the focused one keeps the radius of its own root.
    expect(content("screen-b").getAttribute("style")).toContain(
      "border-top-left-radius: 3px",
    );
  });

  it("leaves every other screen square-cornered and flat", async () => {
    const { card } = await render({ cornerClass: "rounded-4xl" });

    expect(card("screen-b").className).not.toContain("rounded-4xl");
    expect(card("screen-b").className).not.toContain("shadow-md");
  });

  it("rounds nothing outside Interact", async () => {
    const { card, content } = await render({
      cornerClass: "rounded-4xl",
      interact: false,
    });

    expect(card("screen-a").className).not.toContain("rounded-4xl");
    expect(content("screen-a").getAttribute("style")).toContain(
      "border-top-left-radius: 3px",
    );
  });
});
