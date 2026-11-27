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

const SCREEN_COUNT = 12;
const MOVE_TICKS = 40;
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 300;
const FRAME_GAP = 200;

const screens = Array.from({ length: SCREEN_COUNT }, (_, index) => ({
  id: `screen-${index}`,
  filename: `screen-${index}.html`,
  content: "<html></html>",
}));
const geometryById = Object.fromEntries(
  screens.map((screen, index) => [
    screen.id,
    {
      x: index * (FRAME_WIDTH + FRAME_GAP),
      y: 0,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    },
  ]),
);

describe("object-move redraws on the overview canvas", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const screenId = this.getAttribute("data-screen-iframe-id");
        const frame = screenId ? geometryById[screenId] : undefined;
        const rect = frame ?? { x: 0, y: 0, width: 8000, height: 1400 };
        return {
          ...rect,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
          left: rect.x,
          toJSON: () => ({}),
        };
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  it("moves the drag ghost without redrawing every screen on each tick", async () => {
    const screenRenders = vi.fn();
    let boardRenders = 0;
    const geometry = {
      get geometryById() {
        boardRenders += 1;
        return geometryById;
      },
    };
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={100}
          activeId="screen-0"
          creation={{ activeTool: "move" }}
          editableScreenIds={new Set(screens.map((screen) => screen.id))}
          geometry={geometry}
          renderScreenContent={(screen) => {
            screenRenders(screen.id);
            return (
              <iframe
                data-design-preview-iframe=""
                data-screen-iframe-id={screen.id}
              />
            );
          }}
          onPick={() => {}}
          onCrossScreenElementDrop={() => {}}
        />,
      );
    });

    const sourceIframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="screen-0"]',
    );
    expect(sourceIframe?.contentWindow).toBeTruthy();
    const sendDrag = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:cross-screen-drag",
            screenId: "screen-0",
            selector: ".layer",
            sourceId: "layer",
            sourceDeleteRequestId: "move-request",
            viewportW: FRAME_WIDTH,
            viewportH: FRAME_HEIGHT,
            ...data,
          },
          source: sourceIframe?.contentWindow as unknown as Window,
        }),
      );
    const ghostPosition = () => {
      const ghost = container.querySelector<HTMLElement>(
        "[data-cross-screen-drag-ghost]",
      );
      return ghost ? `${ghost.style.left},${ghost.style.top}` : null;
    };

    const moveTo = (step: number) =>
      act(async () => {
        sendDrag({
          phase: "move",
          iframeX: FRAME_WIDTH + FRAME_GAP + 20 + step * 4,
          iframeY: 40 + step * 2,
        });
      });

    await act(async () => {
      sendDrag({
        phase: "start",
        iframeX: 200,
        iframeY: 150,
        elementRect: { left: 180, top: 130, width: 120, height: 80 },
        pointerOffset: { x: 20, y: 20 },
      });
    });
    await moveTo(0);
    const firstPosition = ghostPosition();
    expect(firstPosition).not.toBeNull();
    screenRenders.mockClear();
    boardRenders = 0;

    const positions = new Set<string>();
    for (let step = 1; step <= MOVE_TICKS; step += 1) {
      await moveTo(step);
      const position = ghostPosition();
      expect(position).not.toBeNull();
      if (position !== null) positions.add(position);
    }

    expect(positions.size).toBe(MOVE_TICKS);
    expect(positions.has(String(firstPosition))).toBe(false);
    expect(boardRenders).toBeLessThanOrEqual(2);
    expect(screenRenders.mock.calls.length).toBe(0);
  });
});
