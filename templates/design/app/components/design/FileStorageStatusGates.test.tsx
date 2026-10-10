// @vitest-environment happy-dom

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadStatus = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => uploadStatus.value,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "common.genericError": "Something went wrong",
      "agentChat.common.retry": "Retry",
      "onboarding.fileStorage.title": "Connect storage to upload files",
    })[key] ?? key,
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: ({
    open,
    status,
    onRetry,
  }: {
    open: boolean;
    status?: string;
    onRetry?: () => void;
  }) =>
    open ? (
      <div
        data-dialog="true"
        data-storage-setup={status === "unavailable" ? undefined : "true"}
      >
        {status === "unavailable"
          ? "Couldn't check storage"
          : "Connect storage to upload files"}
        {status === "unavailable" ? (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    ) : null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => (
    <button {...props} className={className}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  SelectValue: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-dialog="true">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/components/design/editor/toolbar-controls", () => ({
  DesignModeTab: ({
    active,
    label,
    onClick,
  }: {
    active: boolean;
    label: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    />
  ),
  DesignPenToolIcon: () => null,
  DesignToolbarTool: ({
    options,
  }: {
    options: Array<{ key: string; label: string; onSelect: () => void }>;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-option={option.key}
          onClick={option.onSelect}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/design/inspector/design-icons", () => ({
  IconText: () => null,
}));
vi.mock("@/components/design/keyboard-shortcuts", () => ({
  formatShortcutLabel: () => "",
}));
vi.mock("@/hooks/use-shortcut-label", () => ({
  useApplePlatform: () => false,
}));

import { DesignBottomToolbar } from "./editor/DesignBottomToolbar";
import { ImageFillControls } from "./inspector/ImageFillControls";

type UploadStatus = {
  data?: { configured: boolean };
  isSuccess: boolean;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

let root: Root;
let container: HTMLDivElement;

function setUploadStatus(overrides: Partial<UploadStatus> = {}) {
  const status: UploadStatus = {
    data: undefined,
    isSuccess: false,
    isError: false,
    isLoading: true,
    isFetching: true,
    refetch: vi.fn().mockResolvedValue({ isSuccess: false }),
    ...overrides,
  };
  uploadStatus.value = status;
  return status;
}

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setUploadStatus();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe("ImageFillControls file storage gate", () => {
  const renderControls = () =>
    render(
      <ImageFillControls value={{ url: "", fit: "fill" }} onChange={vi.fn()} />,
    );

  it("keeps storage UI hidden until an unresolved upload attempt", async () => {
    const status = setUploadStatus({
      refetch: vi
        .fn()
        .mockResolvedValue({ isSuccess: true, data: { configured: true } }),
    });
    await renderControls();

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.disabled).toBe(true);
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
    const pickerClick = vi.spyOn(input, "click").mockImplementation(() => {});
    const upload = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Upload image"]',
    );
    expect(upload?.disabled).toBe(false);
    await act(async () => upload?.click());
    expect(pickerClick).not.toHaveBeenCalled();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeTruthy();
    await act(async () => retry?.click());
    expect(status.refetch).toHaveBeenCalledOnce();
    expect(pickerClick).not.toHaveBeenCalled();
  });

  it("offers status retry only after an upload attempt when status fails", async () => {
    const status = setUploadStatus({
      isError: true,
      isLoading: false,
      isFetching: false,
    });
    await renderControls();

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Upload image"]')
        ?.click(),
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeTruthy();
    await act(async () => retry?.click());
    expect(status.refetch).toHaveBeenCalledOnce();
  });

  it("shows no setup until the user requests an image upload", async () => {
    setUploadStatus({
      data: { configured: false },
      isSuccess: true,
      isLoading: false,
      isFetching: false,
    });
    await renderControls();

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Upload image"]')
        ?.click(),
    );
    expect(container.querySelector("[data-storage-setup]")).not.toBeNull();
    expect(container.textContent).not.toContain("Retry");
  });

  it("opens the picker after status confirms storage is configured", async () => {
    setUploadStatus({
      data: { configured: true },
      isSuccess: true,
      isLoading: false,
      isFetching: false,
    });
    await renderControls();

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.disabled).toBe(false);
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Upload image"]')
        ?.click(),
    );
    expect(click).toHaveBeenCalledOnce();
  });
});

