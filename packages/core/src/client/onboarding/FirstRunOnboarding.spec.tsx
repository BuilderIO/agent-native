// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadCoreMessagesForLocale } from "../../localization/core-messages.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { AgentNativeI18nProvider } from "../i18n.js";
import { registerFirstRunOnboardingExtension } from "./first-run-registry.js";
import { FirstRunOnboarding } from "./FirstRunOnboarding.js";

const mocks = vi.hoisted(() => ({
  completeFirstRun: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
  routePathname: "/",
  trackOnboardingEvent: vi.fn(),
  useOnboarding: vi.fn(),
  useOnboardingPreviewMode: vi.fn(),
  useOnboardingPreviewStep: vi.fn(),
  firstRunMode: "off" as "off" | "connect" | "connect-and-integrations",
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLocation: () => ({ pathname: mocks.routePathname }),
  };
});

vi.mock("./use-onboarding.js", () => ({
  trackOnboardingEvent: mocks.trackOnboardingEvent,
  useOnboarding: mocks.useOnboarding,
}));

vi.mock("./use-preview-mode.js", () => ({
  ONBOARDING_PREVIEW_QUERY_PARAM: "onboarding",
  ONBOARDING_PREVIEW_STEP_QUERY_PARAM: "step",
  useOnboardingPreviewMode: mocks.useOnboardingPreviewMode,
  useOnboardingPreviewStep: mocks.useOnboardingPreviewStep,
}));

vi.mock("./first-run-enabled.js", () => ({
  resolveFirstRunOnboardingMode: () => mocks.firstRunMode,
}));

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

