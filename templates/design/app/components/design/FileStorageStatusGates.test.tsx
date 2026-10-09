// @vitest-environment happy-dom

import type {
  ButtonHTMLAttributes,
  ComponentProps,
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
  useT: () => (key: string, options?: Record<string, unknown>) =>
    ({
      "common.genericError": "Something went wrong",
      "agentChat.common.retry": "Retry",
      "editPanel.colorPicker.chooseImage": "Choose image…",
      "onboarding.fileStorage.title": "Connect storage to upload files",
    })[key] ?? (options ? `${key} ${JSON.stringify(options)}` : key),
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
    groupId,
    active,
    label,
    optionsLabel,
    options,
    onPrimary,
  }: {
    groupId: string;
    active: boolean;
    label: string;
    optionsLabel: string;
    options: Array<{
      key: string;
      label: string;
      shortcut?: string;
      dimmed?: boolean;
      separatorBefore?: boolean;
      onSelect: () => void;
    }>;
    onPrimary: () => void;
  }) => (
    <div data-group={groupId} data-options-label={optionsLabel}>
      <button
        type="button"
        data-main={groupId}
        aria-label={label}
        aria-pressed={active}
        onClick={onPrimary}
      />
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-option={option.key}
          data-shortcut={option.shortcut}
          data-dimmed={String(Boolean(option.dimmed))}
          data-separator-before={String(Boolean(option.separatorBefore))}
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
  const chooseImageButton = () =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith("Choose image"),
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
    const upload = chooseImageButton();
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
    await act(async () => chooseImageButton()?.click());
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
    await act(async () => chooseImageButton()?.click());
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
    await act(async () => chooseImageButton()?.click());
    expect(click).toHaveBeenCalledOnce();
  });
});

