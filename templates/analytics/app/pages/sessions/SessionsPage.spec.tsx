// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatSessionDuration,
  sessionDeviceLabel,
  useDebouncedUrlFilter,
} from "./SessionsPage";

let setFilterInput: ((value: string) => void) | null = null;

function DebouncedFilterHarness({
  urlValue,
  onCommit,
}: {
  urlValue: string;
  onCommit: (value: string) => void;
}) {
  const [input, setInput] = useDebouncedUrlFilter(urlValue, onCommit);
  setFilterInput = setInput;
  return <output data-input={input} />;
}

describe("useDebouncedUrlFilter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setFilterInput = null;
    vi.useRealTimers();
  });

  it("does not overwrite a newer keystroke when its own URL update echoes back", () => {
    const onCommit = vi.fn();
    act(() =>
      root.render(<DebouncedFilterHarness urlValue="" onCommit={onCommit} />),
    );

    act(() => setFilterInput?.("a"));
    act(() => vi.advanceTimersByTime(250));
    expect(onCommit).toHaveBeenLastCalledWith("a");

    act(() => setFilterInput?.("ab"));
    act(() =>
      root.render(<DebouncedFilterHarness urlValue="a" onCommit={onCommit} />),
    );

    expect(container.querySelector("output")?.dataset.input).toBe("ab");
    act(() => vi.advanceTimersByTime(250));
    expect(onCommit).toHaveBeenLastCalledWith("ab");
  });

  it("resyncs the input for URL changes that did not originate from the hook", () => {
    const onCommit = vi.fn();
    act(() =>
      root.render(
        <DebouncedFilterHarness urlValue="old" onCommit={onCommit} />,
      ),
    );
    act(() => setFilterInput?.("unfinished"));

    act(() =>
      root.render(
        <DebouncedFilterHarness urlValue="external" onCommit={onCommit} />,
      ),
    );

    expect(container.querySelector("output")?.dataset.input).toBe("external");
    act(() => vi.advanceTimersByTime(250));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("formatSessionDuration", () => {
  it("shows whole-minute labels for session playlist rows", () => {
    expect(formatSessionDuration(13 * 60_000 + 32_000)).toBe("13m");
    expect(formatSessionDuration(2 * 60_000 + 54_000)).toBe("2m");
    expect(formatSessionDuration(52 * 60_000 + 24_000)).toBe("52m");
  });

  it("keeps hour-long labels in hours and minutes", () => {
    expect(formatSessionDuration(2 * 60 * 60_000 + 23 * 60_000)).toBe("2h 23m");
  });

  it("uses minutes for empty or sub-minute durations", () => {
    expect(formatSessionDuration(null)).toBe("0m");
    expect(formatSessionDuration(0)).toBe("0m");
    expect(formatSessionDuration(42_000)).toBe("0m");
  });
});

describe("sessionDeviceLabel", () => {
  it("uses explicit OS metadata when present", () => {
    expect(
      sessionDeviceLabel({
        metadata: { os: { name: "macOS", version: "15.5" } },
      }),
    ).toBe("macOS 15.5");
  });

  it("falls back to user-agent inference", () => {
    expect(
      sessionDeviceLabel({
        metadata: {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }),
    ).toBe("Windows");
  });

  it("returns null when no OS signal is available", () => {
    expect(sessionDeviceLabel({ metadata: {} })).toBeNull();
  });
});
