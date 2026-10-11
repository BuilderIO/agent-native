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

vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  useOnboarding: () => ({
    loading: false,
    error: null,
    profile: {
      capabilities: [
        {
          id: "decision-model",
          label: "Decision model",
          builderIncluded: true,
          service: "decision-model",
          whyKey: "decisionModel.why",
          why: "The agent can use a decision model.",
        },
      ],
    },
  }),
}));

// The real consent popover, so these tests prove the card's account creation
// goes through it rather than through a stand-in.
vi.mock("@agent-native/toolkit/app/settings", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/settings")
  >()),
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

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

const CREATE = "agentChat.onboarding.builderCreateAndActivate";
const EXISTING_ACCOUNT = "agentChat.onboarding.builderExistingAccount";
const CONSENT = "agentChat.onboarding.builderConsentPrefix";

function flowState(overrides: Record<string, unknown> = {}) {
  return {
    start: mocks.start,
    cancel: mocks.cancel,
    retry: mocks.retry,
    configured: false,
    envManaged: false,
    accountExists: false,
    effective: "org",
    connecting: false,
    agentNativeProvisioningEnabled: true,
    statusResolved: true,
    statusReadSettledCount: 0,
    errorKind: null,
    hasFetchedStatus: true,
    canConnect: { org: true, personal: false },
    error: null,
    ...overrides,
  };
}

function bodyButton(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes(label),
  );
}

