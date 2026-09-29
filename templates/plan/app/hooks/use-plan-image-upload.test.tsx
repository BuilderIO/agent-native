// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: {
    data: undefined as { configured: boolean } | undefined,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => mocks.status,
}));

vi.mock("@agent-native/toolkit/app/setup-connections", async () => {
  const React = await import("react");
  return {
    FileStorageSetupPopover: ({
      open,
      status,
    }: {
      open: boolean;
      status?: string;
    }) =>
      open
        ? React.createElement(
            "div",
            { role: "dialog", "data-status": status },
            "Connect storage",
          )
        : null,
  };
});

import { usePlanImageUpload } from "./use-plan-image-upload";

function Probe() {
  const { requestUpload, storagePrompt } = usePlanImageUpload();
  return createElement(
    "div",
    null,
    createElement("button", { onClick: requestUpload }, "Upload image"),
    storagePrompt,
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubEnv("DEV", false);
  mocks.status.data = undefined;
  mocks.status.isError = false;
  mocks.status.isSuccess = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe("usePlanImageUpload", () => {
  it("shows retryable storage status only after upload is requested", () => {
    act(() => root.render(createElement(Probe) as ReactNode));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    act(() => container.querySelector("button")?.click());

    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-status"),
    ).toBe("unavailable");
  });
});
