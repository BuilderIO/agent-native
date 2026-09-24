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

function readView(container: HTMLElement) {
  const world = container.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  const match = world?.style.transform.match(
    /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/,
  );
  if (!match)
    throw new Error(`unparsable canvas transform: ${world?.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

describe("MultiScreenCanvas geometry hydration camera", () => {
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

  it("keeps a user pan when the initially empty canvas hydrates its screen geometry", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          activeTool="move"
          onPick={() => {}}
        />,
      );
    });

    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    await act(async () => {
      surface!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 1,
          buttons: 4,
          clientX: 300,
          clientY: 240,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 4,
          clientX: 360,
          clientY: 285,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 1,
          buttons: 0,
          clientX: 360,
          clientY: 285,
        }),
      );
    });
    const userPan = readView(container);
    expect(userPan).toMatchObject({ x: 60, y: 45 });

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          geometryById={{
            "screen-a": { x: 420, y: 280, width: 390, height: 844 },
          }}
          onPick={() => {}}
        />,
      );
    });

    expect(readView(container)).toEqual(userPan);
  });
});
