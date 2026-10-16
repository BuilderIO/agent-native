// @vitest-environment happy-dom

import React, {
  act,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileStorageSetupPopover } from "./FileStorageSetupPopover.js";

const setupMocks = vi.hoisted(() => ({
  connectFlow: null as null | {
    connecting: boolean;
    start: (options: { provisionAccount: boolean }) => void;
    cancel?: () => void;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    (
      ({
        "onboarding.fileStorage.title": "Connect storage to upload files",
        "onboarding.fileStorage.description":
          "Use Builder.io (free) or configure your own S3-compatible object storage.",
        "onboarding.fileStorage.custom": "Use custom keys",
        "composer.connectBuilder": "Connect Builder.io",
        "common.cancel": "Cancel",
      }) as Record<string, string>
    )[key] ?? key,
}));

vi.mock("@agent-native/toolkit/ui/popover", () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    (open && <div>{children}</div>) || null,
  PopoverAnchor: () => null,
  PopoverContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("@agent-native/toolkit/ui/button", () => ({
  Button: ({
    children,
    className,
    disabled,
    onClick,
    type,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      className={className}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  ),
}));

vi.mock("@tabler/icons-react", () => ({ IconCloudUpload: () => null }));

vi.mock("../settings/deferred-builder-connect-popover.js", () => ({
  DeferredBuilderConnectPopover: ({
    children,
    flow,
  }: {
    children: React.ReactNode;
    flow: { cancel?: () => void; connecting: boolean };
  }) => (
    <div>
      {children}
      {flow.connecting ? (
        <button type="button" onClick={flow.cancel}>
          Cancel
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("../setup-connections/BuilderConnectCard.js", () => ({
  BuilderConnectCard: ({
    render,
  }: {
    render: (context: {
      viewModel: {
        connectFlow: typeof setupMocks.connectFlow;
        pending: false;
        error: null;
      };
    }) => React.ReactNode;
  }) =>
    render({
      viewModel: {
        connectFlow: setupMocks.connectFlow,
        pending: false,
        error: null,
      },
    }),
}));

describe("FileStorageSetupPopover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setupMocks.connectFlow = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows storage guidance with both setup choices when storage is missing", () => {
    act(() => {
      root.render(
        <FileStorageSetupPopover
          open
          onOpenChange={vi.fn()}
          status="missing"
        />,
      );
    });

    expect(container.querySelector("h2")?.textContent).toBe(
      "Connect storage to upload files",
    );
    expect(container.textContent).toContain(
      "Use Builder.io (free) or configure your own S3-compatible object storage.",
    );
    expect(container.querySelector("button")?.textContent).toContain(
      "Connect Builder.io",
    );
    expect(container.textContent).toContain("Use custom keys");
    expect(
      container.querySelector('[aria-label="Connect storage to upload files"]')
        ?.className,
    ).toContain("p-3");
    expect(container.querySelector("div.grid.gap-2")?.className).toBe(
      "grid gap-2",
    );
    expect(container.querySelector("h2")?.parentElement?.className).toBe(
      "grid gap-1",
    );
    const choices = container.querySelector("button")?.parentElement;
    expect(choices?.className).toBe("grid grid-cols-2 gap-2");
    expect(choices?.querySelectorAll("button")).toHaveLength(2);
    for (const button of choices?.querySelectorAll("button") ?? []) {
      expect(button.className).toContain("whitespace-normal");
    }
  });

  it("closes the storage popover immediately when Builder setup is canceled", () => {
    const cancel = vi.fn();
    setupMocks.connectFlow = {
      connecting: true,
      start: vi.fn(),
      cancel,
    };
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <FileStorageSetupPopover
          open
          onOpenChange={onOpenChange}
          status="missing"
        />,
      );
    });

    const cancelButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    expect(cancelButton).toBeDefined();
    act(() => cancelButton?.click());

    expect(cancel).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false, "dismiss");
  });
});
