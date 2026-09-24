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
  trackOnboardingEvent: vi.fn(),
  useOnboarding: vi.fn(),
  useOnboardingPreviewMode: vi.fn(),
  useOnboardingPreviewStep: vi.fn(),
}));

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

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

vi.mock("../settings/deferred-builder-connect-popover.js", async () => {
  const { BuilderConnectPopover } =
    await import("../settings/BuilderConnectPopover.js");
  return { DeferredBuilderConnectPopover: BuilderConnectPopover };
});

describe("FirstRunOnboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.completeFirstRun.mockReset();
    mocks.completeFirstRun.mockResolvedValue(undefined);
    mocks.useBuilderConnectFlow.mockReset();
    mocks.trackOnboardingEvent.mockReset();
    mocks.useOnboarding.mockReset();
    mocks.useOnboardingPreviewMode.mockReset();
    mocks.useOnboardingPreviewStep.mockReset();
    mocks.useOnboardingPreviewMode.mockReturnValue(false);
    mocks.useOnboardingPreviewStep.mockReturnValue(null);
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

  it("lets users dismiss setup and records completion", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    const dismissButton = document.body.querySelector(
      '[data-testid="first-run-dismiss"]',
    );
    expect(dismissButton).not.toBeNull();

    await act(async () => {
      (dismissButton as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
  });

  it("surfaces a failed dismissal with a retry action", async () => {
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

    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    await act(async () => {
      document.body
        .querySelector('[data-testid="first-run-dismiss"]')
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

  it("keeps the legacy Builder connection when account provisioning is disabled", () => {
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
      document.body.querySelector('[data-testid="first-run-connect-builder"]')
        ?.textContent,
    ).toContain("Connect Builder.io free credits");
    expect(
      document.body.querySelector('[data-testid="first-run-builder-consent"]'),
    ).toBeNull();
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
        .querySelector("[data-testid='first-run-connect-builder']")
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
        .querySelector("[data-testid='first-run-connect-builder']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const cancelButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='first-run-cancel-builder']",
    );
    expect(cancelButton?.textContent).toBe("Cancel");
    act(() => cancelButton?.click());
    expect(flow.cancel).toHaveBeenCalledOnce();
  });

  it("shows one-click account consent in a popover and its loading state when enabled", () => {
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

    expect(
      document.body.querySelector('[data-testid="first-run-connect-builder"]')
        ?.textContent,
    ).toContain("Activate Builder.io free credits");
    expect(
      document.body.querySelector('[data-testid="first-run-builder-consent"]'),
    ).toBeNull();

    act(() => {
      document.body
        .querySelector('[data-testid="first-run-connect-builder"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      document.body.querySelector('[data-testid="first-run-builder-consent"]')
        ?.textContent,
    ).toContain("Activate free credits");
    expect(document.body.textContent).toContain(
      "We'll automatically create your Builder.io account for you in one click.",
    );
    expect(document.body.textContent).toContain("Create and activate");
    const existingAccountButton = document.body.querySelector(
      '[data-testid="first-run-builder-existing-account"]',
    );
    expect(existingAccountButton?.textContent).toContain(
      "I have a Builder.io account",
    );
    expect(existingAccountButton?.className).not.toContain("border");
    expect(existingAccountButton?.className).toContain("text-muted-foreground");
    expect(existingAccountButton?.querySelector("svg")).toBeNull();
    expect(document.body.textContent).not.toContain("Google credentials");
    expect(document.body.textContent).not.toContain("Connect or log in");

    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-and-activate"]')
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

  it("uses the existing-account connection flow from the consent popover", () => {
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
        .querySelector('[data-testid="first-run-connect-builder"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-existing-account"]')
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
      document.body
        .querySelector('[data-testid="first-run-connect-builder"]')
        ?.click();
    });
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-and-activate"]')
        ?.click();
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
        .querySelector("[data-testid='first-run-connect-builder']")
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

  // Regression: Skip used to fire-and-forget completeFirstRun() with `void`,
  // so a failed completion never surfaced — the click looked like it did
  // nothing, and a rejecting mock here would fail the test via an unhandled
  // rejection under the old behavior.
  it("surfaces a failed Skip instead of silently doing nothing", async () => {
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
    registerFirstRunOnboardingExtension({
      id: "test-extension",
      component: ({ onSkip }) => (
        <button type="button" onClick={onSkip}>
          Extension Skip
        </button>
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
        .querySelector("[data-testid='first-run-connect-builder']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Extension Skip");
    expect(
      document.body.querySelector('[data-testid="first-run-dismiss"]'),
    ).not.toBeNull();

    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Extension Skip")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(1);
    // Stays on the same step — no crash, no misleading full-screen bounce —
    // and the failure is visible with a way forward.
    expect(document.body.textContent).toContain("Extension Skip");
    expect(document.body.textContent).toContain(
      "first-run completion failed: 500",
    );
    expect(document.body.textContent).toContain("Try again");
    expect(
      mocks.trackOnboardingEvent.mock.calls.some(
        ([event, properties]) =>
          event === "onboarding_step_completed" &&
          (properties as { step_id?: string }).step_id?.startsWith(
            "extension:",
          ),
      ),
    ).toBe(false);
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

  // A failed initial status read must not leave the free-credits CTA inert.
  // The click can still start the provisioning flow, which performs its own
  // fresh status read without bypassing the consent step.
  it("keeps the free-credits CTA actionable after a failed status read", () => {
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
    ).toContain("Couldn't reach Builder");

    const cta = document.body.querySelector(
      '[data-testid="first-run-connect-builder"]',
    );
    expect(cta?.getAttribute("aria-disabled")).toBeNull();

    act(() => {
      cta?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(retry).not.toHaveBeenCalled();
    expect(
      document.body.querySelector('[data-testid="first-run-builder-consent"]'),
    ).not.toBeNull();
    expect(start).not.toHaveBeenCalled();

    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-and-activate"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

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

    expect(window.location.pathname).toBe("/settings/agent/llm");
    expect(mocks.completeFirstRun).toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the choice screen visible when completion fails", async () => {
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
