// @vitest-environment happy-dom

import type { PlanBlock } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileStorage = vi.hoisted(() => ({
  data: { configured: true } as { configured: boolean } | undefined,
  isError: false as boolean,
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => fileStorage,
}));
vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupCard: () => <div data-testid="file-storage-setup-card" />,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { PlanBlockView } from "./DocumentArea";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  fileStorage.data = { configured: true };
  fileStorage.isError = false;
  fileStorage.refetch.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

const IMAGE_BLOCK: PlanBlock = {
  id: "img-1",
  type: "image",
  data: { url: "https://cdn.example.com/cat.png", alt: "A cat", fit: "cover" },
};

/**
 * Renders an editable image block through the legacy dispatcher. This also
 * exercises the `DocumentArea` ↔ `planBlocks` module cycle (the image edit dialog
 * imports `PlanAiBlockAction` from planBlocks), so an import-order regression
 * would surface here.
 */
describe("editable image block", () => {
  it("renders the image with a single self-contained action overlay", () => {
    expect(() => {
      act(() => {
        root.render(<PlanBlockView block={IMAGE_BLOCK} onChange={() => {}} />);
      });
    }).not.toThrow();

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/cat.png");

    // One overlay = zoom + ⋯ (Edit/Replace live inside the ⋯ menu); the block
    // must NOT render a second, separate edit control.
    const actions = container.querySelector(".plan-image__actions");
    expect(actions).toBeTruthy();
    expect(actions!.querySelectorAll("button")).toHaveLength(2);
  });

  it("renders read-only (no action handlers) when not editable", () => {
    act(() => {
      root.render(
        <PlanBlockView
          block={IMAGE_BLOCK}
          editingDisabled
          onChange={() => {}}
        />,
      );
    });

    // Read-only still shows the image; the overlay is the same shared component.
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("keeps replacement disabled and offers status retry while storage is unavailable", () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = undefined;

    act(() => {
      root.render(<PlanBlockView block={IMAGE_BLOCK} onChange={() => {}} />);
    });

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    expect(
      container.querySelector("[data-testid=file-storage-setup-card]"),
    ).toBeNull();
    expect(container.textContent).toContain(
      "plansPage.loadError.storageStatusUnavailable",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "plansPage.loadError.retry",
    );
    expect(retry).toBeTruthy();
    act(() => retry?.click());
    expect(fileStorage.refetch).toHaveBeenCalledOnce();
  });
});