describe("FirstRunOnboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.completeFirstRun.mockReset();
    mocks.routePathname = "/";
    mocks.completeFirstRun.mockResolvedValue(undefined);
    mocks.useBuilderConnectFlow.mockReset();
    mocks.trackOnboardingEvent.mockReset();
    mocks.useOnboarding.mockReset();
    mocks.useOnboardingPreviewMode.mockReset();
    mocks.useOnboardingPreviewStep.mockReset();
    mocks.useOnboardingPreviewMode.mockReturnValue(false);
    mocks.useOnboardingPreviewStep.mockReturnValue(null);
    mocks.firstRunMode = "off";
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: false,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [
          {
            id: "llm",
            label: "LLM",
            required: true,
            builderIncluded: true,
            keySummary: "LLM provider key",
            why: "Needed for chat",
          },
          {
            id: "images",
            label: "Images",
            required: false,
            suggested: true,
            builderIncluded: true,
            keySummary: "Image provider key",
            why: "Needed for image generation",
          },
          {
            id: "figma",
            label: "Figma",
            required: false,
            builderIncluded: false,
            keySummary: "Figma personal access token",
            why: "Only needed to read or update files in Figma.",
          },
          {
            id: "design-system-intelligence",
            label: "Design system intelligence",
            required: false,
            builderIncluded: true,
            keySummary: "Builder Design System Intelligence",
            why: "Uses your brand and design-system guidance to keep generated work on brand.",
          },
        ],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: null,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.querySelectorAll("[data-radix-portal]").forEach((node) => {
      node.remove();
    });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  it("renders nothing while an ineligible member's status is resolving", () => {
    mocks.useOnboarding.mockReturnValue({
      firstRun: false,
      loading: true,
      error: null,
      profile: null,
      completeFirstRun: mocks.completeFirstRun,
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    expect(document.body.querySelector("[data-onboarding-loading]")).toBeNull();
    expect(document.body.querySelector("[data-onboarding-screen]")).toBeNull();
  });

  it("does not show a close button during first-run setup", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    expect(
      document.body.querySelector('[data-testid="first-run-dismiss"]'),
    ).toBeNull();
    expect(
      document.body.querySelector('[data-testid="first-run-role-skip"]'),
    ).not.toBeNull();
  });

  it("records the current step when setup is abandoned on page exit", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_abandoned",
      {
        flow: "first_run",
        step_id: "role",
        step_index: 0,
        reason: "page_exit",
      },
    );
  });

  it("does not report a BFCache pagehide as abandonment but tracks a later exit", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    const persistedPageHide = new Event("pagehide");
    Object.defineProperty(persistedPageHide, "persisted", { value: true });
    act(() => window.dispatchEvent(persistedPageHide));

    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_abandoned",
      expect.anything(),
    );

    act(() => window.dispatchEvent(new Event("pageshow")));
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_abandoned",
      expect.objectContaining({ flow: "first_run", reason: "page_exit" }),
    );
  });

  it("does not report page exit while completion is in flight", async () => {
    let resolveCompletion: (() => void) | undefined;
    mocks.completeFirstRun.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: true,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-role-skip"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_abandoned",
      expect.anything(),
    );

    await act(async () => {
      resolveCompletion?.();
      await Promise.resolve();
    });
  });

  it("surfaces a failed setup completion with a retry action", async () => {
    mocks.completeFirstRun.mockRejectedValue(
      new Error("first-run completion failed: 500"),
    );
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: "first-run completion failed: 500",
    });
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: true,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-role-skip"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "first-run completion failed: 500",
    );
    const retry = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    );
    expect(retry).not.toBeUndefined();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(2);
  });

  it("tracks abandonment after completion fails and the retry state is shown", async () => {
    mocks.completeFirstRun.mockRejectedValueOnce(
      new Error("first-run completion failed: 500"),
    );
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: "first-run completion failed: 500",
    });
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: true,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-role-skip"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_abandoned",
      expect.objectContaining({ flow: "first_run", reason: "page_exit" }),
    );
  });

  it("renders the create-account and sign-in Builder buttons", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      document.body.querySelector(
        '[data-testid="first-run-builder-create-account"]',
      )?.textContent,
    ).toBe("Create Builder.io account");
    expect(
      document.body.querySelector('[data-testid="first-run-builder-sign-in"]')
        ?.textContent,
    ).toBe("Sign in with Builder.io account");
  });

  it("starts the Builder connection directly when no provisioning choice is needed", () => {
    const start = vi.fn();
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start,
      retry: vi.fn(),
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-create-account']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(start).toHaveBeenCalledOnce();
  });

  it("lets users cancel a direct Builder connect during first run", () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
    };
    flow.start.mockImplementation(() => {
      flow.connecting = true;
    });
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-create-account']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const cancelButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='first-run-cancel-builder']",
    );
    expect(cancelButton?.textContent).toBe("Cancel");
    act(() => cancelButton?.click());
    expect(flow.cancel).toHaveBeenCalledOnce();
  });

  it("creates a Builder account from the primary button and shows its loading state", () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      connecting: false,
      error: null,
      start: vi.fn(),
    };
    flow.start.mockImplementation(() => {
      flow.connecting = true;
    });
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain(
      "Activating Builder.io free credits",
    );
    expect(document.body.textContent).toContain(
      "Creating or reusing your Builder.io account",
    );
    expect(
      document.body.querySelector('[role="status"][aria-busy="true"]'),
    ).toBeTruthy();
    expect(flow.start).toHaveBeenCalledOnce();
    expect(flow.start).toHaveBeenCalledWith(
      expect.objectContaining({ provisionAccount: true }),
    );
  });

  it("joins a first-run Builder choice to its connection outcome", async () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      connecting: false,
      error: null,
      start: vi.fn(),
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.click();
    });

    const selectedEvent = mocks.trackOnboardingEvent.mock.calls.find(
      ([name, properties]) =>
        name === "onboarding_method_clicked" &&
        (properties as Record<string, unknown>).method_id ===
          "builder_create_account",
    );
    const attemptId = (selectedEvent?.[1] as Record<string, unknown>)
      ?.onboarding_attempt_id;
    expect(attemptId).toEqual(expect.any(String));
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_started",
      expect.objectContaining({
        method_id: "builder_create_account",
        onboarding_attempt_id: attemptId,
      }),
    );

    const connectOptions = mocks.useBuilderConnectFlow.mock.calls.at(
      -1,
    )?.[0] as {
      onConnected?: (state: { orgName: string | null }) => void | Promise<void>;
    };
    await act(async () => {
      await connectOptions.onConnected?.({ orgName: null });
    });

    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "builder_create_account",
        onboarding_attempt_id: attemptId,
        outcome: "connected",
      }),
    );
  });

  it("uses one Builder continue action for connect-mode setup", () => {
    mocks.firstRunMode = "connect";
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      connecting: false,
      error: null,
      start: vi.fn(),
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });

    const continueButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='first-run-builder-continue']",
    );
    expect(continueButton?.textContent).toContain("Continue");
    expect(
      document.body.querySelector("[data-testid='first-run-builder-sign-in']"),
    ).toBeNull();
    expect(document.body.textContent).toContain("Use my own API keys");
    expect(document.body.textContent).not.toContain("What's included");
    expect(
      document.body.querySelector(
        "a[href='https://www.builder.io/legal/terms']",
      ),
    ).toBeTruthy();

    act(() => continueButton?.click());

    expect(flow.start).toHaveBeenCalledWith(
      expect.objectContaining({ provisionAccount: true }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_clicked",
      expect.objectContaining({ method_id: "builder_create_account" }),
    );
  });

  it("falls back to Builder sign-in when account provisioning is disabled", () => {
    mocks.firstRunMode = "connect";
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-continue']")
        ?.click();
    });

    expect(flow.start).toHaveBeenCalledWith(
      expect.objectContaining({ provisionAccount: false }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_clicked",
      expect.objectContaining({ method_id: "builder_sign_in" }),
    );
  });

  it("waits for Builder status before choosing a setup path", () => {
    mocks.firstRunMode = "connect";
    const flow = {
      hasFetchedStatus: false,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      retry: vi.fn(() => true),
      start: vi.fn(),
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });

    const continueButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='first-run-builder-continue']",
    );
    expect(continueButton?.disabled).toBe(true);
    act(() => continueButton?.click());
    expect(flow.start).not.toHaveBeenCalled();

    mocks.useBuilderConnectFlow.mockReturnValue({
      ...flow,
      hasFetchedStatus: true,
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
    });
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => continueButton?.click());

    expect(flow.start).toHaveBeenCalledWith(
      expect.objectContaining({ provisionAccount: true }),
    );
  });

  it("lets users retry a failed Builder status check", () => {
    mocks.firstRunMode = "connect";
    const retry = vi.fn(() => true);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: "Couldn't reach Builder to check your account. Retrying.",
      retry,
      start: vi.fn(),
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    expect(
      document.body.querySelector(
        "[data-testid='first-run-builder-status-error']",
      )?.textContent,
    ).toBe("Couldn't check AI connection.");
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-status-error']")
        ?.parentElement?.querySelector("button")
        ?.click();
    });

    expect(retry).toHaveBeenCalledOnce();
  });

  it("opens API key settings only after choosing the manual option", async () => {
    mocks.firstRunMode = "connect";

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.click();
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/settings/keys");
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_clicked",
      expect.objectContaining({ method_id: "custom_keys" }),
    );
    window.history.replaceState(null, "", "/");
  });

  it("lets connect-mode users skip into the app without opening key settings", async () => {
    mocks.firstRunMode = "connect";
    window.history.replaceState(null, "", "/home");

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-skip-to-app']")
        ?.click();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/home");
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_clicked",
      expect.objectContaining({
        method_id: "skip_to_app",
        method_kind: "skip",
      }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_step_skipped",
      expect.objectContaining({
        step_id: "choice",
        reason: "skip_to_app",
      }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "skip_to_app",
        outcome: "skipped_to_app",
      }),
    );
    window.history.replaceState(null, "", "/");
  });

  it("records the skipped choice after completion succeeds on retry", async () => {
    mocks.firstRunMode = "connect";
    mocks.completeFirstRun
      .mockRejectedValueOnce(new Error("first-run completion failed: 500"))
      .mockResolvedValueOnce(undefined);
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: "first-run completion failed: 500",
    });
    window.history.replaceState(null, "", "/home");

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-skip-to-app']")
        ?.click();
      await Promise.resolve();
    });

    const choiceSkipped = () =>
      mocks.trackOnboardingEvent.mock.calls.filter(
        ([event, properties]) =>
          event === "onboarding_step_skipped" &&
          (properties as Record<string, unknown>).step_id === "choice",
      );
    expect(choiceSkipped()).toHaveLength(0);
    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "skip_to_app",
        outcome: "handoff_failed",
      }),
    );

    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Try again")
        ?.click();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(2);
    expect(choiceSkipped()).toHaveLength(1);
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "skip_to_app",
        outcome: "skipped_to_app",
      }),
    );
    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({ outcome: "handoff_failed" }),
    );
    window.history.replaceState(null, "", "/");
  });

  it("keeps the existing setup chooser for connect-and-integrations mode", () => {
    mocks.firstRunMode = "connect-and-integrations";

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });

    expect(
      document.body.querySelector(
        "[data-testid='first-run-builder-create-account']",
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector("[data-testid='first-run-builder-continue']"),
    ).toBeNull();
  });

  it("records Builder account-exists as a sanitized failed outcome", () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      error: null,
      start: vi.fn(),
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.click();
    });

    flow.accountExists = true;
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "builder_create_account",
        outcome: "failed",
        error_type: "account_exists",
        onboarding_attempt_id: expect.any(String),
      }),
    );
    const outcome = mocks.trackOnboardingEvent.mock.calls.find(
      ([name, properties]) =>
        name === "onboarding_method_outcome" &&
        (properties as Record<string, unknown>).method_id ===
          "builder_create_account",
    );
    expect(JSON.stringify(outcome)).not.toContain("Error:");
  });

  it("does not attach a stale Builder error to a later manual setup attempt", async () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      error: null as string | null,
      start: vi.fn(),
    };
    let resolveCompletion: (() => void) | undefined;
    mocks.completeFirstRun.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-create-account']")
        ?.click();
    });

    flow.error = "stale Builder error";
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Try again")
        ?.click();
    });

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.click();
      await Promise.resolve();
    });
    flow.error = "stale Builder error changed";
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    await act(async () => {
      resolveCompletion?.();
      await Promise.resolve();
    });

    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({ method_id: "custom_keys", outcome: "failed" }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "custom_keys",
        outcome: "settings_opened",
        onboarding_attempt_id: expect.any(String),
      }),
    );
  });

  it("shows the full list of included Builder.io services on the card", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    for (const service of [
      "Voice input",
      "Background agents",
      "Image generation",
      "Video generation",
      "Connected agents",
      "Hosting and deployment",
      "Browser automation",
      "Embeddings",
    ]) {
      expect(document.body.textContent).toContain(service);
    }
    expect(
      [...document.body.querySelectorAll("button")].find((button) =>
        button.textContent?.trim().endsWith("more"),
      ),
    ).toBeUndefined();
  });

  it("keeps per-app optional keys off both setup cards", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("LLM provider key");
    expect(document.body.textContent).toContain("Image provider key");
    expect(document.body.textContent).not.toContain(
      "Figma personal access token",
    );
    expect(document.body.textContent).not.toContain("Optional");
  });

  it("uses the existing-account connection flow from the sign-in button", () => {
    const start = vi.fn();
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      connecting: false,
      error: null,
      start,
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-sign-in"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(start).toHaveBeenCalledWith({
      trackingSource: "first_run_onboarding",
      trackingFlow: "connect_llm",
      provisionAccount: false,
    });
    expect(document.body.textContent).toContain(
      "Connecting Builder.io free credits",
    );
  });

  it("offers login when provisioning finds an existing Builder account", () => {
    const start = vi.fn();
    const retry = vi.fn();
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      error: null,
      retry,
      start,
    };
    mocks.useBuilderConnectFlow.mockReturnValue(flow);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      (
        document.body.querySelector(
          '[data-testid="first-run-builder-create-account"]',
        ) as HTMLButtonElement | null
      )?.click();
    });

    mocks.useBuilderConnectFlow.mockReturnValue({
      ...flow,
      accountExists: true,
    });
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain(
      "You already have a Builder.io account",
    );
    const logIn = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Log in",
    );
    expect(logIn).toBeTruthy();

    act(() => logIn?.click());

    expect(start).toHaveBeenLastCalledWith({
      trackingSource: "first_run_onboarding",
      trackingFlow: "connect_llm",
      provisionAccount: false,
    });
  });

  it("shows the role step first", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    expect(
      document.body.querySelector("[data-onboarding-screen='role']"),
    ).toBeTruthy();
    expect(document.body.textContent).toContain(
      "What best describes your role?",
    );
    expect(document.body.textContent).not.toContain("Choose your setup.");
    expect(document.body.textContent).not.toContain("This app is an agent.");
  });

  it("opens the app directly after a configured Builder connection", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: true,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-create-account']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
  });

  it("only records first-run steps completed after moving forward", async () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    const completedSteps = () =>
      mocks.trackOnboardingEvent.mock.calls
        .filter(([event]) => event === "onboarding_step_completed")
        .map(([, properties]) => (properties as { step_id: string }).step_id);
    const skippedSteps = () =>
      mocks.trackOnboardingEvent.mock.calls
        .filter(([event]) => event === "onboarding_step_skipped")
        .map(([, properties]) => (properties as { step_id: string }).step_id);

    expect(completedSteps()).toEqual([]);
    expect(skippedSteps()).toEqual([]);

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(completedSteps()).toEqual([]);
    expect(skippedSteps()).toEqual(["role"]);

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(completedSteps()).toEqual(["choice"]);
    expect(skippedSteps()).toEqual(["role"]);
    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    const methodClick = mocks.trackOnboardingEvent.mock.calls.find(
      ([event, properties]) =>
        event === "onboarding_method_clicked" &&
        (properties as Record<string, unknown>).method_id === "custom_keys",
    );
    const attemptId = (methodClick?.[1] as Record<string, unknown>)
      ?.onboarding_attempt_id;
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "custom_keys",
        onboarding_attempt_id: attemptId,
        outcome: "settings_opened",
      }),
    );
    window.history.replaceState(null, "", "/");
  });

  it("does not start duplicate manual setup attempts while completion is pending", async () => {
    let resolveCompletion: (() => void) | undefined;
    mocks.completeFirstRun.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        }),
    );

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const manualSetupButton = document.body.querySelector(
      "[data-testid='first-run-open-key-settings']",
    );
    act(() => {
      manualSetupButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      manualSetupButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    expect(
      mocks.trackOnboardingEvent.mock.calls.filter(
        ([event, properties]) =>
          event === "onboarding_method_clicked" &&
          (properties as Record<string, unknown>).method_id === "custom_keys",
      ),
    ).toHaveLength(1);

    await act(async () => {
      resolveCompletion?.();
    });

    expect(
      mocks.trackOnboardingEvent.mock.calls.filter(
        ([event, properties]) =>
          event === "onboarding_method_outcome" &&
          (properties as Record<string, unknown>).method_id === "custom_keys",
      ),
    ).toHaveLength(1);
    window.history.replaceState(null, "", "/");
  });

  it("strips the onboarding preview query when navigating to settings", async () => {
    window.history.replaceState(
      null,
      "",
      "/home?onboarding=preview&step=choice",
    );

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.location.search).not.toContain("onboarding=preview");
    expect(window.location.search).not.toContain("step=choice");
    window.history.replaceState(null, "", "/");
  });

  it("saves the selected role before moving to the connect step", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    expect(
      document.body.querySelector("[data-onboarding-screen='role']"),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Product");
    expect(document.body.textContent).toContain("Individual");

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-developer'] input")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector("[data-onboarding-screen='role'] button.bg-primary")
        ?.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/onboarding/first-run/role"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ role: "developer" }),
      }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_role_save_started",
      { flow: "first_run", step_id: "role", role: "developer" },
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_role_option_selected",
      { flow: "first_run", step_id: "role", role: "developer" },
    );
    expect(
      document.body.querySelector("[data-onboarding-screen='choice']"),
    ).toBeTruthy();
    expect(mocks.completeFirstRun).not.toHaveBeenCalled();

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    window.history.replaceState(null, "", "/");
  });

  it("saves a custom role when Other is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-other'] input")
        ?.click();
    });

    const continueButton = document.body.querySelector(
      "[data-onboarding-screen='role'] button.bg-primary",
    ) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);

    const input = document.body.querySelector(
      "[data-testid='first-run-role-other-input']",
    ) as HTMLInputElement;
    act(() => {
      const setNativeValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setNativeValue?.call(input, "  Content strategist  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(continueButton.disabled).toBe(false);
    await act(async () => {
      continueButton.click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/onboarding/first-run/role"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ role: "Content strategist" }),
      }),
    );
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_role_save_started",
      { flow: "first_run", step_id: "role", role: "other" },
    );
  });

  // Keep the final-step identity until completion succeeds so retry records it.
  it("preserves the completed step when first-run completion succeeds on retry", async () => {
    mocks.completeFirstRun
      .mockRejectedValueOnce(new Error("first-run completion failed: 500"))
      .mockResolvedValueOnce(undefined);
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: "first-run completion failed: 500",
    });
    registerFirstRunOnboardingExtension({
      id: "test-extension",
      component: ({ onComplete, onSkip }) => (
        <>
          <button type="button" onClick={onComplete}>
            Extension Complete
          </button>
          <button type="button" onClick={onSkip}>
            Extension Skip
          </button>
        </>
      ),
    });
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: true,
      agentNativeProvisioningEnabled: false,
      connecting: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-builder-create-account']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Extension Complete");
    expect(
      document.body.querySelector('[data-testid="first-run-dismiss"]'),
    ).toBeNull();

    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Extension Complete")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(1);
    // Stays on the same step — no crash, no misleading full-screen bounce —
    // and the failure is visible with a way forward.
    expect(document.body.textContent).toContain("Extension Complete");
    expect(document.body.textContent).toContain(
      "first-run completion failed: 500",
    );
    expect(document.body.textContent).toContain("Try again");
    const completedExtensionEvents = () =>
      mocks.trackOnboardingEvent.mock.calls.some(
        ([event, properties]) =>
          event === "onboarding_step_completed" &&
          (properties as { step_id?: string }).step_id ===
            "extension:test-extension",
      );
    expect(completedExtensionEvents()).toBe(false);

    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Try again")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(2);
    expect(completedExtensionEvents()).toBe(true);
  });

  it("renders the role step from the non-English core catalog", async () => {
    const spanishMessages = await loadCoreMessagesForLocale("es-ES");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="es-ES"
          initialPreference="es-ES"
          initialMessages={spanishMessages}
          persistPreference={false}
        >
          <TooltipProvider>
            <FirstRunOnboarding />
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });

    expect(document.body.textContent).toContain(
      "¿Qué describe mejor tu función?",
    );
    expect(document.body.textContent).toContain("Diseñador");
    expect(document.body.textContent).toContain("Desarrollo");
    expect(document.body.textContent).not.toMatch(/\bProduct\b/);
  });

  // A failed initial status read must not leave the create-account CTA inert.
  // The click still starts the provisioning flow, which performs its own
  // fresh status read.
  it("keeps the create-account CTA actionable after a failed status read", () => {
    const start = vi.fn();
    const retry = vi.fn();
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      error: "Couldn't reach Builder to check your account. Retrying.",
      retry,
      start,
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      document.body.querySelector(
        '[data-testid="first-run-builder-status-error"]',
      )?.textContent,
    ).toBe("No se pudo comprobar la conexión de IA.");

    const cta = document.body.querySelector(
      '[data-testid="first-run-builder-create-account"]',
    );
    expect(cta?.hasAttribute("disabled")).toBe(false);

    act(() => {
      cta?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(retry).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ provisionAccount: true }),
    );
  });

  it("opens the AI key settings page without opening the agent sidebar", async () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/settings/keys");
    expect(mocks.completeFirstRun).toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the API key destination inside the live mount omitted by the workspace manifest", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    window.history.replaceState(null, "", "/dispatch/");

    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/dispatch/settings/keys");
  });

  it("preserves the manual settings handoff when completion is retried", async () => {
    mocks.completeFirstRun
      .mockRejectedValueOnce(new Error("first-run completion failed: 500"))
      .mockResolvedValueOnce(undefined);
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: "first-run completion failed: 500",
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/");
    expect(document.body.textContent).toContain(
      "first-run completion failed: 500",
    );
    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "custom_keys",
        outcome: "handoff_failed",
      }),
    );

    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Try again")
        ?.click();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe("/settings/keys");
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "custom_keys",
        outcome: "settings_opened",
      }),
    );
    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({ outcome: "handoff_failed" }),
    );
  });

  it("records a failed handoff only when the user leaves before retry succeeds", async () => {
    mocks.completeFirstRun.mockRejectedValueOnce(
      new Error("first-run completion failed: 500"),
    );
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "builder-app",
        appName: "Builder App",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: "first-run completion failed: 500",
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.click();
      await Promise.resolve();
    });

    const outcomes = () =>
      mocks.trackOnboardingEvent.mock.calls.filter(
        ([event]) => event === "onboarding_method_outcome",
      );
    expect(outcomes()).toHaveLength(0);

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(outcomes()).toHaveLength(1);
    expect(outcomes()[0]?.[1]).toMatchObject({
      method_id: "custom_keys",
      outcome: "handoff_failed",
      error_type: "onboarding_completion_error",
    });
  });

  it("shows no status error while the first Builder status read is in flight", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: false,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      error: null,
      retry: vi.fn(),
      start: vi.fn(),
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      document.body.querySelector(
        '[data-testid="first-run-builder-status-error"]',
      ),
    ).toBeNull();
  });
});
