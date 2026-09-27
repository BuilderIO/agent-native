// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: {
    data: { configured: false },
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/toolkit/composer", async () => {
  const React = await import("react");
  return {
    PromptComposer: ({
      attachmentsEnabled,
      onAttachmentRequest,
    }: {
      attachmentsEnabled: boolean;
      onAttachmentRequest?: () => void;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          "data-attachments-enabled": String(attachmentsEnabled),
          onClick: attachmentsEnabled ? undefined : onAttachmentRequest,
        },
        "Upload File",
      ),
  };
});

vi.mock("../uploads/use-file-upload-status.js", () => ({
  useFileUploadStatus: () => mocks.status,
}));

vi.mock("../FileStorageSetupPopover.js", async () => {
  const React = await import("react");
  return {
    FileStorageSetupPopover: ({
      open,
      anchorRef,
    }: {
      open: boolean;
      anchorRef?: { current: HTMLElement | null };
    }) =>
      open
        ? React.createElement(
            "div",
            {
              role: "dialog",
              "data-anchor-ready": String(Boolean(anchorRef?.current)),
            },
            "Connect storage",
          )
        : null,
  };
});

vi.mock("../external-agent-host.js", async () => {
  const React = await import("react");
  return { ExternalAgentNudge: () => React.createElement(React.Fragment) };
});

vi.mock("./runtime-adapters.js", async () => {
  const React = await import("react");
  return {
    CoreComposerRuntimeProvider: ({
      children,
    }: {
      children: React.ReactNode;
    }) => React.createElement(React.Fragment, null, children),
  };
});

import { PromptComposer } from "./wired-components.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.status.data.configured = false;
  mocks.status.isError = false;
  mocks.status.isSuccess = true;
  mocks.status.refetch.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PromptComposer storage setup", () => {
  it("preserves a host upload request when storage is not configured", () => {
    const onAttachmentRequest = vi.fn();
    act(() => {
      root.render(<PromptComposer onAttachmentRequest={onAttachmentRequest} />);
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const uploadButton = container.querySelector("button");
    expect(uploadButton?.getAttribute("data-attachments-enabled")).toBe(
      "false",
    );
    act(() => uploadButton?.click());

    expect(onAttachmentRequest).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    mocks.status.data.configured = true;
    act(() => {
      root.render(<PromptComposer onAttachmentRequest={onAttachmentRequest} />);
    });
    act(() => uploadButton?.click());
    expect(onAttachmentRequest).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens storage setup only after Upload File is selected", () => {
    act(() => root.render(<PromptComposer />));

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => container.querySelector("button")?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(
      container
        .querySelector('[role="dialog"]')
        ?.getAttribute("data-anchor-ready"),
    ).toBe("true");
  });
});
