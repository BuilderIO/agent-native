// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatSessionDuration,
  ReplayStorageHint,
  useDebouncedUrlFilter,
} from "./SessionsPage";

const storageMocks = vi.hoisted(() => ({
  useReplayStorageStatus: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  BuilderConnectPopover: ({ children }: { children: ReactNode }) => children,
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: false,
    hasFetchedStatus: true,
    start: vi.fn(),
  }),
  useBuilderStatus: () => ({ status: null, loading: false, refetch: vi.fn() }),
}));

vi.mock("@/hooks/use-replay-storage-status", () => ({
  useReplayStorageStatus: () => storageMocks.useReplayStorageStatus(),
}));

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
    expect(formatSessionDuration(59_499)).toBe("0m");
    expect(formatSessionDuration(59_500)).toBe("1m");
  });
});

describe("ReplayStorageHint", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    storageMocks.refetch.mockReset();
    storageMocks.useReplayStorageStatus.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isLoading: false,
      isSuccess: false,
      refetch: storageMocks.refetch,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps Builder and S3 setup available when storage status fails", async () => {
    await act(async () => {
      root.render(<ReplayStorageHint />);
    });

    expect(container.textContent).toContain(
      "sessions.storageStatusUnavailable",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("sidebar.retry"),
    );
    expect(retry).toBeDefined();

    const configureS3 = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("sessions.configureS3"),
    );
    expect(configureS3).toBeDefined();
    expect(container.textContent).toContain("sessions.connectBuilder");

    act(() => retry?.click());
    expect(storageMocks.refetch).toHaveBeenCalledOnce();

    await act(async () => {
      configureS3?.click();
    });
    expect(container.querySelector("#replay-S3_ENDPOINT")).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("settings.saveStorage"),
      ),
    ).toBe(true);
  });
});