describe("DesignBottomToolbar", () => {
  type ToolbarProps = ComponentProps<typeof DesignBottomToolbar>;
  const renderToolbar = (overrides: Partial<ToolbarProps> = {}) =>
    render(
      <DesignBottomToolbar
        mode="edit"
        drawMode={false}
        activeTool="move"
        hasActiveFile
        frameToolDraws="frame"
        onFrameToolDrawsChange={vi.fn()}
        onMove={vi.fn()}
        onInteractMove={vi.fn()}
        onHand={vi.fn()}
        onScale={vi.fn()}
        onFrame={vi.fn()}
        onText={vi.fn()}
        onShape={vi.fn()}
        onMediaFiles={vi.fn()}
        onPen={vi.fn()}
        onDraw={vi.fn()}
        onAgentTool={vi.fn()}
        onAgentSkill={vi.fn()}
        onModeChange={vi.fn()}
        showModeTabs={false}
        annotateEnabled
        {...overrides}
      />,
    );
  const groups = () =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-group]")).map(
      (group) => group.dataset.group,
    );
  const optionKeys = (group: string) =>
    Array.from(
      container.querySelectorAll<HTMLElement>(
        `[data-group="${group}"] [data-option]`,
      ),
    ).map((item) => item.dataset.option);
  const option = (key: string) =>
    container.querySelector<HTMLButtonElement>(`[data-option="${key}"]`);
  const mainButton = (group: string) =>
    container.querySelector<HTMLButtonElement>(`[data-main="${group}"]`);

  it("offers Move, Frame, Pen and Agent in Design, with no Comment tool", async () => {
    await renderToolbar();

    expect(groups()).toEqual(["move", "frame", "pen", "agent"]);
    expect(option("comment")).toBeNull();
    expect(container.textContent).not.toContain("pinComment");
  });

  it("narrows to Move and Agent in Interact, and Move keeps the Interact mode", async () => {
    const onMove = vi.fn();
    const onInteractMove = vi.fn();
    await renderToolbar({ mode: "interact", onMove, onInteractMove });

    expect(groups()).toEqual(["move", "agent"]);
    expect(optionKeys("move")).toEqual([]);
    expect(mainButton("move")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => mainButton("move")?.click());
    expect(onInteractMove).toHaveBeenCalledOnce();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("lists the Move group as Move, Hand and Scale", async () => {
    await renderToolbar();

    expect(optionKeys("move")).toEqual(["move", "hand", "scale"]);
  });

  it("scrolls sideways on a phone without handing the swipe to browser history", async () => {
    await renderToolbar();

    const toolbar = container.querySelector<HTMLElement>(
      "[data-design-bottom-toolbar]",
    );
    expect(toolbar?.classList.contains("overflow-x-auto")).toBe(true);
    expect(toolbar?.classList.contains("overscroll-x-contain")).toBe(true);
  });

  it.each([
    ["move", "designEditor.tools.move", "onMove"],
    ["hand", "designEditor.tools.hand", "onHand"],
    ["scale", "designEditor.tools.scale", "onScale"],
  ] as const)(
    "projects the armed %s sub-tool onto the Move button and runs it on click",
    async (activeTool, label, handler) => {
      const handlers = {
        onMove: vi.fn(),
        onHand: vi.fn(),
        onScale: vi.fn(),
      };
      await renderToolbar({ activeTool, ...handlers });

      expect(mainButton("move")?.getAttribute("aria-label")).toBe(label);
      expect(mainButton("move")?.getAttribute("aria-pressed")).toBe("true");
      await act(async () => mainButton("move")?.click());
      expect(handlers[handler]).toHaveBeenCalledOnce();
      for (const other of Object.values(handlers)) {
        if (other !== handlers[handler]) expect(other).not.toHaveBeenCalled();
      }
    },
  );

  it("lists the Frame group as Frame, Text, Screen, Image/video, then the shapes after a divider", async () => {
    await renderToolbar();

    expect(optionKeys("frame")).toEqual([
      "frame",
      "text",
      "screen",
      "image-video",
      "rect",
      "line",
      "arrow",
      "ellipse",
      "polygon",
      "star",
    ]);
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '[data-group="frame"] [data-separator-before="true"]',
        ),
      ).map((item) => item.dataset.option),
    ).toEqual(["rect"]);
  });

  it("arms the Frame group's variants through the right handlers", async () => {
    const onFrame = vi.fn();
    const onFrameToolDrawsChange = vi.fn();
    const onText = vi.fn();
    const onShape = vi.fn();
    await renderToolbar({
      onFrame,
      onFrameToolDrawsChange,
      onText,
      onShape,
    });

    await act(async () => option("screen")?.click());
    expect(onFrameToolDrawsChange).toHaveBeenLastCalledWith("screen");
    expect(onFrame).toHaveBeenCalledOnce();
    await act(async () => option("text")?.click());
    expect(onText).toHaveBeenCalledOnce();
    await act(async () => option("star")?.click());
    expect(onShape).toHaveBeenLastCalledWith("star");
  });

  it("shows the armed Frame variant on the main button and keeps it once another tool is armed", async () => {
    await renderToolbar({ activeTool: "rect" });
    expect(mainButton("frame")?.getAttribute("aria-label")).toBe(
      "designEditor.tools.rect",
    );
    expect(mainButton("frame")?.getAttribute("aria-pressed")).toBe("true");

    await renderToolbar({ activeTool: "move" });
    expect(mainButton("frame")?.getAttribute("aria-label")).toBe(
      "designEditor.tools.rect",
    );
    expect(mainButton("frame")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("names every chevron after its group, not after the armed variant", async () => {
    await renderToolbar({ activeTool: "ellipse" });

    const optionsLabel = (group: string) =>
      container
        .querySelector<HTMLElement>(`[data-group="${group}"]`)
        ?.getAttribute("data-options-label");
    expect(optionsLabel("frame")).toBe(
      'designEditor.tools.options {"tool":"designEditor.tools.frame"}',
    );
    expect(optionsLabel("agent")).toBe(
      'designEditor.tools.options {"tool":"designEditor.tools.agent"}',
    );
  });

  it("lists the Agent skills without shortcuts and sends the one picked", async () => {
    const onAgentSkill = vi.fn();
    await renderToolbar({ onAgentSkill });

    expect(optionKeys("agent")).toEqual(["inspiration", "debug", "polish"]);
    for (const key of ["inspiration", "debug", "polish"]) {
      expect(option(key)?.hasAttribute("data-shortcut")).toBe(false);
    }
    await act(async () => option("debug")?.click());
    expect(onAgentSkill).toHaveBeenCalledExactlyOnceWith("debug");
  });

  it("arms the Agent tool from its main button", async () => {
    const onAgentTool = vi.fn();
    await renderToolbar({ onAgentTool, activeTool: "agent" });

    expect(mainButton("agent")?.getAttribute("aria-pressed")).toBe("true");
    expect(mainButton("move")?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => mainButton("agent")?.click());
    expect(onAgentTool).toHaveBeenCalledOnce();
  });

  it("dims Image/video until storage is configured but keeps it clickable", async () => {
    await renderToolbar();
    expect(option("image-video")?.getAttribute("data-dimmed")).toBe("true");

    setUploadStatus({
      data: { configured: true },
      isSuccess: true,
      isLoading: false,
      isFetching: false,
    });
    await renderToolbar();
    expect(option("image-video")?.getAttribute("data-dimmed")).toBe("false");
  });

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

  it("offers Annotate and Draw only while the Annotate lab is on", async () => {
    setUploadStatus();
    await renderToolbar({ showModeTabs: true, annotateEnabled: true });
    expect(
      container.querySelector(
        'button[aria-label="designEditor.modes.annotate"]',
      ),
    ).toBeTruthy();
    expect(optionKeys("pen")).toEqual(["pen", "draw"]);

    await renderToolbar({ showModeTabs: true, annotateEnabled: false });
    expect(
      container.querySelector(
        'button[aria-label="designEditor.modes.annotate"]',
      ),
    ).toBeNull();
    // Pen keeps its one item, so it has no menu for Draw to be in.
    expect(optionKeys("pen")).toEqual(["pen"]);
    // The rest of the switch stays.
    expect(
      container.querySelector('button[aria-label="designEditor.modes.edit"]'),
    ).toBeTruthy();
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
