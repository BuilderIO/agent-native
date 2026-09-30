// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadStatus = vi.hoisted(() => ({
  current: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: { configured: false } as { configured: boolean } | undefined,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => uploadStatus.current,
}));

vi.mock("@agent-native/toolkit/app/setup-connections", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupPopover: ({
      open,
      status,
      onRetry,
    }: {
      open: boolean;
      status?: string;
      onRetry?: () => void;
    }) =>
      open
        ? createElement(
            "div",
            { "data-testid": "file-storage-setup-popover" },
            status === "unavailable"
              ? createElement(
                  "span",
                  {},
                  "onboarding.fileStorage.statusUnavailable",
                )
              : null,
            status === "unavailable"
              ? createElement(
                  "button",
                  { onClick: onRetry, "data-testid": "file-storage-retry" },
                  "common.retry",
                )
              : null,
          )
        : null,
  };
});

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    NodeViewWrapper: ({ children, ...props }: Record<string, unknown>) =>
      createElement("div", props, children as React.ReactNode),
  };
});

import { AudioBlock } from "./AudioBlock";
import { ImageBlock } from "./ImageBlock";
import { VideoBlock } from "./VideoBlock";

function mediaNodeProps(type: "image" | "video" | "audio") {
  return {
    node: {
      attrs: { src: null, alt: "", uploadId: null },
      type: { name: type },
    },
    editor: { isEditable: true, isDestroyed: false },
    deleteNode: vi.fn(),
    selected: true,
    updateAttributes: vi.fn(),
    extension: { options: {} },
    getPos: () => 1,
  } as never;
}

describe("rich editor media upload storage gates", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    uploadStatus.current = {
      isSuccess: true,
      isError: false,
      isFetching: false,
      data: { configured: false },
      refetch: vi.fn(),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  });

  it.each([
    ["image", ImageBlock],
    ["video", VideoBlock],
    ["audio", AudioBlock],
  ] as const)(
    "keeps %s storage setup hidden until upload is requested",
    (type, Block) => {
      act(() => root.render(createElement(Block, mediaNodeProps(type))));

      expect(
        container.querySelector('[data-testid="file-storage-setup-popover"]'),
      ).toBeNull();
      const uploadButton = Array.from(
        container.querySelectorAll("button"),
      ).find((button) => button.textContent === "editor.media.uploadFile");
      expect(uploadButton).not.toBeNull();
      act(() => uploadButton?.click());
      expect(
        container.querySelector('[data-testid="file-storage-setup-popover"]'),
      ).not.toBeNull();
    },
  );

  it.each([
    ["image", "loading", ImageBlock, false],
    ["image", "error", ImageBlock, true],
    ["video", "loading", VideoBlock, false],
    ["video", "error", VideoBlock, true],
    ["audio", "loading", AudioBlock, false],
    ["audio", "error", AudioBlock, true],
  ] as const)(
    "shows retry instead of setup when %s storage status is %s",
    async (type, _state, Block, isError) => {
      const refetch = vi.fn();
      uploadStatus.current = {
        isSuccess: false,
        isError,
        isFetching: !isError,
        data: undefined,
        refetch,
      };

      act(() => root.render(createElement(Block, mediaNodeProps(type))));

      expect(
        container.querySelector('[data-testid="file-storage-setup-popover"]'),
      ).toBeNull();
      const fileInput =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(fileInput === null || fileInput.disabled).toBe(true);
      expect(document.body.textContent).not.toContain(
        "onboarding.fileStorage.statusUnavailable",
      );
      const uploadButton = Array.from(
        container.querySelectorAll("button"),
      ).find((button) => button.textContent === "editor.media.uploadFile");
      act(() => uploadButton?.click());
      expect(document.body.textContent).toContain(
        "onboarding.fileStorage.statusUnavailable",
      );

      await act(async () => {
        document.body
          .querySelector<HTMLButtonElement>(
            '[data-testid="file-storage-retry"]',
          )
          ?.click();
      });

      expect(refetch).toHaveBeenCalledOnce();
    },
  );
});
