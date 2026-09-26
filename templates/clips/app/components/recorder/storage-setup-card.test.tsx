// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
  storageSetupHref: "/settings/general#video-storage" as string | null,
}));

vi.mock("@/components/settings/settings-links", () => ({
  useStorageSetupHref: () => mocks.storageSetupHref,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  BuilderConnectPopover: ({
    children,
    onConnect,
  }: {
    children: React.ReactNode;
    onConnect: (provisionAccount: boolean) => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="mock-builder-trigger"
        onClick={() => onConnect(true)}
      >
        Connect Builder
      </button>
      {children}
    </>
  ),
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

vi.mock("@tabler/icons-react", () => {
  const Icon = () => <span />;
  return {
    IconCheck: Icon,
    IconCloud: Icon,
    IconLoader2: Icon,
    IconServer: Icon,
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Tooltip: Passthrough,
    TooltipContent: Passthrough,
    TooltipProvider: Passthrough,
    TooltipTrigger: Passthrough,
  };
});

import { StorageSetupCard } from "./storage-setup-card";

describe("StorageSetupCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.start.mockReset();
    mocks.storageSetupHref = "/settings/general#video-storage";
    mocks.useBuilderConnectFlow.mockReset().mockReturnValue({
      start: mocks.start,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("surfaces the timeout after repeated failed status responses", async () => {
    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="mock-builder-trigger"]',
        )
        ?.click();
    });

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
    });

    expect(container.textContent).toContain("storageSetup.builderTimeout");
    expect(container.querySelector("button[disabled]")).toBeNull();
  });

  it("links owners and admins to storage setup", () => {
    mocks.storageSetupHref = "/settings/infra#uploads";
    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(
      container.querySelector('a[href="/settings/infra#uploads"]'),
    ).not.toBeNull();
  });

  it("asks members to find an owner or admin when they can't set up storage", () => {
    mocks.storageSetupHref = null;
    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("clipsSettings.storageAskAdmin");
  });
});
