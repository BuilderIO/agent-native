import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { loading: vi.fn(), dismiss: vi.fn() } }));

import type { PreparedFigImport } from "./fig-client-import";
import {
  discardPendingDesignImports,
  onFigImportParked,
  parkPreparedFigImport,
  takeParkedFigImport,
} from "./pending-import";

function prepared() {
  return { dispose: vi.fn() } as unknown as PreparedFigImport & {
    dispose: ReturnType<typeof vi.fn>;
  };
}

describe("parked .fig imports", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    discardPendingDesignImports();
    vi.useRealTimers();
  });

  it("hands a parked import to the next panel for the same design and notifies listeners", () => {
    const listener = vi.fn();
    const stop = onFigImportParked(listener);
    const parked = prepared();

    parkPreparedFigImport("design-1", parked);

    expect(listener).toHaveBeenCalledWith("design-1");
    expect(takeParkedFigImport("design-2")).toBeUndefined();
    expect(takeParkedFigImport("design-1")).toBe(parked);
    expect(takeParkedFigImport("design-1")).toBeUndefined();
    vi.runAllTimers();
    expect(parked.dispose).not.toHaveBeenCalled();
    stop();
  });

  it("frees an import nobody claims before the timeout", () => {
    const parked = prepared();
    parkPreparedFigImport("design-1", parked);

    vi.advanceTimersByTime(9_999);
    expect(parked.dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(parked.dispose).toHaveBeenCalledOnce();
    expect(takeParkedFigImport("design-1")).toBeUndefined();
  });

  it("frees a replaced import and every parked import when leaving for home", () => {
    const first = prepared();
    const second = prepared();
    const other = prepared();
    parkPreparedFigImport("design-1", first);
    parkPreparedFigImport("design-1", second);
    parkPreparedFigImport("design-2", other);

    expect(first.dispose).toHaveBeenCalledOnce();
    discardPendingDesignImports();

    expect(second.dispose).toHaveBeenCalledOnce();
    expect(other.dispose).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});
