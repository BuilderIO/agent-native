// @vitest-environment happy-dom

import React, {
  act,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileStorageSetupPopover } from "./FileStorageSetupPopover.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    (
      ({
        "onboarding.fileStorage.title": "Connect storage to upload files",
        "onboarding.fileStorage.description":
          "Use Builder.io (free) or configure your own S3-compatible object storage.",
        "onboarding.fileStorage.custom": "Use custom keys",
        "composer.connectBuilder": "Connect Builder.io",
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
  }: {
    children: React.ReactNode;
  }) => children,
}));

vi.mock("../setup-connections/BuilderConnectCard.js", () => ({
  BuilderConnectCard: ({
    render,
  }: {
    render: (context: {
      viewModel: { connectFlow: null; pending: false; error: null };
    }) => React.ReactNode;
  }) =>
    render({
      viewModel: { connectFlow: null, pending: false, error: null },
    }),
}));

describe("FileStorageSetupPopover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    expect(container.querySelector("button")?.parentElement?.className).toBe(
      "flex gap-2",
    );
  });
});
