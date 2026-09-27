// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import type { VideoRedaction } from "@/lib/video-redactions";

import { RedactionLane } from "./redaction-lane";

const DURATION = 10_000;
const WIDTH = 1_000;

const redaction: VideoRedaction = {
  id: "r1",
  kind: "redact",
  style: "solid",
  startMs: 2_000,
  endMs: 4_000,
  keys: [{ atMs: 2_000, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
};

function pointer(
  target: Element,
  type: string,
  clientX: number,
  init: { shiftKey?: boolean } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("dragging a redaction's edges", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onCommit: Mock<(next: VideoRedaction[]) => void>;

  const render = (redactions: VideoRedaction[]) => {
    act(() => {
      root.render(
        <RedactionLane
          width={WIDTH}
          durationMs={DURATION}
          redactions={redactions}
          selectedId={null}
          onSelect={vi.fn()}
          onPreview={vi.fn()}
          onCommit={onCommit}
        />,
      );
    });
  };

  const lane = () => container.firstElementChild!;
  const grip = (label: string) =>
    container.querySelector(`[aria-label="${label}"]`) as HTMLElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: WIDTH,
      bottom: 22,
      width: WIDTH,
      height: 22,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    onCommit = vi.fn<(next: VideoRedaction[]) => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("moves the end where it is dragged", () => {
    render([redaction]);
    const end = grip("redaction.endsAt");

    act(() => {
      pointer(end, "pointerdown", 400);
      pointer(lane(), "pointermove", 700);
      pointer(lane(), "pointerup", 700);
    });

    expect(onCommit.mock.calls[0][0][0]).toMatchObject({ endMs: 7_000 });
  });

  it("stops the end at the end of the clip, however far the pointer goes", () => {
    render([redaction]);
    const end = grip("redaction.endsAt");

    act(() => {
      pointer(end, "pointerdown", 400);
      pointer(lane(), "pointermove", 4_000);
      pointer(lane(), "pointerup", 4_000);
    });

    expect(onCommit.mock.calls[0][0][0]).toMatchObject({ endMs: DURATION });
  });

  it("stops the start at the beginning", () => {
    render([redaction]);
    const start = grip("redaction.startsAt");

    act(() => {
      pointer(start, "pointerdown", 200);
      pointer(lane(), "pointermove", -900);
      pointer(lane(), "pointerup", -900);
    });

    expect(onCommit.mock.calls[0][0][0]).toMatchObject({ startMs: 0 });
  });

  it("pins a waypoint where the bar is clicked", () => {
    render([redaction]);
    const bar = container.querySelector('[role="button"]')!;

    act(() => {
      pointer(bar, "pointerdown", 300);
      pointer(bar, "pointerup", 300);
    });

    expect(onCommit.mock.calls[0][0][0].keys.map((k) => k.atMs)).toEqual([
      2_000, 3_000,
    ]);
  });

  it("does not pin one when the press was a drag", () => {
    render([redaction]);
    const bar = container.querySelector('[role="button"]')!;

    act(() => {
      pointer(bar, "pointerdown", 300);
      pointer(bar, "pointerup", 380);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not pin one where there is already a waypoint", () => {
    render([redaction]);
    const bar = container.querySelector('[role="button"]')!;

    act(() => {
      pointer(bar, "pointerdown", 200, { shiftKey: true });
      pointer(bar, "pointerup", 200, { shiftKey: true });
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("removes a waypoint when it is pressed twice", () => {
    const twoKeys: VideoRedaction = {
      ...redaction,
      keys: [
        { atMs: 2_000, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { atMs: 3_000, x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      ],
    };
    render([twoKeys]);
    const diamond = container.querySelectorAll(
      '[aria-label^="redaction.waypoint"]',
    )[1];

    act(() => {
      pointer(diamond, "pointerdown", 300);
      pointer(lane(), "pointerup", 300);
      pointer(diamond, "pointerdown", 300);
    });

    expect(onCommit.mock.calls[0][0][0].keys.map((k) => k.atMs)).toEqual([
      2_000,
    ]);
  });

  it("keeps the last waypoint, since a box has to be somewhere", () => {
    render([redaction]);
    const diamond = container.querySelector(
      '[aria-label^="redaction.waypoint"]',
    )!;

    act(() => {
      pointer(diamond, "pointerdown", 200);
      pointer(lane(), "pointerup", 200);
      pointer(diamond, "pointerdown", 200);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("draws a bar that has run past the end no wider than the track", () => {
    render([{ ...redaction, startMs: 9_000, endMs: 40_000 }]);
    const bar = container.querySelector('[role="button"]') as HTMLElement;
    const left = Number.parseFloat(bar.style.left);
    const width = Number.parseFloat(bar.style.width);
    expect(left + width).toBeLessThanOrEqual(WIDTH);
  });
});
