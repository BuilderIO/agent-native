// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadStatus = vi.hoisted(() => ({
  current: { isSuccess: true, data: { configured: false } },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => uploadStatus.current,
}));

vi.mock("@agent-native/core/client/setup-connections", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupCard: () =>
      createElement("div", { "data-testid": "file-storage-setup-card" }),
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
    uploadStatus.current = { isSuccess: true, data: { configured: false } };
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
    "gates %s file selection with shared storage setup",
    (type, Block) => {
      act(() => root.render(createElement(Block, mediaNodeProps(type))));

      expect(
        container.querySelector('[data-testid="file-storage-setup-card"]'),
      ).not.toBeNull();
      expect(
        Array.from(container.querySelectorAll("button")).some(
          (button) => button.textContent === "editor.media.uploadFile",
        ),
      ).toBe(false);
    },
  );
});
