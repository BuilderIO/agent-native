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
  trackOnboardingEvent: vi.fn(),
  correlationIds: 0,
}));

vi.mock("@/components/settings/settings-links", () => ({
  useStorageSetupHref: () => mocks.storageSetupHref,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  isWorkspaceRuntime: () => false,
  resolveAppBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  createOnboardingCorrelationId: () => `view-${++mocks.correlationIds}`,
  trackOnboardingEvent: (...args: unknown[]) =>
    mocks.trackOnboardingEvent(...args),
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
const CONNECT = "agentChat.onboarding.builderConnect";
const CONSENT = "agentChat.onboarding.builderConsentPrefix";

function videoStorageStatusResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json({
    configured: true,
    mode: "own",
    hostedRemaining: 0,
    hostedLimit: 3,
    maxClipBytes: 250 * 1024 * 1024,
    maxClipDurationMs: 10 * 60 * 1000,
    builderConfigured: true,
    builderUploadConfigured: true,
    activeProvider:
      overrides.mode && overrides.mode !== "own"
        ? null
        : { id: "builder", name: "Builder.io" },
    ...overrides,
  });
}

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

  async function renderCard(
    onConfigured = vi.fn(),
    onSkip?: () => void,
    description?: string,
    showBuilderStorageOffer = true,
  ) {
    await act(async () => {
      root.render(
        <StorageSetupCard
          onConfigured={onConfigured}
          onSkip={onSkip}
          description={description}
          showBuilderStorageOffer={showBuilderStorageOffer}
        />,
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
    mocks.trackOnboardingEvent.mockReset();
    mocks.correlationIds = 0;
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

  it("offers one active connect action when provisioning is unavailable", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ agentNativeProvisioningEnabled: false }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).not.toContain(CONSENT);
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderActivationUnavailable",
    );
    expect(bodyButton(CREATE)).toBeUndefined();
    expect(bodyButton(EXISTING_ACCOUNT)).toBeUndefined();
    expect(bodyButton(CONNECT)?.disabled).toBe(false);

    await act(async () => bodyButton(CONNECT)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("keeps sign-in available while account creation capability is unknown", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({
        agentNativeProvisioningEnabled: false,
        statusResolved: false,
      }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).not.toContain(CONSENT);
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderActivationChecking",
    );
    expect(bodyButton(CREATE)).toBeUndefined();
    expect(bodyButton(EXISTING_ACCOUNT)).toBeUndefined();
    expect(bodyButton(CONNECT)?.disabled).toBe(false);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("offers only sign-in when activation finds an existing account", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ accountExists: true }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).not.toContain(CONSENT);
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderAccountExistsTitle",
    );
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderIncludedFree",
    );
    expect(bodyButton(CREATE)).toBeUndefined();
    expect(bodyButton(EXISTING_ACCOUNT)).toBeDefined();
    await act(async () => bodyButton(EXISTING_ACCOUNT)?.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: false,
      scope: "org",
    });
  });

  it("offers only sign-in for an existing Builder credential", async () => {
    mocks.useBuilderConnectFlow.mockReturnValue(
      flowState({ configured: true, credentialSource: "user" }),
    );
    await renderCard();

    await clickConnect();
    expect(document.body.textContent).not.toContain(CONSENT);
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderAccountExistsTitle",
    );
    expect(document.body.textContent).toContain(
      "agentChat.onboarding.builderIncludedFree",
    );
    expect(bodyButton(CREATE)).toBeUndefined();
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
    const fetchMock = vi.fn().mockResolvedValue(videoStorageStatusResponse());
    await renderCard(onConfigured);
    await createAndActivate();
    vi.stubGlobal("fetch", fetchMock);

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
    const fetchMock = vi.fn().mockResolvedValue(videoStorageStatusResponse());
    await renderCard(onConfigured);
    await createAndActivate();
    vi.stubGlobal("fetch", fetchMock);

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
    await renderCard(onConfigured, onSkip);
    await createAndActivate();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(videoStorageStatusResponse()),
    );

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
    await renderCard(onConfigured);
    await createAndActivate();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(videoStorageStatusResponse()),
    );

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
      videoStorageStatusResponse({
        configured: false,
        mode: "none",
        builderConfigured: true,
        builderUploadConfigured: false,
        builderReauthorizationRequired: true,
      }),
    );
    await renderCard(onConfigured);
    await createAndActivate();
    vi.stubGlobal("fetch", fetchMock);

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
      .mockResolvedValueOnce(videoStorageStatusResponse());
    await renderCard(onConfigured);
    await createAndActivate();
    vi.stubGlobal("fetch", fetchMock);

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
    const fetchMock = vi.fn().mockResolvedValue(videoStorageStatusResponse());
    await renderCard(onConfigured);
    await createAndActivate();
    vi.stubGlobal("fetch", fetchMock);

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
        videoStorageStatusResponse({
          configured: false,
          mode: "none",
          builderReauthorizationRequired: false,
        }),
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

  it("offers custom keys in a new tab and explains Builder.io's free setup", async () => {
    mocks.storageSetupHref = "/settings/infra#uploads";
    await renderCard(
      vi.fn(),
      undefined,
      "Your recording is safe in this browser.",
    );

    const customKeysLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/settings/infra#uploads"]',
    );
    expect(customKeysLink?.textContent).toBe("storageSetup.customKeys");
    expect(customKeysLink?.target).toBe("_blank");
    expect(customKeysLink?.rel).toBe("noopener noreferrer");
    expect(container.textContent).toContain(
      "Your recording is safe in this browser.",
    );
    expect(container.textContent).toContain("storageSetup.builderStorageOffer");
    expect(container.textContent).not.toContain(
      "AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO",
    );
  });

  it("keeps an exhausted allowance message separate from the free storage offer", async () => {
    await renderCard(
      vi.fn(),
      undefined,
      "Your free storage allowance is exhausted.",
      false,
    );

    expect(container.textContent).toContain(
      "Your free storage allowance is exhausted.",
    );
    expect(container.textContent).not.toContain(
      "storageSetup.builderStorageOffer",
    );
  });

  it("asks members to find an owner or admin when they can't set up storage", async () => {
    mocks.storageSetupHref = null;
    await renderCard();

    expect(container.textContent).not.toContain("storageSetup.customKeys");
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
    expect(container.textContent).not.toContain("storageSetup.customKeys");
    expect(container.querySelector("a[href]")).toBeNull();
  });

  describe("storage step tracking", () => {
    function storageEvents(name?: string) {
      return mocks.trackOnboardingEvent.mock.calls.filter(
        ([eventName]) => name === undefined || eventName === name,
      );
    }

    beforeEach(() => {
      // Storage is unconfigured when setup begins unless a test says otherwise.
      stubStorageStatus(UNCONFIGURED);
      // Like the real flow, start reports connecting and clears the last error.
      mocks.start.mockImplementation(() => {
        mocks.useBuilderConnectFlow.mockReturnValue(
          flowState({ connecting: true }),
        );
      });
    });

    const UNCONFIGURED = {
      configured: false,
      mode: "none",
      builderConfigured: false,
      builderUploadConfigured: false,
    };
    const S3_STORAGE = {
      activeProvider: { id: "s3", name: "S3" },
      builderConfigured: false,
      builderUploadConfigured: false,
    };

    function stubStorageStatus(overrides: Record<string, unknown> = {}) {
      const fetchMock = vi.fn(async () =>
        videoStorageStatusResponse(overrides),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    function connectOptions() {
      return mocks.useBuilderConnectFlow.mock.calls[
        mocks.useBuilderConnectFlow.mock.calls.length - 1
      ]?.[0] as { onConnected: () => void };
    }

    async function showFlow(
      overrides: Record<string, unknown>,
      onConfigured = vi.fn(),
    ) {
      mocks.useBuilderConnectFlow.mockReturnValue(flowState(overrides));
      await act(async () => {
        root.render(<StorageSetupCard onConfigured={onConfigured} />);
      });
    }

    // The real flow goes idle and calls onConnected in the same batch.
    async function handOffToStoragePoll(onConfigured = vi.fn()) {
      await act(async () => {
        mocks.useBuilderConnectFlow.mockReturnValue(
          flowState({ connecting: false }),
        );
        root.render(<StorageSetupCard onConfigured={onConfigured} />);
        connectOptions().onConnected();
      });
    }

    async function settle(ms = 5000) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    async function unmountCard() {
      await act(async () => {
        root.render(<div />);
      });
      await settle();
    }

    function openCustomKeys() {
      act(() =>
        container
          .querySelector<HTMLAnchorElement>(
            'a[href="/settings/general#video-storage"]',
          )
          ?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          ),
      );
    }

    const CONNECT_FAILED = {
      connecting: false,
      error: "Builder.io setup didn't finish.",
      errorKind: "connection",
    };

    // The real flow re-renders the card as connecting once start runs.
    async function startBuilder(onConfigured = vi.fn()) {
      await createAndActivate();
      await showFlow({ connecting: true }, onConfigured);
    }

    async function connectBuilderAndConfigure(onConfigured = vi.fn()) {
      await startBuilder(onConfigured);
      stubStorageStatus();
      await handOffToStoragePoll(onConfigured);
      await settle();
    }

    it("records one view per showing, labeled by the surface", async () => {
      await act(async () => {
        root.render(
          <StorageSetupCard
            onConfigured={vi.fn()}
            connectSource="clips_record_storage_setup_card"
          />,
        );
      });
      await act(async () => {
        root.render(
          <StorageSetupCard
            onConfigured={vi.fn()}
            connectSource="clips_record_storage_setup_card"
          />,
        );
      });

      expect(storageEvents()).toEqual([
        [
          "onboarding_step_viewed",
          {
            step_id: "file-storage",
            flow: "clips_record_storage_setup_card",
            step_view_id: "view-1",
          },
        ],
      ]);
    });

    it("ties every step event to the recording waiting on storage", async () => {
      const onSkip = vi.fn();
      await act(async () => {
        root.render(
          <StorageSetupCard
            onConfigured={vi.fn()}
            onSkip={onSkip}
            connectSource="clips_record_after_stop"
            recordingAttemptId="local-7"
          />,
        );
      });
      act(() => bodyButton("agentChat.onboarding.skipForNow")?.click());

      await act(async () => {
        root.render(
          <StorageSetupCard
            onConfigured={vi.fn()}
            connectSource="clips_recording_page_storage_setup_card"
            outputId="rec-9"
          />,
        );
      });

      expect(storageEvents()).toEqual([
        [
          "onboarding_step_viewed",
          expect.objectContaining({ recording_attempt_id: "local-7" }),
        ],
        [
          "onboarding_step_skipped",
          expect.objectContaining({ recording_attempt_id: "local-7" }),
        ],
        [
          "onboarding_step_viewed",
          {
            step_id: "file-storage",
            flow: "clips_recording_page_storage_setup_card",
            step_view_id: "view-1",
            output_id: "rec-9",
          },
        ],
      ]);
    });

    it("records an explicit skip once, and no completion", async () => {
      const onSkip = vi.fn();
      await renderCard(vi.fn(), onSkip);

      act(() => bodyButton("agentChat.onboarding.skipForNow")?.click());

      expect(onSkip).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_skipped")).toEqual([
        [
          "onboarding_step_skipped",
          {
            step_id: "file-storage",
            flow: "clips_file_upload_storage_setup_card",
            step_view_id: "view-1",
          },
        ],
      ]);
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records the Builder choice and one completion when storage is configured", async () => {
      const onConfigured = vi.fn();
      await renderCard(onConfigured);

      await connectBuilderAndConfigure(onConfigured);

      expect(onConfigured).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_method_clicked")).toEqual([
        [
          "onboarding_method_clicked",
          {
            step_id: "file-storage",
            flow: "clips_file_upload_storage_setup_card",
            step_view_id: "view-1",
            method_id: "builder",
          },
        ],
      ]);
      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          {
            step_id: "file-storage",
            flow: "clips_file_upload_storage_setup_card",
            step_view_id: "view-1",
            method_id: "builder",
          },
        ],
      ]);
      expect(storageEvents("onboarding_step_skipped")).toHaveLength(0);
    });

    it("records the S3 choice without claiming completion", async () => {
      await renderCard();

      act(() =>
        container
          .querySelector<HTMLAnchorElement>(
            'a[href="/settings/general#video-storage"]',
          )
          ?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          ),
      );

      expect(storageEvents("onboarding_method_clicked")).toEqual([
        [
          "onboarding_method_clicked",
          {
            step_id: "file-storage",
            flow: "clips_file_upload_storage_setup_card",
            step_view_id: "view-1",
            method_id: "s3",
          },
        ],
      ]);
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records nothing past the view while storage stays unconfigured", async () => {
      await renderCard(vi.fn(), vi.fn());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(storageEvents().map(([name]) => name)).toEqual([
        "onboarding_step_viewed",
      ]);
    });

    it("records completion when the route unmounts the card as Builder connects", async () => {
      await renderCard();
      await startBuilder();
      stubStorageStatus();
      await handOffToStoragePoll();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({
            step_view_id: "view-1",
            method_id: "builder",
          }),
        ],
      ]);
    });

    it("records completion when the card unmounts before Builder reports the connect", async () => {
      await renderCard();
      await startBuilder();
      stubStorageStatus();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({ method_id: "builder" }),
        ],
      ]);
    });

    it("still finishes setup when Builder connects after the attempt failed", async () => {
      const onConfigured = vi.fn();
      await renderCard(onConfigured);
      await startBuilder(onConfigured);
      await showFlow(CONNECT_FAILED, onConfigured);
      stubStorageStatus();
      await handOffToStoragePoll(onConfigured);
      await settle();

      expect(onConfigured).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(1);
    });

    it("records completion when a failed attempt connects late and the route unmounts the card", async () => {
      await renderCard();
      await startBuilder();
      await showFlow(CONNECT_FAILED);
      stubStorageStatus();
      await handOffToStoragePoll();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({ method_id: "builder" }),
        ],
      ]);
    });

    it("reads no status on unmount after a failed attempt the card never accepted", async () => {
      await renderCard();
      await startBuilder();
      await showFlow(CONNECT_FAILED);
      const fetchMock = stubStorageStatus();
      await unmountCard();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });
    it("records no completion when free hosted clips read as configured", async () => {
      await renderCard();
      await startBuilder();
      stubStorageStatus({ mode: "hosted", hostedRemaining: 3 });
      await handOffToStoragePoll();
      await settle();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records the provider that actually finished setup", async () => {
      await renderCard();
      await startBuilder();
      stubStorageStatus(S3_STORAGE);
      await handOffToStoragePoll();
      await settle();

      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({ method_id: "s3" }),
        ],
      ]);
    });

    it("records one completion, and reads no more status once it is recorded", async () => {
      await renderCard();
      openCustomKeys();
      await connectBuilderAndConfigure();
      const fetchMock = stubStorageStatus();
      await unmountCard();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(1);
    });

    it("credits no connection the card ignored after a cancel's recovery window", async () => {
      await renderCard();
      await startBuilder();
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="storage-setup-builder-cancel"]',
          )
          ?.click();
      });
      await showFlow(CONNECT_FAILED);
      await settle(61_000);
      const fetchMock = stubStorageStatus();
      await handOffToStoragePoll();
      await settle(3000);
      await unmountCard();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("credits a connection when the route unmounts the card during the cancel's popup grace", async () => {
      await renderCard();
      await startBuilder();
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="storage-setup-builder-cancel"]',
          )
          ?.click();
      });
      // The real flow keeps connecting until its popup-closed grace ends.
      await showFlow({ connecting: true });
      stubStorageStatus();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toHaveLength(1);
    });

    it("reads no status on return to the tab after Skip", async () => {
      const onSkip = vi.fn();
      await renderCard(vi.fn(), onSkip);
      openCustomKeys();
      act(() => bodyButton("agentChat.onboarding.skipForNow")?.click());
      const fetchMock = stubStorageStatus(S3_STORAGE);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("reads no status on unmount after Skip", async () => {
      const onSkip = vi.fn();
      await renderCard(vi.fn(), onSkip);
      await createAndActivate();
      mocks.useBuilderConnectFlow.mockReturnValue(
        flowState({ connecting: true }),
      );
      await act(async () => {
        root.render(
          <StorageSetupCard onConfigured={vi.fn()} onSkip={onSkip} />,
        );
      });
      act(() => bodyButton("agentChat.onboarding.skipForNow")?.click());
      const fetchMock = stubStorageStatus();
      await unmountCard();

      expect(onSkip).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records no completion when setup was started but storage stays unconfigured", async () => {
      await renderCard();
      await startBuilder();
      const fetchMock = stubStorageStatus(UNCONFIGURED);
      await unmountCard();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records nothing and only warns when the closing status read fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await renderCard();
      await startBuilder();
      const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);
      await unmountCard();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        "[storage-setup] completion check failed:",
        expect.anything(),
      );
      warn.mockRestore();
    });

    it("records completion when the first storage check fails and the route then unmounts the card", async () => {
      await renderCard();
      await startBuilder();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 503 })),
      );
      await handOffToStoragePoll();
      await settle(3000);
      stubStorageStatus();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({ method_id: "builder" }),
        ],
      ]);
    });

    it("credits a connection the card accepts inside a cancel's recovery window", async () => {
      await renderCard();
      await startBuilder();
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="storage-setup-builder-cancel"]',
          )
          ?.click();
      });
      await showFlow(CONNECT_FAILED);
      stubStorageStatus();
      await handOffToStoragePoll();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toHaveLength(1);
    });
    it("credits no custom-keys setup after the credit window", async () => {
      await renderCard();
      openCustomKeys();
      await settle(16 * 60_000);
      const fetchMock = stubStorageStatus(S3_STORAGE);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(100);
      });
      await unmountCard();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("reads no status on unmount when no setup was started", async () => {
      const fetchMock = stubStorageStatus();
      await renderCard();
      await unmountCard();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records custom-keys completion when the card unmounts with storage configured", async () => {
      await renderCard();
      openCustomKeys();
      stubStorageStatus(S3_STORAGE);
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({ method_id: "s3" }),
        ],
      ]);
    });

    it("records custom-keys completion once on return to the tab while the card stays mounted", async () => {
      await renderCard();
      openCustomKeys();
      const fetchMock = stubStorageStatus(S3_STORAGE);
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_completed")).toEqual([
        [
          "onboarding_step_completed",
          expect.objectContaining({ method_id: "s3" }),
        ],
      ]);
    });

    it("records one completion when a return read and the unmount read land together", async () => {
      await renderCard();
      openCustomKeys();
      const pending: Array<() => void> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              pending.push(() =>
                resolve(videoStorageStatusResponse(S3_STORAGE)),
              );
            }),
        ),
      );
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await act(async () => {
        root.render(<div />);
      });
      expect(pending).toHaveLength(2);
      await act(async () => {
        pending.forEach((resolve) => resolve());
      });
      await settle(100);

      expect(storageEvents("onboarding_step_completed")).toHaveLength(1);
    });

    it("reads no status on return to the tab when custom keys were never opened", async () => {
      const fetchMock = stubStorageStatus(S3_STORAGE);
      await renderCard();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps the reason the card first showed for every event of the showing", async () => {
      await act(async () => {
        root.render(
          <StorageSetupCard
            onConfigured={vi.fn()}
            setupReason="status_unavailable"
          />,
        );
      });
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      await act(async () => {
        root.render(
          <StorageSetupCard
            onConfigured={vi.fn()}
            setupReason="hosted_exhausted"
          />,
        );
      });
      await startBuilder();
      stubStorageStatus();
      await handOffToStoragePoll();
      await settle();

      expect(
        storageEvents().map(([name, props]) => [name, props.setup_reason]),
      ).toEqual([
        ["onboarding_step_viewed", "status_unavailable"],
        ["onboarding_method_clicked", "status_unavailable"],
        ["onboarding_step_completed", "status_unavailable"],
      ]);
    });

    it("credits no Builder setup when storage was already configured at the click", async () => {
      const onConfigured = vi.fn();
      stubStorageStatus();
      await renderCard(onConfigured);
      await startBuilder(onConfigured);
      await handOffToStoragePoll(onConfigured);
      await settle();
      await unmountCard();

      expect(onConfigured).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("credits no custom-keys setup when storage was already configured at the click", async () => {
      stubStorageStatus(S3_STORAGE);
      await renderCard();
      openCustomKeys();
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("records nothing and only warns when storage before setup can't be read", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 503 })),
      );
      await renderCard();
      openCustomKeys();
      stubStorageStatus(S3_STORAGE);
      await unmountCard();

      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        "[storage-setup] storage before setup could not be read:",
        expect.anything(),
      );
      warn.mockRestore();
    });

    it("reads storage before setup as the connect popover opens, before any setup request", async () => {
      const fetchMock = stubStorageStatus(UNCONFIGURED);
      await renderCard();
      await clickConnect();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(mocks.start).not.toHaveBeenCalled();
    });

    it("reads storage before setup once per showing", async () => {
      const fetchMock = stubStorageStatus(UNCONFIGURED);
      await renderCard();
      openCustomKeys();
      await startBuilder();

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("records no completion when Skip lands while a return read is in flight", async () => {
      const onSkip = vi.fn();
      await renderCard(vi.fn(), onSkip);
      openCustomKeys();
      await settle(100);
      let resolveRead = () => {};
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              resolveRead = () =>
                resolve(videoStorageStatusResponse(S3_STORAGE));
            }),
        ),
      );
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      act(() => bodyButton("agentChat.onboarding.skipForNow")?.click());
      await act(async () => resolveRead());
      await settle(100);

      expect(onSkip).toHaveBeenCalledOnce();
      expect(storageEvents("onboarding_step_completed")).toHaveLength(0);
    });

    it("still skips when tracking throws", async () => {
      mocks.trackOnboardingEvent.mockImplementation(() => {
        throw new Error("tracker down");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onSkip = vi.fn();
      await renderCard(vi.fn(), onSkip);

      act(() => bodyButton("agentChat.onboarding.skipForNow")?.click());

      expect(onSkip).toHaveBeenCalledOnce();
      warn.mockRestore();
    });
  });
});
