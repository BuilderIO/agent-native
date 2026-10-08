// @vitest-environment happy-dom

import { act, isValidElement, type ReactNode } from "react";
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

const builderMocks = vi.hoisted(() => ({
  configured: false,
  effective: null as "org" | "personal" | "workspace" | "env" | null,
  canConnect: { org: true, personal: true },
  start: vi.fn(),
  status: null as { configured?: boolean; effective?: string } | null,
  statusLoading: false,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  BuilderConnectPopover: ({
    children,
    onConnect,
  }: {
    children: ReactNode;
    onConnect?: (provisionAccount: boolean) => void;
  }) => (
    <>
      {children}
      {onConnect ? (
        <button
          type="button"
          data-testid="builder-connect-existing"
          disabled={
            isValidElement<{ disabled?: boolean }>(children) &&
            children.props.disabled
          }
          onClick={() => onConnect(false)}
        />
      ) : null}
    </>
  ),
  useBuilderConnectFlow: () => ({
    configured: builderMocks.configured,
    connecting: false,
    effective: builderMocks.effective,
    hasFetchedStatus: true,
    canConnect: builderMocks.canConnect,
    start: builderMocks.start,
  }),
  useBuilderStatus: () => ({
    status: builderMocks.status,
    loading: builderMocks.statusLoading,
    refetch: vi.fn(),
  }),
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
    builderMocks.configured = false;
    builderMocks.effective = null;
    builderMocks.canConnect = { org: true, personal: true };
    builderMocks.start.mockReset();
    builderMocks.status = null;
    builderMocks.statusLoading = false;
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

  it.each(["org", "personal"] as const)(
    "waits for the existing %s Builder grant when requesting file-upload access",
    async (scope) => {
      builderMocks.configured = true;
      builderMocks.effective = scope;
      builderMocks.status = { configured: true, effective: scope };
      storageMocks.useReplayStorageStatus.mockReturnValue({
        data: {
          configured: false,
          builderConfigured: true,
          builderUploadConfigured: false,
        },
        isError: false,
        isFetching: false,
        isLoading: false,
        isSuccess: true,
        refetch: storageMocks.refetch,
      });

      await act(async () => {
        root.render(<ReplayStorageHint />);
      });

      expect(container.textContent).toContain(
        "sessions.builderAiConnectedStorageNeedsGrant",
      );
      const connectExisting = container.querySelector<HTMLButtonElement>(
        '[data-testid="builder-connect-existing"]',
      );
      expect(connectExisting).toBeDefined();
      await act(async () => connectExisting?.click());

      expect(builderMocks.start).toHaveBeenCalledExactlyOnceWith({
        provisionAccount: false,
        scope,
      });
    },
  );

  it("uses an allowed personal scope when the existing org grant cannot connect", async () => {
    builderMocks.configured = true;
    builderMocks.effective = "org";
    builderMocks.canConnect = { org: false, personal: true };
    builderMocks.status = { configured: true, effective: "org" };
    storageMocks.useReplayStorageStatus.mockReturnValue({
      data: {
        configured: false,
        builderConfigured: true,
        builderUploadConfigured: false,
      },
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
      refetch: storageMocks.refetch,
    });

    await act(async () => {
      root.render(<ReplayStorageHint />);
    });

    const connectExisting = container.querySelector<HTMLButtonElement>(
      '[data-testid="builder-connect-existing"]',
    );
    await act(async () => connectExisting?.click());

    expect(builderMocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "personal",
    });
  });

  it("asks an owner or admin when no Builder connection scope is available", async () => {
    builderMocks.configured = true;
    builderMocks.effective = "org";
    builderMocks.canConnect = { org: false, personal: false };
    builderMocks.status = { configured: true, effective: "org" };
    storageMocks.useReplayStorageStatus.mockReturnValue({
      data: {
        configured: false,
        builderConfigured: true,
        builderUploadConfigured: false,
      },
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
      refetch: storageMocks.refetch,
    });

    await act(async () => {
      root.render(<ReplayStorageHint />);
    });

    expect(container.textContent).toContain(
      "dataSources.workspaceAdminRequiredDescription",
    );
    const connectExisting = container.querySelector<HTMLButtonElement>(
      '[data-testid="builder-connect-existing"]',
    );
    expect(connectExisting?.disabled).toBe(true);
    await act(async () => connectExisting?.click());

    expect(builderMocks.start).not.toHaveBeenCalled();
  });
});
