// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(() => true),
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
  hasBuilderOAuthCredential: (status: {
    configured: boolean;
    envManaged?: boolean | null;
    credentialSource?: string | null;
  }) =>
    status.configured &&
    status.credentialSource !== "env" &&
    (!status.envManaged || status.credentialSource != null),
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
    mocks.cancel.mockReset();
    mocks.retry.mockReset().mockReturnValue(true);
    mocks.useBuilderConnectFlow.mockReset().mockReturnValue({
      start: mocks.start,
      cancel: mocks.cancel,
      retry: mocks.retry,
      configured: false,
      envManaged: false,
      accountExists: false,
      connecting: false,
      agentNativeProvisioningEnabled: true,
      statusResolved: true,
      statusReadSettledCount: 0,
      hasFetchedStatus: true,
      error: null,
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

  it("starts provisioning directly and keeps a one-click sign-in path", () => {
    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
        )
        ?.click();
    });
    expect(mocks.start).toHaveBeenNthCalledWith(1, {
      provisionAccount: true,
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-sign-in"]',
        )
        ?.click();
    });
    expect(mocks.start).toHaveBeenNthCalledWith(2, {
      provisionAccount: false,
    });
  });

  it("does not offer account provisioning before its capability is known", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      start: mocks.start,
      configured: false,
      accountExists: false,
      connecting: false,
      agentNativeProvisioningEnabled: false,
      statusResolved: false,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(container.textContent).toContain("storageSetup.connectBuilder");
    expect(container.textContent).not.toContain(
      "storageSetup.createBuilderAccount",
    );
    expect(
      container.querySelector('[data-testid="storage-setup-builder-sign-in"]'),
    ).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
        )
        ?.click();
    });
    expect(mocks.start).toHaveBeenCalledWith({ provisionAccount: false });
  });

  it("uses sign-in as the primary action when account provisioning found an existing account", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      start: mocks.start,
      configured: false,
      accountExists: true,
      agentNativeProvisioningEnabled: true,
      statusResolved: true,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(
      container.querySelector('[data-testid="storage-setup-builder-sign-in"]'),
    ).toBeNull();
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
        )
        ?.click();
    });
    expect(mocks.start).toHaveBeenCalledWith({ provisionAccount: false });
  });

  it("offers provisioning when only deployment-managed Builder credentials are configured", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      start: mocks.start,
      configured: true,
      envManaged: true,
      credentialSource: "env",
      accountExists: false,
      connecting: false,
      agentNativeProvisioningEnabled: true,
      statusResolved: true,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(
      container.querySelector('[data-testid="storage-setup-builder-sign-in"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "storageSetup.builderConsentPrefix",
    );
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
        )
        ?.click();
    });
    expect(mocks.start).toHaveBeenCalledWith({ provisionAccount: true });
  });

  it("disables both Builder actions while OAuth is connecting", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      start: mocks.start,
      cancel: mocks.cancel,
      configured: false,
      envManaged: false,
      accountExists: false,
      connecting: true,
      agentNativeProvisioningEnabled: true,
      statusResolved: true,
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="storage-setup-builder-primary"], [data-testid="storage-setup-builder-sign-in"]',
    );
    expect(buttons).toHaveLength(2);
    expect([...buttons].every((button) => button.disabled)).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();

    const cancelButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="storage-setup-builder-cancel"]',
    );
    expect(cancelButton).not.toBeNull();
    expect(cancelButton?.disabled).toBe(false);
    act(() => cancelButton?.click());
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("does not start storage polling if Builder connects after cancellation", async () => {
    const onConfigured = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ configured: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(<StorageSetupCard onConfigured={onConfigured} />);
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
        )
        ?.click();
    });

    mocks.useBuilderConnectFlow.mockReturnValue({
      start: mocks.start,
      cancel: mocks.cancel,
      configured: false,
      envManaged: false,
      accountExists: false,
      connecting: true,
      agentNativeProvisioningEnabled: true,
      statusResolved: true,
    });
    act(() => {
      root.render(<StorageSetupCard onConfigured={onConfigured} />);
    });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-cancel"]',
        )
        ?.click();
    });

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[
      mocks.useBuilderConnectFlow.mock.calls.length - 1
    ]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onConfigured).not.toHaveBeenCalled();
  });

  it("shows localized recovery and pending feedback while retrying Builder status", async () => {
    const flow = {
      start: mocks.start,
      cancel: mocks.cancel,
      retry: mocks.retry,
      configured: false,
      envManaged: false,
      accountExists: false,
      connecting: false,
      agentNativeProvisioningEnabled: false,
      statusResolved: false,
      statusReadSettledCount: 1,
      hasFetchedStatus: true,
      error: "Couldn't read Builder connection status.",
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(container.textContent).toContain("storageSetup.builderConnectError");
    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "meetingDetail.retry",
    );
    expect(retryButton).toBeDefined();

    act(() => retryButton?.click());

    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(retryButton?.disabled).toBe(true);
    expect(retryButton?.getAttribute("aria-busy")).toBe("true");
    expect(retryButton?.textContent).toContain(
      "storageSetup.checkingBuilderConnection",
    );

    mocks.useBuilderConnectFlow.mockReturnValue({
      ...flow,
      statusReadSettledCount: 2,
    });
    await act(async () => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    const settledRetryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "meetingDetail.retry",
    );
    expect(settledRetryButton?.disabled).toBe(false);
  });

  it("shows localized browser-tab recovery for embedded Builder connection errors", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      start: mocks.start,
      cancel: mocks.cancel,
      retry: mocks.retry,
      configured: false,
      envManaged: false,
      accountExists: false,
      connecting: false,
      agentNativeProvisioningEnabled: true,
      statusResolved: true,
      statusReadSettledCount: 1,
      hasFetchedStatus: true,
      error:
        "Couldn't open Builder from this chat host. Open this app in a browser tab and try Connect Builder again.",
    });

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(container.textContent).toContain(
      "storageSetup.builderConnectPopupError",
    );
    expect(container.textContent).not.toContain(
      "storageSetup.builderConnectError",
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("surfaces the timeout after repeated failed status responses", async () => {
    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
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

    expect(container.textContent).not.toContain("storageSetup.configureS3");
    expect(container.textContent).toContain("clipsSettings.storageAskAdmin");
  });
});
