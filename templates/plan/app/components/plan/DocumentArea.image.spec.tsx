// @vitest-environment happy-dom

import type { PlanBlock } from "@shared/plan-content";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileStorage = vi.hoisted(() => ({
  data: { configured: true } as { configured: boolean } | undefined,
  isSuccess: true as boolean,
  isError: false as boolean,
  refetch: vi.fn(),
  setupPopoverOpen: false,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => fileStorage,
}));
vi.mock("@agent-native/toolkit/app/setup-connections", () => ({
  FileStorageSetupPopover: ({
    open,
    status,
    onRetry,
  }: {
    open: boolean;
    status?: string;
    onRetry?: () => void;
  }) => {
    fileStorage.setupPopoverOpen = open;
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
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { PlanBlockView } from "./DocumentArea";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  fileStorage.data = { configured: true };
  fileStorage.isSuccess = true;
  fileStorage.isError = false;
  fileStorage.refetch.mockClear();
  fileStorage.setupPopoverOpen = false;
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

describe("editable image block", () => {
  it("renders the image with a single self-contained action overlay", () => {
    expect(() => {
      act(() => {
        root.render(<PlanBlockView block={IMAGE_BLOCK} onChange={() => {}} />);
      });
    }).not.toThrow();

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/cat.png");

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

    expect(container.querySelector("img")).toBeTruthy();
  });

  it("shows no storage UI until an unavailable status blocks a replacement attempt", () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = undefined;
    fileStorage.isSuccess = false;
    fileStorage.isError = true;

    act(() => {
      root.render(<PlanBlockView block={IMAGE_BLOCK} onChange={() => {}} />);
    });

    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).not.toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    const options = container.querySelector<HTMLButtonElement>(
      'button[aria-label="raw.imageViewer.imageOptions"]',
    );
    act(() => {
      options?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    act(() => options?.click());
    const replace = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ).find((item) =>
      item.textContent?.includes("raw.imageViewer.replaceImage"),
    );
    act(() => replace?.click());
    expect(fileStorage.refetch).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    expect(fileStorage.setupPopoverOpen).toBe(true);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "common.retry",
    );
    expect(retry).toBeTruthy();
    act(() => retry?.click());
    expect(fileStorage.refetch).toHaveBeenCalledTimes(2);
  });
});
