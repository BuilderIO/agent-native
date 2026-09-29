// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setPendingUploadFile: vi.fn(),
  storageStatus: vi.fn(),
  toastError: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/setup-connections", () => ({
  FileStorageSetupPopover: ({
    open,
    status,
    onRetry,
    onConnected,
  }: {
    open: boolean;
    status?: string;
    onRetry?: () => void;
    onConnected?: () => void;
  }) =>
    open ? (
      <div role="dialog" data-testid="storage-dialog" data-status={status}>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
        <button type="button" onClick={onConnected}>
          Connected
        </button>
      </div>
    ) : null,
}));
vi.mock("@/hooks/use-video-storage-status", () => ({
  useVideoStorageStatus: mocks.storageStatus,
}));
vi.mock("@/lib/pending-upload-file", () => ({
  setPendingUploadFile: mocks.setPendingUploadFile,
}));

import { useUploadVideoPicker } from "./use-upload-video-picker";

function PickerProbe() {
  const picker = useUploadVideoPicker();
  return (
    <>
      <button onClick={() => picker.openUploadPicker("/projects/new")}>
        Upload
      </button>
      {picker.input}
    </>
  );
}

describe("useUploadVideoPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.navigate.mockReset();
    mocks.setPendingUploadFile.mockReset();
    mocks.toastError.mockReset();
    mocks.toast.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(storageStatus: unknown) {
    mocks.storageStatus.mockReturnValue(storageStatus);
    act(() => root.render(<PickerProbe />));
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.fn();
    input.click = click;
    return { input, click, uploadButton: container.querySelector("button")! };
  }

  function selectFile(input: HTMLInputElement) {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["video"], "clip.mp4", { type: "video/mp4" })],
    });
    return act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("opens setup only after upload intent when storage is confirmed missing", () => {
    const { click, uploadButton } = render({
      data: { configured: false },
      isError: false,
      refetch: vi.fn(),
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => uploadButton.click());

    expect(click).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("offers a fresh upload click after storage connects", async () => {
    const refetch = vi.fn().mockResolvedValue({
      data: { configured: true },
      isError: false,
    });
    const { input, click, uploadButton } = render({
      data: { configured: false },
      isError: false,
      isSuccess: true,
      refetch,
    });

    act(() => uploadButton.click());
    expect(click).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    mocks.storageStatus.mockReturnValue({
      data: { configured: true },
      isError: false,
      isSuccess: true,
      refetch,
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-dialog"] button',
        )!
        .click();
      await Promise.resolve();
    });
    act(() => root.render(<PickerProbe />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const [message, options] = mocks.toast.mock.calls[0];
    expect(message).toBe("preRecord.import");
    act(() => options.action.onClick());
    expect(click).toHaveBeenCalledOnce();
    await selectFile(input);

    expect(mocks.setPendingUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "clip.mp4" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/projects/new");
    expect(click).toHaveBeenCalledOnce();
  });

  it("blocks the file picker when storage status is unavailable and offers retry", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const refetch = vi.fn().mockResolvedValue({
      data: undefined,
      isError: true,
    });
    const failure = render({
      data: undefined,
      isError: true,
      isSuccess: false,
      refetch,
    });
    act(() => failure.uploadButton.click());
    expect(failure.click).not.toHaveBeenCalled();
    expect(
      container
        .querySelector('[data-testid="storage-dialog"]')
        ?.getAttribute("data-status"),
    ).toBe("unavailable");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          "[data-testid=storage-dialog] button",
        )!
        .click();
      await Promise.resolve();
    });
    expect(refetch).toHaveBeenCalledOnce();
    Object.defineProperty(failure.input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      failure.input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.setPendingUploadFile).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