describe("StorageSetupCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function renderCard(onConfigured = vi.fn(), onSkip?: () => void) {
    await act(async () => {
      root.render(
        <StorageSetupCard onConfigured={onConfigured} onSkip={onSkip} />,
      );
    });
    // The shared popover is lazy-loaded; wait for it to replace its fallback.
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }

  async function clickConnect() {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-primary"]',
        )
        ?.click();
    });
  }

  async function createAndActivate() {
    await clickConnect();
    await act(async () => bodyButton(CREATE)?.click());
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.start.mockReset();
    mocks.storageSetupHref = "/settings/general#video-storage";
    mocks.cancel.mockReset();
    mocks.retry.mockReset().mockReturnValue(true);
    mocks.useBuilderConnectFlow.mockReset().mockReturnValue(flowState());
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

  it("shows one Builder action and no inline terms or icons", async () => {
    await renderCard();

    expect(container.textContent).toContain("agentChat.setup.connectBuilder");
    expect(container.textContent).toContain("storageSetup.description");
    expect(container.textContent).not.toContain(CONSENT);
    expect(container.querySelector('a[href*="builder.io/legal"]')).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("offers an optional skip action only when the caller provides it", async () => {
    const onSkip = vi.fn();
    await act(async () => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} onSkip={onSkip} />);
    });

    const skipButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.onboarding.skipForNow",
    );
    expect(skipButton).toBeDefined();
    act(() => skipButton?.click());
    expect(onSkip).toHaveBeenCalledOnce();

    await renderCard();
    expect(container.textContent).not.toContain(
      "agentChat.onboarding.skipForNow",
    );
  });

  it("labels the button for what it will do", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ agentNativeProvisioningEnabled: false }),
    );
    await renderCard();
    expect(container.textContent).toContain("agentChat.setup.connectBuilder");
    expect(container.textContent).not.toContain(
      "storageSetup.createBuilderAccount",
    );

    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ accountExists: true }),
    );
    await renderCard();
    expect(container.textContent).toContain("agentChat.setup.connectBuilder");
  });

  it("creates an account only from the consent popover", async () => {
    await renderCard();

    await clickConnect();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(CONSENT);
    expect(bodyButton(EXISTING_ACCOUNT)).toBeDefined();

    await act(async () => bodyButton(CREATE)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: true,
      scope: "org",
    });
  });

  it("expands included services with help tooltips in the shared popover", async () => {
    await renderCard();

    await clickConnect();
    const includedServices = bodyButton(
      "agentChat.onboarding.builderLlmCreditsAndMoreServices",
    );
    expect(includedServices).toBeDefined();

    await act(async () => includedServices?.click());

    expect(document.body.textContent).toContain("Decision model");
    expect(
      document.body.querySelector(
        'button[aria-label="agentChat.onboarding.capability.about"]',
      ),
    ).toBeDefined();
  });

  it("keeps connecting an existing account in the popover", async () => {
    await renderCard();

    await clickConnect();
    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("never creates an account from the card's other controls", async () => {
    await renderCard();

    await act(async () => {
      for (const control of container.querySelectorAll<HTMLElement>(
        "button:not([data-testid='storage-setup-builder-primary'])",
      )) {
        control.click();
      }
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("keeps the chooser and disables activation when provisioning is unavailable", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ agentNativeProvisioningEnabled: false }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).toContain(CONSENT);
    expect(bodyButton(CREATE)?.disabled).toBe(true);
    expect(bodyButton(EXISTING_ACCOUNT)?.disabled).toBe(false);

    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("does not start anything before account creation capability is known", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({
        agentNativeProvisioningEnabled: false,
        statusResolved: false,
      }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).toContain(CONSENT);
    expect(bodyButton(CREATE)?.disabled).toBe(true);
    expect(bodyButton(EXISTING_ACCOUNT)?.disabled).toBe(false);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("keeps the same two-choice popover when activation finds an existing account", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ accountExists: true }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).toContain(CONSENT);
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderIncludedFree",
    );
    expect(bodyButton(CREATE)).toBeDefined();
    expect(bodyButton(EXISTING_ACCOUNT)).toBeDefined();
    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("keeps the same two-choice popover for an existing Builder credential", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ configured: true, credentialSource: "user" }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).toContain(CONSENT);
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderIncludedFree",
    );
    expect(bodyButton(CREATE)).toBeDefined();
    expect(bodyButton(EXISTING_ACCOUNT)).toBeDefined();

    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("disables the Builder action and keeps Cancel while connecting", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ connecting: true }),
    );
    await renderCard();

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="storage-setup-builder-primary"]',
      )?.disabled,
    ).toBe(true);
    const cancelButtons = [...document.body.querySelectorAll("button")].filter(
      (button) => button.textContent === "common.cancel",
    );
    expect(cancelButtons).toHaveLength(1);
    await act(async () => cancelButtons[0]?.click());
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("uses a personal Builder grant when an org grant cannot be connected", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ canConnect: { org: false, personal: true } }),
    );
    await renderCard();

    await clickConnect();
    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());

    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "personal",
    });
  });

  it("prefers the effective Builder grant when both scopes are connectable", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({
        effective: "personal",
        canConnect: { org: true, personal: true },
      }),
    );
    await renderCard();

    await clickConnect();
    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());

    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "personal",
    });
  });

  it("asks an owner or admin when neither Builder grant can be connected", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ canConnect: { org: false, personal: false } }),
    );
    await renderCard();

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="storage-setup-builder-primary"]',
      )?.disabled,
    ).toBe(true);
    expect(container.textContent).toContain(
      "storageSetup.builderGrantAskAdmin",
    );
  });

  it("finishes storage setup if Builder connects after cancellation", async () => {
    const onConfigured = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ configured: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(onConfigured);
    await createAndActivate();

    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ connecting: true }),
    );
    await act(async () => {
      root.render(<StorageSetupCard onConfigured={onConfigured} />);
    });
    await act(async () => {
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

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onConfigured).toHaveBeenCalledOnce();
  });

  it("finishes setup when Builder upload authorization is ready", async () => {
    const onConfigured = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        configured: true,
        builderConfigured: true,
        builderUploadConfigured: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(onConfigured);
    await createAndActivate();

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onConfigured).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("storageSetup.builderConnected");
  });

  it("lets Skip take precedence over the delayed setup completion", async () => {
    const onConfigured = vi.fn();
    const onSkip = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          configured: true,
          builderConfigured: true,
          builderUploadConfigured: true,
        }),
      ),
    );
    await renderCard(onConfigured, onSkip);
    await createAndActivate();

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("storageSetup.builderConnected");
    const skipButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "agentChat.onboarding.skipForNow",
    );
    expect(skipButton).toBeDefined();
    act(() => skipButton?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onSkip).toHaveBeenCalledOnce();
    expect(onConfigured).not.toHaveBeenCalled();
  });

  it("cancels delayed setup completion when the card unmounts", async () => {
    const onConfigured = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          configured: true,
          builderConfigured: true,
          builderUploadConfigured: true,
        }),
      ),
    );
    await renderCard(onConfigured);
    await createAndActivate();

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<div />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onConfigured).not.toHaveBeenCalled();
  });

  it("stops on an AI-only Builder grant that still needs upload authorization", async () => {
    const onConfigured = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        configured: false,
        builderConfigured: true,
        builderUploadConfigured: false,
        builderReauthorizationRequired: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(onConfigured);
    await createAndActivate();

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "storageSetup.builderUploadGrantMissing",
    );
    expect(container.textContent).not.toContain("storageSetup.builderTimeout");
  });

  it("shows unavailable status with Retry, then accepts a configured retry", async () => {
    const onConfigured = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          configured: true,
          builderConfigured: true,
          builderUploadConfigured: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(onConfigured);
    await createAndActivate();

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("storageSetup.statusUnavailable");
    expect(onConfigured).not.toHaveBeenCalled();
    const retryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "meetingDetail.retry",
    );
    expect(retryButton).toBeDefined();
    act(() => retryButton?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onConfigured).toHaveBeenCalledOnce();
  });

  it("ignores a connection that arrives long after the connect was cancelled", async () => {
    const onConfigured = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ configured: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCard(onConfigured);
    await createAndActivate();

    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ connecting: true }),
    );
    await act(async () => {
      root.render(<StorageSetupCard onConfigured={onConfigured} />);
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="storage-setup-builder-cancel"]',
        )
        ?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
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
      statusResolved: true,
      statusReadSettledCount: 2,
      errorKind: "status-read",
      hasFetchedStatus: true,
      canConnect: { org: true, personal: false },
      error: "Couldn't read the Builder.io connections.",
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    expect(container.textContent).toContain(
      "storageSetup.builderStatusReadError",
    );
    expect(container.textContent).not.toContain(
      "storageSetup.builderConnectError",
    );
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
      statusReadSettledCount: 3,
    });
    await act(async () => {
      root.render(<StorageSetupCard onConfigured={vi.fn()} />);
    });

    const settledRetryButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "meetingDetail.retry",
    );
    expect(settledRetryButton?.disabled).toBe(false);
  });

  it("shows localized browser-tab recovery for embedded Builder launch errors", () => {
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
      errorKind: "launch",
      hasFetchedStatus: true,
      canConnect: { org: true, personal: false },
      error: "No se pudo abrir Builder desde este host de chat.",
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

  it("offers the storage option when Builder setup fails", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ error: "Builder setup failed", errorKind: "connection" }),
    );
    await renderCard();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "storageSetup.builderConnectError",
    );
    expect(
      container.querySelector('a[href="/settings/general#video-storage"]'),
    ).not.toBeNull();
  });

  it("surfaces the timeout while an available status stays unconfigured", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            configured: false,
            builderReauthorizationRequired: false,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderCard();
    await createAndActivate();

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls[0]?.[0] as {
      onConnected: () => void;
    };
    act(() => connectOptions.onConnected());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(container.textContent).toContain("storageSetup.builderTimeout");
    expect(container.querySelector("button[disabled]")).toBeNull();
  });

  it("offers S3-compatible storage to owners and admins", async () => {
    mocks.storageSetupHref = "/settings/infra#uploads";
    await renderCard();

    expect(
      container.querySelector('a[href="/settings/infra#uploads"]')?.textContent,
    ).toBe("settings.s3Title");
    expect(container.textContent).not.toContain(
      "AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO",
    );
  });

  it("asks members to find an owner or admin when they can't set up storage", async () => {
    mocks.storageSetupHref = null;
    await renderCard();

    expect(container.textContent).not.toContain("settings.s3Title");
    expect(container.textContent).toContain("clipsSettings.storageAskAdmin");
  });

  it("points members to an owner or admin when Builder setup fails", async () => {
    mocks.storageSetupHref = null;
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ error: "Builder setup failed" }),
    );
    await renderCard();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "storageSetup.builderConnectErrorAskAdmin",
    );
    expect(container.textContent).toContain("clipsSettings.storageAskAdmin");
    expect(container.textContent).not.toContain("settings.s3Title");
    expect(container.querySelector("a[href]")).toBeNull();
  });
});
