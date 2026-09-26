// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/setup-connections", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupCard: () =>
      createElement("div", { "data-testid": "file-storage-setup-card" }),
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

  it("shows setup only for missing storage and retry for unknown status", () => {
    const onRetry = vi.fn();
    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "unknown",
          onRetry,
        }),
      ),
    );

    expect(
      container.querySelector('[data-testid="file-storage-setup-card"]'),
    ).toBeNull();
    expect(container.textContent).toContain("settings.statusUnavailable");
    act(() => container.querySelector("button")?.click());
    expect(onRetry).toHaveBeenCalledOnce();

    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "missing",
          onRetry,
        }),
      ),
    );
    expect(
      container.querySelector('[data-testid="file-storage-setup-card"]'),
    ).not.toBeNull();

    act(() =>
      root.render(
        createElement(FileUploadStorageGate, {
          state: "configured",
          onRetry,
        }),
      ),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="file-storage-setup-card"]'),
    ).toBeNull();
  });
});
