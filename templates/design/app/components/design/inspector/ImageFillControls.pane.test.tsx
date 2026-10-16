// @vitest-environment happy-dom

/**
 * The Image pane: a preview (checkered until there is an image), Choose
 * image… and a Fit select. Choosing goes through the existing upload path and
 * its storage gate; this covers the pane's own layout and edits.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    isSuccess: true,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({ "editPanel.colorPicker.chooseImage": "Choose image…" })[key] ?? key,
}));

import { ImageFillControls, type ImageFillValue } from "./ImageFillControls";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(value: ImageFillValue, onChange = vi.fn()) {
  act(() =>
    root.render(
      <TooltipProvider>
        <ImageFillControls value={value} onChange={onChange} />
      </TooltipProvider>,
    ),
  );
  return onChange;
}

const preview = () =>
  container.querySelector<HTMLElement>("div.h-40.rounded-md")!;

describe("ImageFillControls pane", () => {
  it("shows a checkered preview, Choose image… and the Fit select before there is an image", () => {
    render({ url: "", fit: "fill" });

    expect(preview().style.backgroundImage).toContain("conic-gradient");
    expect(preview().style.backgroundImage).not.toContain("url(");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Choose image…",
      ),
    ).toBe(true);
    expect(
      container.querySelector('[role="combobox"][aria-label="Fill"]')
        ?.textContent,
    ).toBe("Fill");
    expect(container.querySelector('button[aria-label="Remove image"]')).toBe(
      null,
    );
  });

  it("previews the image the way it will be fitted, and removes it from the preview", () => {
    const onChange = render({ url: "https://example.test/a.png", fit: "fit" });

    expect(preview().style.backgroundImage).toContain(
      "https://example.test/a.png",
    );
    expect(preview().style.backgroundSize).toBe("contain");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove image"]')!
        .click(),
    );
    expect(onChange).toHaveBeenCalledWith({
      url: "",
      fit: "fit",
    });
  });

  it("changes the fit and keeps the image", async () => {
    const onChange = render({ url: "https://example.test/a.png", fit: "fill" });
    const select = container.querySelector<HTMLElement>('[aria-label="Fill"]')!;

    await act(async () => {
      select.focus();
      select.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options.map((option) => option.textContent)).toEqual([
      "Fill",
      "Fit",
      "Crop",
      "Tile",
    ]);
    await act(async () => {
      const tile = options.find((option) => option.textContent === "Tile")!;
      tile.focus();
      tile.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChange).toHaveBeenCalledWith({
      url: "https://example.test/a.png",
      fit: "tile",
    });
  });
});
