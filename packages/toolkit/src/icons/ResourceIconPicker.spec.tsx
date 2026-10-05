// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ResourceIconPicker,
  type ResourceIconPickerLabels,
} from "./ResourceIconPicker.js";
import type { ResourceIconImage, ResourceIconValue } from "./types.js";

vi.mock("./catalog.js", () => ({ loadTablerCatalog: async () => [] }));
vi.mock("./emoji-catalog.js", () => ({
  EMOJI_CATEGORIES: [],
  loadEmojiCatalog: async () => [],
}));

const labels: ResourceIconPickerLabels = {
  trigger: "Choose icon",
  iconsTab: "Icons",
  emojiTab: "Emoji",
  uploadTab: "Upload",
  search: "Search",
  noResults: "No results",
  recents: "Recent",
  colors: "Colors",
  defaultColor: "Default",
  remove: "Remove",
  upload: "Choose image",
  uploading: "Uploading",
  saveError: "Could not save icon.",
  uploadFailed: "Could not upload icon image. Try again.",
  uploadTooLarge: "Icon image must be 5 MiB or smaller.",
  uploadUnsupportedType: "Only PNG, JPEG, WebP, or SVG images can be uploaded.",
  loadError: "Could not load uploaded icons.",
  retry: "Retry",
};
const previousIcon: ResourceIconValue = {
  version: 1,
  kind: "emoji",
  emoji: "🌿",
};
const uploadedIcon: ResourceIconImage = {
  version: 1,
  kind: "image",
  authority: "url",
  assetId: "/uploaded.svg",
};

describe("ResourceIconPicker uploads", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderPicker(
    onUpload: (file: File) => Promise<ResourceIconImage>,
    onValueChange = vi.fn(),
    formatUploadError?: (error: unknown) => string,
  ) {
    await act(async () => {
      root.render(
        <ResourceIconPicker
          value={previousIcon}
          onValueChange={onValueChange}
          onUpload={onUpload}
          formatUploadError={formatUploadError}
          labels={labels}
          open
          portalled={false}
        />,
      );
    });
    const uploadTab = Array.from(container.querySelectorAll("[role=tab]")).find(
      (tab) => tab.textContent === labels.uploadTab,
    );
    expect(uploadTab).toBeDefined();
    await act(async () => {
      uploadTab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      uploadTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function choose(file: File) {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function drop(file: File) {
    const target = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(labels.upload),
    )!;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    await act(async () => target.dispatchEvent(event));
  }

  function alertText() {
    return container.querySelector('[role="alert"]')?.textContent;
  }

  it("rejects unsupported types from input and drop without replacing the icon", async () => {
    const onUpload = vi.fn().mockResolvedValue(uploadedIcon);
    const onValueChange = vi.fn();
    await renderPicker(onUpload, onValueChange);

    await choose(new File(["gif"], "animation.gif", { type: "image/gif" }));
    expect(alertText()).toBe(labels.uploadUnsupportedType);

    await drop(new File(["text"], "notes.txt", { type: "text/plain" }));
    expect(alertText()).toBe(labels.uploadUnsupportedType);
    expect(onUpload).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("shows the size limit for a supported file from either path", async () => {
    const onUpload = vi.fn().mockResolvedValue(uploadedIcon);
    await renderPicker(onUpload);

    const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await choose(large);
    expect(alertText()).toBe(labels.uploadTooLarge);
    await drop(large);
    expect(alertText()).toBe(labels.uploadTooLarge);
    await drop(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.txt", {
        type: "text/plain",
      }),
    );
    expect(alertText()).toBe(labels.uploadTooLarge);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("keeps a mapped failure visible and clears it after a successful retry", async () => {
    const onUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error("private server detail"))
      .mockResolvedValueOnce(uploadedIcon);
    const onValueChange = vi.fn();
    await renderPicker(
      onUpload,
      onValueChange,
      () => "Storage is unavailable.",
    );

    await choose(new File(["first"], "first.png", { type: "image/png" }));
    expect(alertText()).toBe("Storage is unavailable.");
    expect(container.textContent).not.toContain("private server detail");
    expect(onValueChange).not.toHaveBeenCalled();

    await drop(new File(["<svg />"], "retry.SVG"));
    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(onUpload.mock.calls[1]?.[0].type).toBe("image/svg+xml");
    expect(onValueChange).toHaveBeenCalledWith(uploadedIcon);
    expect(alertText()).toBeUndefined();
  });

  it("uses the localized upload failure when the caller has no safe detail", async () => {
    const onUpload = vi
      .fn()
      .mockRejectedValue(new Error("private server detail"));
    await renderPicker(onUpload);

    await choose(new File(["first"], "first.webp", { type: "image/webp" }));
    expect(alertText()).toBe(labels.uploadFailed);
    expect(container.textContent).not.toContain("private server detail");
  });

  it("makes an unavailable upload library visible and retryable", async () => {
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <ResourceIconPicker
          value={previousIcon}
          onValueChange={vi.fn()}
          onUpload={vi.fn().mockResolvedValue(uploadedIcon)}
          uploadedImagesError
          onUploadedImagesRetry={onRetry}
          labels={labels}
          open
          portalled={false}
        />,
      );
    });
    const uploadTab = Array.from(container.querySelectorAll("[role=tab]")).find(
      (tab) => tab.textContent === labels.uploadTab,
    );
    await act(async () => {
      uploadTab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      uploadTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(alertText()).toContain(labels.loadError);
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === labels.retry,
    );
    await act(async () => retryButton!.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not offer private recent images outside the current library", async () => {
    const personal: ResourceIconImage = {
      version: 1,
      kind: "image",
      authority: "private-icon",
      assetId: "personal-asset",
      alt: "Personal logo",
    };
    const workspace: ResourceIconImage = {
      ...personal,
      assetId: "workspace-asset",
      alt: "Workspace logo",
    };
    await act(async () => {
      root.render(
        <ResourceIconPicker
          value={previousIcon}
          onValueChange={vi.fn()}
          onUpload={vi.fn()}
          uploadedImages={[workspace]}
          recentValues={[personal, workspace]}
          labels={labels}
          open
          portalled={false}
        />,
      );
    });
    const uploadTab = Array.from(container.querySelectorAll("[role=tab]")).find(
      (tab) => tab.textContent === labels.uploadTab,
    );
    await act(async () => {
      uploadTab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      uploadTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[aria-label="Workspace logo"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Personal logo"]')).toBeNull();
  });
});
