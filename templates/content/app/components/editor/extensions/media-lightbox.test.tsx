// @vitest-environment happy-dom

import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  useActionQuery: () => ({ data: undefined, isSuccess: false }),
  callAction: vi.fn(),
  getBrowserTabId: () => "tab_1",
  setClientAppState: vi.fn(),
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    NodeViewWrapper: ({ children, ...props }: Record<string, unknown>) =>
      createElement("div", props, children as React.ReactNode),
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";

import { AudioBlock } from "./AudioBlock";
import { ImageBlock } from "./ImageBlock";
import { VideoBlock } from "./VideoBlock";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function render(
  Block: ComponentType<never>,
  type: string,
  src: string,
  options: Record<string, unknown> = {},
) {
  const editor = {
    isEditable: true,
    isDestroyed: false,
    state: { doc: { nodeAt: () => null } },
    commands: { command: () => true },
    chain: () => {
      const chain: Record<string, () => unknown> = {
        focus: () => chain,
        run: () => true,
      };
      return chain;
    },
  };
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(Block, {
          node: { attrs: { src, alt: "" }, type: { name: type }, nodeSize: 1 },
          editor,
          selected: true,
          updateAttributes: vi.fn(),
          deleteNode: vi.fn(),
          extension: { options: { documentId: "doc_1", ...options } },
          getPos: () => 4,
        } as never),
      ),
    ),
  );
}

function expand(label: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No ${label} button`);
  act(() => button.click());
}

function lightbox() {
  return document.body.querySelector('[role="dialog"].media-lightbox');
}

// Each lightbox opens toolkit's Dialog around Radix's own Content. If Content
// and toolkit resolve different copies of @radix-ui/react-dialog, the Content
// can't find its Dialog and the page crashes with "`DialogContent` must be
// used within `Dialog`".
describe("media lightbox", () => {
  it("opens an image from the expand button", () => {
    render(ImageBlock, "image", "https://cdn.example.test/diagram.png");

    expand("editor.media.expandImage");

    expect(lightbox()).not.toBeNull();
  });

  it("opens an image on double-click", () => {
    render(ImageBlock, "image", "https://cdn.example.test/diagram.png");
    const image = container.querySelector("img.media-block__content");
    if (!image) throw new Error("No image");

    act(() => {
      image.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(lightbox()).not.toBeNull();
  });

  it("opens a video from the expand button", () => {
    render(VideoBlock, "video", "https://cdn.example.test/demo.mp4");

    expand("editor.media.expandVideo");

    expect(lightbox()).not.toBeNull();
  });

  it("opens an audio file from the expand button", () => {
    render(AudioBlock, "audio", "https://cdn.example.test/voice.mp3");

    expand("editor.media.expandAudio");

    expect(lightbox()).not.toBeNull();
  });
});
