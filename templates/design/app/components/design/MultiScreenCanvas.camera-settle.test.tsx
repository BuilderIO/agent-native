// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OVERVIEW_LIVE_SCREEN_BUDGET } from "./multi-screen/culling";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("MultiScreenCanvas camera rest", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      left: 0,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    container.remove();
  });

  async function panAndCountRenders(screenCount: number) {
    const screens = Array.from({ length: screenCount }, (_, index) => ({
      id: `screen-${index}`,
      filename: `screen-${index}.html`,
      content: "<!doctype html><html><body>screen</body></html>",
    }));
    let renders = 0;
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Profiler id="canvas" onRender={() => renders++}>
            <MultiScreenCanvas
              screens={screens}
              zoom={100}
              creation={{ activeTool: "move" }}
              geometry={{
                geometryById: Object.fromEntries(
                  screens.map((screen, index) => [
                    screen.id,
                    { x: index * 400, y: 0, width: 320, height: 640 },
                  ]),
                ),
              }}
              renderScreenContent={(screen) => <div>{screen.id}</div>}
              onPick={() => {}}
            />
          </Profiler>
        </QueryClientProvider>,
      );
    });

    vi.useFakeTimers();
    const surface = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-surface]",
    );
    expect(surface).not.toBeNull();
    await act(async () => {
      surface!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: 300,
          clientY: 300,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: 340,
          clientY: 320,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 1,
          clientX: 340,
          clientY: 320,
        }),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    const beforeCameraRest = renders;
    await act(async () => vi.advanceTimersByTimeAsync(150));
    return { beforeCameraRest, afterCameraRest: renders };
  }

  it("does not reconcile a small overview again when the camera rests", async () => {
    const result = await panAndCountRenders(6);
    expect(result.afterCameraRest).toBe(result.beforeCameraRest);
  });

  it("still reevaluates live editor admission after a large overview rests", async () => {
    const result = await panAndCountRenders(OVERVIEW_LIVE_SCREEN_BUDGET + 1);
    expect(result.afterCameraRest).toBeGreaterThan(result.beforeCameraRest);
  });
});
