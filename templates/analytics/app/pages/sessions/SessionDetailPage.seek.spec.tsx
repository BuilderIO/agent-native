// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReplaySeekOnOffsetChange } from "./SessionDetailPage";

function ReplaySeekUpdateHarness({
  initialSeekMs,
  onSeek,
}: {
  initialSeekMs: number | null;
  onSeek: (ms: number) => void;
}) {
  useReplaySeekOnOffsetChange(initialSeekMs, onSeek);
  return null;
}

describe("useReplaySeekOnOffsetChange", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("seeks changed query offsets and resets to the start when cleared", () => {
    const onSeek = vi.fn();
    act(() =>
      root.render(
        <ReplaySeekUpdateHarness initialSeekMs={1_000} onSeek={onSeek} />,
      ),
    );
    expect(onSeek).not.toHaveBeenCalled();

    act(() =>
      root.render(
        <ReplaySeekUpdateHarness initialSeekMs={2_000} onSeek={onSeek} />,
      ),
    );
    expect(onSeek).toHaveBeenLastCalledWith(2_000);

    act(() =>
      root.render(
        <ReplaySeekUpdateHarness initialSeekMs={2_000} onSeek={onSeek} />,
      ),
    );
    expect(onSeek).toHaveBeenCalledTimes(1);

    act(() =>
      root.render(
        <ReplaySeekUpdateHarness initialSeekMs={null} onSeek={onSeek} />,
      ),
    );
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });
});
