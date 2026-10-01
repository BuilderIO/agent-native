// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupPopover: ({
      open,
      status,
      onRetry,
      onOpenChange,
    }: {
      open: boolean;
      status?: string;
      onRetry?: () => void;
      onOpenChange: (open: boolean, reason?: string) => void;
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
            createElement(
              "button",
              {
                onClick: () => onOpenChange(false, "dismiss"),
                "data-testid": "file-storage-dismiss",
              },
              "dismiss",
            ),
          )
        : null,
  };
});

import {
  FileUploadStorageGate,
  getFileUploadStorageState,
} from "./FileUploadStorageGate";

describe("file upload storage gate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("keeps configured, missing, and unknown status distinct", () => {
    expect(
      getFileUploadStorageState({
        isSuccess: true,
        isError: false,
        data: { configured: true },
      }),
    ).toBe("configured");
    expect(
      getFileUploadStorageState({
        isSuccess: true,
        isError: false,
        data: { configured: false },
      }),
    ).toBe("missing");
    expect(
      getFileUploadStorageState({
        isSuccess: false,
        isError: true,
        data: { configured: false },
      }),
    ).toBe("unknown");
    expect(
      getFileUploadStorageState({ isSuccess: false, isError: false }),
    ).toBe("unknown");
  });

  it("shows missing or unknown storage only after an upload attempt", () => {
    const onRetry = vi.fn();
    const onOpenChange = vi.fn();
    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "unknown",
          open: false,
          onOpenChange,
          onRetry,
        }),
      ),
    );

    expect(
      container.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(
      "onboarding.fileStorage.statusUnavailable",
    );

    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "unknown",
          open: true,
          onOpenChange,
          onRetry,
        }),
      ),
    );
    expect(document.body.textContent).toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    act(() => document.body.querySelector("button")?.click());
    expect(onRetry).toHaveBeenCalledOnce();

    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "missing",
          open: false,
          onOpenChange,
          onRetry,
        }),
      ),
    );
    expect(
      container.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).toBeNull();

    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "missing",
          open: true,
          onOpenChange,
          onRetry,
        }),
      ),
    );
    expect(
      container.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).not.toBeNull();

    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          open: false,
          onOpenChange,
          state: "configured",
          onRetry,
        }),
      ),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).toBeNull();
  });

  it("discards a queued upload when setup is dismissed", () => {
    const onOpenChange = vi.fn();
    const onDismiss = vi.fn();
    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "missing",
          open: true,
          onOpenChange,
          onDismiss,
          onRetry: vi.fn(),
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="file-storage-dismiss"]',
        )
        ?.click(),
    );

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
