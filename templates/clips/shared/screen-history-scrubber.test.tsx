// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatScreenHistoryOffset,
  moveScreenHistoryEdge,
  ScreenHistoryScrubber,
  type ScreenHistoryScrubberProps,
  screenHistoryMsAtFraction,
  screenHistoryOffsetSeconds,
  screenHistoryPercent,
  screenHistoryPlayheadPercent,
} from "./screen-history-scrubber";

// Five minutes of history ending at the recording start.
const original = {
  startedAt: "2026-10-09T10:00:00.000Z",
  endedAt: "2026-10-09T10:05:00.000Z",
};

const at = (time: string) => `2026-10-09T${time}.000Z`;

describe("screen history scrubber math", () => {
  it("formats offsets before the recording start", () => {
    expect(formatScreenHistoryOffset(0)).toBe("0:00");
    expect(formatScreenHistoryOffset(12)).toBe("−0:12");
    expect(formatScreenHistoryOffset(65)).toBe("−1:05");
    expect(formatScreenHistoryOffset(300)).toBe("−5:00");
  });

  it("counts offsets back from the widest window's end", () => {
    expect(screenHistoryOffsetSeconds(original, at("10:04:48"))).toBe(12);
    expect(screenHistoryOffsetSeconds(original, original.endedAt)).toBe(0);
    expect(screenHistoryOffsetSeconds(original, original.startedAt)).toBe(300);
  });

  it("places an instant along the timeline as a percentage", () => {
    expect(screenHistoryPercent(original, original.startedAt)).toBe(0);
    expect(screenHistoryPercent(original, at("10:02:30"))).toBe(50);
    expect(screenHistoryPercent(original, original.endedAt)).toBe(100);
  });

  it("keeps the playhead on the track while a preview is still settling", () => {
    expect(screenHistoryPlayheadPercent(original, at("10:02:30"))).toBe(50);
    expect(screenHistoryPlayheadPercent(original, at("09:59:00"))).toBe(0);
    expect(screenHistoryPlayheadPercent(original, at("10:06:00"))).toBe(100);
  });

  it("snaps pointer positions to whole seconds and clamps to the timeline", () => {
    expect(screenHistoryMsAtFraction(original, 0.5)).toBe(
      Date.parse(at("10:02:30")),
    );
    // 0.1234 of 300 s is 37.02 s after the start, so it snaps to 37 s.
    expect(screenHistoryMsAtFraction(original, 0.1234)).toBe(
      Date.parse(at("10:00:37")),
    );
    expect(screenHistoryMsAtFraction(original, -1)).toBe(
      Date.parse(original.startedAt),
    );
    expect(screenHistoryMsAtFraction(original, 2)).toBe(
      Date.parse(original.endedAt),
    );
  });

  it("moves one edge by a step and keeps the other edge fixed", () => {
    const next = moveScreenHistoryEdge(
      original,
      original,
      "start",
      Date.parse(original.startedAt) + 1000,
    );
    expect(next).toEqual({
      startedAt: at("10:00:01"),
      endedAt: original.endedAt,
    });
  });

  it("clamps the start edge to the widest window and to one second before the end", () => {
    const belowOriginal = moveScreenHistoryEdge(
      original,
      original,
      "start",
      Date.parse(original.startedAt) - 60_000,
    );
    expect(belowOriginal.startedAt).toBe(original.startedAt);

    const pastEnd = moveScreenHistoryEdge(
      original,
      original,
      "start",
      Date.parse(original.endedAt) + 60_000,
    );
    expect(pastEnd.startedAt).toBe(at("10:04:59"));
  });

  it("clamps the end edge to the widest window and to one second after the start", () => {
    const narrow = { startedAt: at("10:01:00"), endedAt: at("10:02:00") };

    const pastOriginal = moveScreenHistoryEdge(
      original,
      narrow,
      "end",
      Date.parse(original.endedAt) + 60_000,
    );
    expect(pastOriginal.endedAt).toBe(original.endedAt);

    const beforeStart = moveScreenHistoryEdge(
      original,
      narrow,
      "end",
      Date.parse(narrow.startedAt),
    );
    expect(beforeStart.endedAt).toBe(at("10:01:01"));
  });

  it("refuses a selection that already sits outside the widest window", () => {
    const outside = { startedAt: at("09:59:00"), endedAt: at("10:01:00") };
    expect(() =>
      moveScreenHistoryEdge(
        original,
        outside,
        "end",
        Date.parse(at("10:00:30")),
      ),
    ).toThrow();
  });
});

describe("ScreenHistoryScrubber", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Partial<ScreenHistoryScrubberProps> = {}) {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <ScreenHistoryScrubber
          original={original}
          value={original}
          onChange={onChange}
          {...props}
        />,
      ),
    );
    return { onChange };
  }

  function handle(edge: "start" | "end") {
    const el = container.querySelector<HTMLElement>(
      `[role="slider"][data-edge="${edge}"]`,
    );
    if (!el) throw new Error(`No ${edge} handle rendered`);
    return el;
  }

  it("shows the offsets and the selected length", () => {
    render();
    expect(handle("start").getAttribute("aria-valuetext")).toBe("−5:00");
    expect(handle("end").getAttribute("aria-valuetext")).toBe("0:00");
    expect(container.textContent).toContain("5 min");
  });

  it("highlights the selection and draws the playhead only when given one", () => {
    render({ value: { startedAt: at("10:01:00"), endedAt: at("10:02:00") } });
    const selection = container.querySelector<HTMLElement>("[data-selection]");
    expect(selection?.style.left).toBe("20%");
    expect(selection?.style.width).toBe("20%");
    expect(container.querySelector("[data-playhead]")).toBeNull();

    act(() =>
      root.render(
        <ScreenHistoryScrubber
          original={original}
          value={original}
          onChange={vi.fn()}
          playhead={at("10:02:30")}
        />,
      ),
    );
    expect(
      container.querySelector<HTMLElement>("[data-playhead]")?.style.left,
    ).toBe("50%");
  });

  it("moves the start handle one second with the arrow keys and five with Shift", () => {
    const { onChange } = render();
    act(() => {
      handle("start").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith({
      startedAt: at("10:00:01"),
      endedAt: original.endedAt,
    });

    act(() => {
      handle("start").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith({
      startedAt: at("10:00:05"),
      endedAt: original.endedAt,
    });
  });

  it("moves the end handle with Shift+ArrowLeft", () => {
    const { onChange } = render();
    act(() => {
      handle("end").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith({
      startedAt: original.startedAt,
      endedAt: at("10:04:55"),
    });
  });

  it("ignores keys while disabled", () => {
    const { onChange } = render({ disabled: true });
    act(() => {
      handle("start").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(handle("start").getAttribute("aria-disabled")).toBe("true");
  });
});