describe("DesignBottomToolbar file storage gate", () => {
  const renderToolbar = (
    modeProps: {
      showModeTabs?: boolean;
      canComment?: boolean;
      onModeChange?: (mode: string) => void;
    } = {},
  ) =>
    render(
      <DesignBottomToolbar
        mode="edit"
        pinMode={false}
        drawMode={false}
        activeTool="move"
        shapeTool="rect"
        isOverview={false}
        hasActiveFile
        onMove={vi.fn()}
        onFrame={vi.fn()}
        frameToolDraws="screen"
        onFrameToolDrawsChange={vi.fn()}
        onShape={vi.fn()}
        onText={vi.fn()}
        onPen={vi.fn()}
        onHand={vi.fn()}
        onDraw={vi.fn()}
        onScale={vi.fn()}
        onMediaFiles={vi.fn()}
        onCommentPin={vi.fn()}
        canComment={modeProps.canComment ?? true}
        onModeChange={modeProps.onModeChange ?? vi.fn()}
        showModeTabs={modeProps.showModeTabs ?? false}
      />,
    );

  it("carries the mode tabs only where the top bar is absent", async () => {
    setUploadStatus();
    const onModeChange = vi.fn();
    await renderToolbar({ showModeTabs: false, onModeChange });
    for (const label of [
      "designEditor.modes.annotate",
      "designEditor.modes.edit",
      "designEditor.modes.interact",
    ]) {
      expect(
        container.querySelector(`button[aria-label="${label}"]`),
      ).toBeNull();
    }

    await renderToolbar({ showModeTabs: true, onModeChange });
    const interact = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.modes.interact"]',
    );
    expect(interact).toBeTruthy();
    expect(
      container
        .querySelector('button[aria-label="designEditor.modes.edit"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () => interact?.click());
    expect(onModeChange).toHaveBeenCalledWith("interact");
  });

  it("leaves out comments and annotation where a widget ticket cannot write them", async () => {
    setUploadStatus();
    const option = (key: string) =>
      container.querySelector(`[data-option="${key}"]`);
    const modeTab = (mode: string) =>
      container.querySelector(
        `button[aria-label="designEditor.modes.${mode}"]`,
      );

    await renderToolbar({ showModeTabs: true, canComment: true });
    expect(option("comment")).toBeTruthy();
    expect(option("draw")).toBeTruthy();
    expect(modeTab("annotate")).toBeTruthy();

    await renderToolbar({ showModeTabs: true, canComment: false });
    expect(option("comment")).toBeNull();
    expect(option("draw")).toBeNull();
    expect(modeTab("annotate")).toBeNull();
    for (const key of ["move", "frame", "rect", "pen", "text"]) {
      expect(option(key), key).toBeTruthy();
    }
    expect(modeTab("edit")).toBeTruthy();
    expect(modeTab("interact")).toBeTruthy();
  });

  async function openImageVideoGate() {
    const imageVideo = container.querySelector<HTMLButtonElement>(
      '[data-option="image-video"]',
    );
    expect(imageVideo).toBeTruthy();
    await act(async () => imageVideo?.click());
  }

  it("shows retry instead of setup while status is unresolved", async () => {
    const initialStatus = setUploadStatus();
    await renderToolbar();

    expect(container.querySelector("[data-dialog]")).toBeNull();
    await openImageVideoGate();
    expect(container.querySelector("[data-dialog]")).not.toBeNull();
    const pendingRetry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(pendingRetry).toBeTruthy();
    await act(async () => pendingRetry?.click());
    expect(initialStatus.refetch).toHaveBeenCalledOnce();

    const status = setUploadStatus({
      isError: true,
      isLoading: false,
      isFetching: false,
    });
    await renderToolbar();

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector("[data-dialog]")).not.toBeNull();
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
    expect(container.textContent).toContain("Couldn't check storage");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeTruthy();
    await act(async () => retry?.click());
    expect(status.refetch).toHaveBeenCalledOnce();
  });

  it("opens setup only when status confirms storage is missing", async () => {
    setUploadStatus({
      data: { configured: false },
      isSuccess: true,
      isLoading: false,
      isFetching: false,
    });
    await renderToolbar();

    expect(container.querySelector("[data-dialog]")).toBeNull();
    await openImageVideoGate();
    expect(container.querySelector("[data-storage-setup]")).not.toBeNull();
    expect(container.textContent).not.toContain("Retry");
  });

  it("enables media selection only after status confirms storage is configured", async () => {
    setUploadStatus({
      data: { configured: true },
      isSuccess: true,
      isLoading: false,
      isFetching: false,
    });
    await renderToolbar();

    const mediaInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(mediaInput?.disabled).toBe(false);
    const click = vi.spyOn(mediaInput!, "click");
    await openImageVideoGate();
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
  });
});
