// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OVERVIEW_LIVE_SCREEN_BUDGET } from "./multi-screen/culling";
import { wantPreviewParses } from "./multi-screen/preview-parse-warmer";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./multi-screen/preview-parse-warmer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./multi-screen/preview-parse-warmer")
    >();
  return { ...actual, wantPreviewParses: vi.fn() };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("MultiScreenCanvas preview warming", () => {
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
      right: 2000,
      bottom: 1400,
      left: 0,
      width: 2000,
      height: 1400,
      toJSON: () => ({}),
    });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    container.remove();
  });

  it("asks the workers to parse only screens near the viewport", async () => {
    const screens = Array.from(
      { length: OVERVIEW_LIVE_SCREEN_BUDGET * 2 },
      (_, index) => ({
        id: `screen-${index}`,
        filename: `screen-${index}.html`,
        content: `<!doctype html><html><body>screen ${index}</body></html>`,
      }),
    );

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          activeId="screen-0"
          activeTool="move"
          geometryById={Object.fromEntries(
            screens.map((screen, index) => [
              screen.id,
              { x: index * 1500, y: 0, width: 1440, height: 900 },
            ]),
          )}
          renderScreenContent={(screen) => <div data-live-screen={screen.id} />}
          onPick={() => {}}
        />,
      );
    });

    const requested = new Set(
      vi.mocked(wantPreviewParses).mock.calls.flatMap(([contents]) => contents),
    );
    // The camera opens on the middle of the board.
    expect(requested).toContain(screens[screens.length / 2]!.content);
    expect(requested).not.toContain(screens[0]!.content);
    expect(requested).not.toContain(screens[screens.length - 1]!.content);
  });
});
