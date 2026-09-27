// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const collab = vi.hoisted(() => ({
  initialization: { status: "loading" as "loading" | "ready" },
}));
const editorProps = vi.hoisted(() => vi.fn());
const imageSlashAction = vi.hoisted(() => vi.fn());
const uploadImageMock = vi.hoisted(() => vi.fn());
const fileStorage = vi.hoisted(() => ({
  configured: false,
  isSuccess: true,
  isError: false,
  refetch: vi.fn(),
  setupPopoverOpen: false,
  setupPopoverOnOpenChange: (_open: boolean, _reason?: string) => {},
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/collab", () => ({
  useCollaborativeDoc: () => ({
    ydoc: null,
    awareness: null,
    isSynced: false,
    initialization: collab.initialization,
  }),
}));
vi.mock("@agent-native/toolkit/editor", () => ({
  RichMarkdownEditor: (props: unknown) => {
    editorProps(props);
    return null;
  },
  DEFAULT_SLASH_COMMANDS: [],
  createImageSlashCommand: () => ({ action: imageSlashAction }),
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: uploadImageMock,
  useFileUploadStatus: () => ({
    data: { configured: fileStorage.configured },
    isSuccess: fileStorage.isSuccess,
    isError: fileStorage.isError,
    refetch: fileStorage.refetch,
  }),
}));
vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupPopover: ({
    open,
    status,
    onRetry,
    onOpenChange,
  }: {
    open: boolean;
    status?: string;
    onRetry?: () => void;
    onOpenChange: (open: boolean, reason?: string) => void;
  }) => {
    fileStorage.setupPopoverOpen = open;
    fileStorage.setupPopoverOnOpenChange = onOpenChange;
    return open
      ? createElement(
          "div",
          { "data-testid": "file-storage-setup-popover" },
          status === "unavailable"
            ? "onboarding.fileStorage.statusUnavailable"
            : "onboarding.fileStorage.title",
          status === "unavailable"
            ? createElement("button", { onClick: onRetry }, "common.retry")
            : null,
        )
      : null;
  },
}));
vi.mock("./PlanImageNode", () => ({
  PlanImageNode: {
    configure: (options: unknown) => ({ options }),
  },
}));

import { PlanMarkdownEditor } from "./PlanMarkdownEditor";

describe("PlanMarkdownEditor collaboration initialization", () => {
  beforeEach(() => {
    editorProps.mockClear();
    imageSlashAction.mockClear();
    uploadImageMock.mockReset();
    collab.initialization = { status: "loading" };
    fileStorage.configured = false;
    fileStorage.isSuccess = true;
    fileStorage.isError = false;
    fileStorage.refetch.mockClear();
    fileStorage.setupPopoverOpen = false;
    fileStorage.setupPopoverOnOpenChange = () => {};
  });

  it("keeps the non-collaborative fallback inert until state is ready", () => {
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
      planId: "plan-1",
      blockId: "block-1",
      user: { name: "Taylor", email: "taylor@example.com", color: "blue" },
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      editable: false,
      interactive: false,
    });

    collab.initialization = { status: "ready" };
    act(() => root.render(<PlanMarkdownEditor {...props} />));
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      editable: true,
      interactive: true,
    });
    act(() => root.unmount());
  });

  it("shows setup on upload intent and requires a fresh click after connecting", async () => {
    vi.stubEnv("DEV", false);
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));

    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).toBe("");
    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      onImageUpload: expect.any(Function),
      slashItems: [{ action: expect.any(Function) }],
      extraExtensions: [{ options: { onImageUpload: expect.any(Function) } }],
    });

    const imageCommand = editorProps.mock.lastCall?.[0].slashItems[0];
    const editor = { view: {} };
    act(() => imageCommand.action(editor));
    expect(fileStorage.setupPopoverOpen).toBe(true);
    expect(imageSlashAction).not.toHaveBeenCalled();

    uploadImageMock.mockResolvedValue({
      src: "https://cdn.example.com/cat.png",
    });
    const file = new File(["image"], "cat.png", { type: "image/png" });
    const pendingUpload = editorProps.mock.lastCall?.[0].onImageUpload(file);
    expect(uploadImageMock).not.toHaveBeenCalled();

    fileStorage.configured = true;
    await act(async () => {
      root.render(<PlanMarkdownEditor {...props} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(pendingUpload).resolves.toEqual({
      src: "https://cdn.example.com/cat.png",
    });
    expect(
      container.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).toBeNull();
    expect(imageSlashAction).not.toHaveBeenCalled();
    act(() => editorProps.mock.lastCall?.[0].slashItems[0].action(editor));
    expect(imageSlashAction).toHaveBeenCalledWith(editor);
    expect(uploadImageMock).toHaveBeenCalledWith(file);
    act(() => root.unmount());
    vi.unstubAllEnvs();
  });

  it("cancels queued image files when storage setup is dismissed", async () => {
    vi.stubEnv("DEV", false);
    const props = { markdown: "Canonical body", onSave: vi.fn() };
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));

    const file = new File(["image"], "cat.png", { type: "image/png" });
    let pendingUpload!: Promise<{ src: string; alt?: string }>;
    await act(async () => {
      pendingUpload = editorProps.mock.lastCall?.[0].onImageUpload(file);
      await Promise.resolve();
    });
    void pendingUpload.catch(() => {});
    expect(fileStorage.setupPopoverOpen).toBe(true);

    act(() => fileStorage.setupPopoverOnOpenChange(false, "dismiss"));
    fileStorage.configured = true;
    await act(async () => {
      root.render(<PlanMarkdownEditor {...props} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await expect(pendingUpload).rejects.toThrow("Image upload was canceled.");
    expect(uploadImageMock).not.toHaveBeenCalled();
    act(() => root.unmount());
    vi.unstubAllEnvs();
  });

  it("keeps probe errors distinct and offers retry only after an upload attempt", () => {
    vi.stubEnv("DEV", false);
    fileStorage.isSuccess = false;
    fileStorage.isError = true;
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));

    expect(editorProps.mock.lastCall?.[0]).toMatchObject({
      onImageUpload: expect.any(Function),
      slashItems: [{ action: expect.any(Function) }],
      extraExtensions: [{ options: { onImageUpload: expect.any(Function) } }],
    });
    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).toBe("");
    const imageCommand = editorProps.mock.lastCall?.[0].slashItems[0];
    act(() => imageCommand.action({}));
    expect(fileStorage.refetch).toHaveBeenCalledOnce();
    expect(fileStorage.setupPopoverOpen).toBe(true);
    const retryButton = container.querySelector("button");
    expect(retryButton?.textContent).toBe("common.retry");
    expect(container.textContent).toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    act(() => retryButton?.click());
    expect(fileStorage.refetch).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    vi.unstubAllEnvs();
  });

  it("does not show setup or retry UI while storage status is still loading", () => {
    vi.stubEnv("DEV", false);
    fileStorage.isSuccess = false;
    const props = {
      markdown: "Canonical body",
      onSave: vi.fn(),
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlanMarkdownEditor {...props} />));

    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).toBe("");
    expect(container.querySelector("button")).toBeNull();

    act(() => root.unmount());
    vi.unstubAllEnvs();
  });
});
