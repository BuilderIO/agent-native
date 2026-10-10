// @vitest-environment jsdom

import { callAction } from "@agent-native/core/client/hooks";
import type { EffectTextureRef } from "@shared/native-effects";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/hooks", () => ({ callAction: vi.fn() }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    isSuccess: true,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: () => null,
}));

import { ImageFillControls } from "./ImageFillControls";
import { NativeEffectTextureControl } from "./NativeEffectTextureControl";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function edit(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("image source controls", () => {
  it("omits fit controls for a shader source and commits Enter only once", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <TooltipProvider>
            <ImageFillControls
              sourceOnly
              value={{ url: "", fit: "fill" }}
              onChange={onChange}
            />
          </TooltipProvider>,
        ),
      );
      expect(host.querySelector('[role="combobox"]')).toBeNull();
      const input = host.querySelector<HTMLInputElement>(
        '[aria-label="Image URL"]',
      )!;
      edit(input, "  /shaders/gate-image.svg  ");
      act(() =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        url: "/shaders/gate-image.svg",
        fit: "fill",
      });
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("preserves the existing fit selector and leaves unchanged URLs uncommitted", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <TooltipProvider>
            <ImageFillControls
              value={{ url: "/shaders/gate-image.svg", fit: "fit" }}
              onChange={onChange}
            />
          </TooltipProvider>,
        ),
      );
      expect(host.querySelector('[role="combobox"]')).not.toBeNull();
      const input = host.querySelector<HTMLInputElement>(
        '[aria-label="Image URL"]',
      )!;
      act(() => {
        input.focus();
        input.blur();
      });
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("uses the existing image source popover and clears the canonical texture ref", async () => {
    const changed = vi.fn();
    function ControlledTexture() {
      const [value, setValue] = useState<EffectTextureRef | null>({
        kind: "asset",
        url: "/shaders/gate-image.svg",
      });
      return (
        <NativeEffectTextureControl
          label="Mask image"
          value={value}
          disabled={false}
          onChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <TooltipProvider>
            <ControlledTexture />
          </TooltipProvider>,
        ),
      );
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>('[aria-label="Mask image"]')!
          .click(),
      );
      const input = document.querySelector<HTMLInputElement>(
        '[aria-label="Image URL"]',
      )!;
      expect(input).not.toBeNull();
      expect(document.querySelector('[role="combobox"]')).toBeNull();
      edit(input, "/shaders/gate-image-contrast.svg");
      act(() => input.blur());
      expect(changed).toHaveBeenCalledExactlyOnceWith({
        kind: "asset",
        url: "/shaders/gate-image-contrast.svg",
      });
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>('[aria-label="Remove image"]')!
          .click(),
      );
      expect(changed).toHaveBeenLastCalledWith(null);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each(["newer-source", "unmounted"] as const)(
    "does not apply a late upload after %s",
    async (finishMode) => {
      let finishUpload!: (value: { url: string }) => void;
      vi.mocked(callAction).mockReturnValueOnce(
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
      );
      vi.stubGlobal(
        "FileReader",
        class {
          result = "data:image/png;base64,aW1hZ2U=";
          onload: (() => void) | null = null;
          readAsDataURL() {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      const onChange = vi.fn();
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      let unmounted = false;
      try {
        act(() =>
          root.render(
            <TooltipProvider>
              <ImageFillControls
                sourceOnly
                value={{ url: "", fit: "fill" }}
                onChange={onChange}
              />
            </TooltipProvider>,
          ),
        );
        const fileInput =
          host.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(fileInput, "files", {
          value: [new File(["fixture"], "fixture.png", { type: "image/png" })],
        });
        await act(async () => {
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(callAction).toHaveBeenCalledTimes(1);
        if (finishMode === "newer-source") {
          const input = host.querySelector<HTMLInputElement>(
            '[aria-label="Image URL"]',
          )!;
          edit(input, "/shaders/gate-image-contrast.svg");
          act(() => input.blur());
          expect(onChange).toHaveBeenCalledExactlyOnceWith({
            url: "/shaders/gate-image-contrast.svg",
            fit: "fill",
          });
        } else {
          act(() => root.unmount());
          unmounted = true;
        }
        await act(async () => {
          finishUpload({ url: "/shaders/late-upload.svg" });
          await Promise.resolve();
        });
        expect(onChange).toHaveBeenCalledTimes(
          finishMode === "newer-source" ? 1 : 0,
        );
      } finally {
        if (!unmounted) act(() => root.unmount());
        host.remove();
      }
    },
  );
});
