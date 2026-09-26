// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
  flow: {
    statusResolved: false,
    agentNativeProvisioningEnabled: false,
    accountExists: false,
    connecting: false,
    error: null,
    cancel: vi.fn(),
  },
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
    mocks.flow.cancel.mockReset();
    mocks.useBuilderConnectFlow.mockReset().mockReturnValue({
      ...mocks.flow,
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

  it("starts the selected account path from the inline Record setup", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      ...mocks.flow,
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
      start: mocks.start,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} inlineConnect />);
    });

    expect(
      container.querySelector('[data-testid="mock-builder-trigger"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      "agentChat.onboarding.builderCreateAndActivate",
    );
    expect(container.textContent).toContain(
      "agentChat.onboarding.builderConsentPrefix",
    );

    const buttons = container.querySelectorAll("button");
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());

    expect(mocks.start).toHaveBeenNthCalledWith(1, {
      provisionAccount: true,
    });
    expect(mocks.start).toHaveBeenNthCalledWith(2, {
      provisionAccount: false,
    });
  });

  it("keeps the Record CTA in the card while status is loading", () => {
    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} inlineConnect />);
    });

    expect(
      container.querySelector('[data-testid="mock-builder-trigger"]'),
    ).toBeNull();
    expect(container.querySelector("button[disabled]")).not.toBeNull();
  });

  it("shows a localized error after the status-resolved fallback flow fails", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      ...mocks.flow,
      statusResolved: true,
      agentNativeProvisioningEnabled: false,
      error: "Couldn't save Builder credentials: test error.",
      start: mocks.start,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} inlineConnect />);
    });

    expect(container.textContent).toContain("storageSetup.builderConnectError");
    expect(container.textContent).not.toContain("Allow popups");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it.each([true, false])(
    "shows localized popup recovery guidance when provisioning is %s",
    (agentNativeProvisioningEnabled) => {
      mocks.useBuilderConnectFlow.mockReturnValue({
        ...mocks.flow,
        statusResolved: true,
        agentNativeProvisioningEnabled,
        error: "Couldn't open Builder. Allow popups and try again.",
        start: mocks.start,
      });

      act(() => {
        root.render(<StorageSetupCard onConfigured={vi.fn()} inlineConnect />);
      });

      expect(container.textContent).toContain(
        "storageSetup.builderConnectPopupError",
      );
      expect(container.textContent).not.toContain(
        "storageSetup.builderConnectError",
      );
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    },
  );

  it("uses neutral progress copy while an existing account connects", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      ...mocks.flow,
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
      accountExists: true,
      connecting: true,
      start: mocks.start,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} inlineConnect />);
    });

    expect(container.textContent).toContain("storageSetup.waitingForBuilder");
    expect(container.querySelector('button[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain(
      "agentChat.onboarding.builderCreateAndActivate",
    );
  });

  it("lets users cancel a fallback connection while it is connecting", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      ...mocks.flow,
      statusResolved: true,
      agentNativeProvisioningEnabled: false,
      connecting: true,
      start: mocks.start,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} inlineConnect />);
    });

    const cancelButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "common.cancel",
    );
    expect(cancelButton).toBeDefined();

    act(() => cancelButton?.click());

    expect(mocks.flow.cancel).toHaveBeenCalledOnce();
  });
});
