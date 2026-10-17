// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMeta = vi.hoisted(() => ({
  requirePersistedSourceAcceptance: true,
}));
const uploadState = vi.hoisted(() => ({
  onChange: undefined as
    | ((value: { url: string; fit: "fit" }, meta: object) => void)
    | undefined,
}));

vi.mock("./ImageFillControls", () => ({
  ImageFillControls: ({
    onChange,
    uploadTargetKey,
  }: {
    onChange?: (value: { url: string; fit: "fit" }, meta: object) => void;
    uploadTargetKey?: string;
  }) => {
    uploadState.onChange = onChange;
    return createElement(
      "button",
      {
        type: "button",
        "data-upload-target-key": uploadTargetKey,
        onClick: () =>
          onChange?.({ url: "/uploaded.png", fit: "fit" }, uploadMeta),
      },
      "Complete upload",
    );
  },
  imageFillToCss: (value: { url: string }) => `url("${value.url}")`,
  parseImageFillCss: () => ({ url: "/existing.png", fit: "fill" }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { DesignColorPicker } from "./DesignColorPicker";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  uploadState.onChange = undefined;
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe("DesignColorPicker image upload metadata", () => {
  it("forwards successful upload metadata and its target key", async () => {
    const onChange = vi.fn();
    const onImageFillChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(DesignColorPicker, {
            value: "#ffffff",
            onChange,
            onImageFillChange,
            open: true,
            onOpenChange: vi.fn(),
            paintType: "image",
            uploadTargetKey: "file-a:layer-a",
          }),
        ),
      ),
    );

    const uploadButton = document.querySelector<HTMLButtonElement>(
      'button[data-upload-target-key="file-a:layer-a"]',
    );
    expect(uploadButton).not.toBeNull();
    await act(async () => uploadButton?.click());

    expect(onImageFillChange.mock.calls).toEqual([
      [{ url: "/uploaded.png", fit: "fit" }, uploadMeta],
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("forwards a captured upload after the picker unmounts", async () => {
    const onChange = vi.fn();
    const onImageFillChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(DesignColorPicker, {
            value: "#ffffff",
            onChange,
            onImageFillChange,
            open: true,
            onOpenChange: vi.fn(),
            paintType: "image",
            uploadTargetKey: "file-a:layer-a",
          }),
        ),
      ),
    );

    const completeCapturedUpload = uploadState.onChange;
    expect(completeCapturedUpload).toBeTypeOf("function");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      completeCapturedUpload?.(
        { url: "/uploaded.png", fit: "fit" },
        uploadMeta,
      ),
    );

    expect(onImageFillChange.mock.calls).toEqual([
      [{ url: "/uploaded.png", fit: "fit" }, uploadMeta],
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
