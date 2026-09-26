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
vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupCard: () => <div data-storage-setup="true" />,
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
  DesignModeTab: () => null,
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
    refetch: vi.fn(),
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

  it("keeps uploads disabled while the status is loading", async () => {
    setUploadStatus();
    await renderControls();

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
    expect(container.textContent).not.toContain("Retry");
  });

  it("offers a status retry on error without showing setup", async () => {
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
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeTruthy();
    await act(async () => retry?.click());
    expect(status.refetch).toHaveBeenCalledOnce();
  });

  it("shows setup only after status confirms storage is missing", async () => {
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
    expect(container.querySelector("[data-storage-setup]")).not.toBeNull();
    expect(container.textContent).not.toContain("Retry");
  });

  it("enables image upload only after status confirms storage is configured", async () => {
    setUploadStatus({
      data: { configured: true },
      isSuccess: true,
      isLoading: false,
      isFetching: false,
    });
    await renderControls();

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(false);
    expect(container.querySelector("[data-storage-setup]")).toBeNull();
  });
});

describe("DesignBottomToolbar file storage gate", () => {
  const renderToolbar = () =>
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
        onModeChange={vi.fn()}
        shortcutsPanelOpen={false}
      />,
    );

  async function openImageVideoGate() {
    const imageVideo = container.querySelector<HTMLButtonElement>(
      '[data-option="image-video"]',
    );
    expect(imageVideo).toBeTruthy();
    await act(async () => imageVideo?.click());
  }

  it("shows retry instead of setup when status is unavailable", async () => {
    setUploadStatus();
    await renderToolbar();

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    await openImageVideoGate();
    expect(container.querySelector("[data-dialog]")).toBeNull();

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
    expect(container.textContent).toContain("Something went wrong");
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

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
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
