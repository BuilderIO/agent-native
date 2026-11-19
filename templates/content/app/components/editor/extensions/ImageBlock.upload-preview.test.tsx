// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined, isSuccess: false }),
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
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

import {
  failImageUploadPreview,
  hasImageUploadPreview,
  holdImageUploadPreview,
  releaseImageUploadPreview,
  releaseImageUploadPreviewsFor,
  startImageUploadPreview,
} from "../image-upload-previews";
import { ImageBlock } from "./ImageBlock";

const owner = {};
const file = new File(["image-bytes"], "diagram.png", { type: "image/png" });

function imageProps(attrs: Record<string, unknown>) {
  const chain = {
    command: vi.fn(() => chain),
    deleteRange: vi.fn(() => chain),
    run: vi.fn(() => true),
  };
  const updateAttributes = vi.fn();
  const tr = {
    setNodeAttribute: vi.fn(() => tr),
    setMeta: vi.fn(() => tr),
  };
  const dispatch = vi.fn();
  return {
    chain,
    updateAttributes,
    tr,
    dispatch,
    props: {
      node: {
        attrs: { src: null, alt: "", uploadId: null, ...attrs },
        type: { name: "image" },
        nodeSize: 1,
      },
      editor: {
        isEditable: true,
        isDestroyed: false,
        on() {},
        off() {},
        chain: () => chain,
        state: { tr },
        view: { dispatch },
      },
      selected: false,
      updateAttributes,
      extension: { options: {} },
      getPos: () => 4,
    } as never,
  };
}

function block(props: never) {
  return createElement(TooltipProvider, null, createElement(ImageBlock, props));
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === name,
  );
}

describe("image upload previews in the block", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    releaseImageUploadPreviewsFor(owner);
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("draws the picked file with a spinner while it uploads", () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    startImageUploadPreview("image-upload-1");
    const { props } = imageProps({ uploadId: "image-upload-1" });
    act(() => root.render(block(props)));

    const preview = container.querySelector("img[data-upload-preview]");
    expect(preview?.getAttribute("src")).toBe("blob:preview-1");
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("editor.media.uploadingImage");
    expect(container.textContent).not.toContain("editor.media.uploadingImage");
    // No toolbar or resize while it uploads.
    expect(container.querySelector(".media-block__toolbar")).toBeNull();
  });

  it("loads the uploaded copy unseen under the preview", () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    startImageUploadPreview("image-upload-1");
    const { props } = imageProps({
      uploadId: "image-upload-1",
      src: "https://cdn.example.com/diagram.png",
    });
    act(() => root.render(block(props)));

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.hasAttribute("data-upload-preview")).toBe(true);
    expect(images[1]?.getAttribute("src")).toBe(
      "https://cdn.example.com/diagram.png",
    );
    expect(images[1]?.className).toBe("media-block__staged-upload");
  });

  it("falls back to the plain uploading block for a file the browser can't draw", () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    startImageUploadPreview("image-upload-1");
    const { props } = imageProps({ uploadId: "image-upload-1" });
    act(() => root.render(block(props)));

    act(() => {
      container
        .querySelector("img[data-upload-preview]")
        ?.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img[data-upload-preview]")).toBeNull();
    expect(container.textContent).toContain("editor.media.uploadingImage");
  });

  it("shows another tab's upload as the page has it", () => {
    const uploading = imageProps({ uploadId: "image-upload-other-tab" });
    act(() => root.render(block(uploading.props)));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("editor.media.uploadingImage");

    const failed = imageProps({ uploadId: "image-failed-other-tab" });
    act(() => root.render(block(failed.props)));
    expect(container.textContent).toContain("editor.media.addImage");
    expect(buttonNamed(container, "editor.media.retryImageUpload")).toBe(
      undefined,
    );
  });

  it("keeps a failed upload's pick with Retry and Remove", () => {
    const retry = vi.fn();
    holdImageUploadPreview("image-upload-1", file, owner);
    failImageUploadPreview("image-upload-1", "upload", retry);
    const { props, chain } = imageProps({ uploadId: "image-failed-1" });
    act(() => root.render(block(props)));

    expect(
      container.querySelector("img[data-upload-preview]")?.getAttribute("src"),
    ).toBe("blob:preview-1");
    expect(container.textContent).toContain("editor.media.imageUploadFailed");
    expect(container.querySelector('[role="status"]')).toBeNull();

    act(() => buttonNamed(container, "editor.media.retryImageUpload")?.click());
    expect(retry).toHaveBeenCalledOnce();

    act(() => buttonNamed(container, "editor.media.removeImage")?.click());
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 4, to: 5 });
    expect(hasImageUploadPreview("image-failed-1")).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("puts a replaced image back when its failed upload is removed", () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    failImageUploadPreview("image-upload-1", "render", vi.fn());
    const { props, chain, updateAttributes } = imageProps({
      uploadId: "image-failed-1",
      src: "https://cdn.example.com/old.png",
    });
    act(() => root.render(block(props)));

    expect(container.textContent).toContain("editor.media.imageBroken");
    act(() => buttonNamed(container, "editor.media.removeImage")?.click());
    expect(updateAttributes).toHaveBeenCalledWith({ uploadId: null });
    expect(chain.deleteRange).not.toHaveBeenCalled();
  });

  it("offers Retry and Remove without a preview the browser can draw", () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error("Not supported");
    });
    holdImageUploadPreview("image-upload-1", file, owner);
    failImageUploadPreview("image-upload-1", "upload", vi.fn());
    const { props } = imageProps({ uploadId: "image-failed-1" });
    act(() => root.render(block(props)));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("editor.media.imageUploadFailed");
    expect(
      buttonNamed(container, "editor.media.retryImageUpload"),
    ).toBeDefined();
  });

  it("keeps a replaced image in view when its failed pick can't be drawn", () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error("Not supported");
    });
    holdImageUploadPreview("image-upload-1", file, owner);
    failImageUploadPreview("image-upload-1", "render", vi.fn());
    const { props } = imageProps({
      uploadId: "image-failed-1",
      src: "https://cdn.example.com/old.png",
    });
    act(() => root.render(block(props)));

    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "old.png",
    );
    // The image on show is fine; it's the new one that didn't go through.
    expect(container.textContent).toContain("editor.media.imageUploadFailed");
    expect(container.textContent).not.toContain("editor.media.imageBroken");
    expect(
      buttonNamed(container, "editor.media.retryImageUpload"),
    ).toBeDefined();
  });

  it("drops an upload this tab let go of, leaving undo history alone", () => {
    holdImageUploadPreview("image-upload-1", file, owner);
    releaseImageUploadPreview("image-upload-1");
    // Undo brings the block back as it was mid-upload.
    const restored = imageProps({ uploadId: "image-upload-1" });
    act(() => root.render(block(restored.props)));

    expect(restored.tr.setNodeAttribute).toHaveBeenCalledWith(
      4,
      "uploadId",
      null,
    );
    expect(restored.tr.setMeta).toHaveBeenCalledWith("addToHistory", false);
    expect(restored.dispatch).toHaveBeenCalledWith(restored.tr);
  });
});
