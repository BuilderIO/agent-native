// @vitest-environment happy-dom

import { appBasePath } from "@agent-native/core/client/api-path";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { registerFirstRunOnboardingExtension } from "@agent-native/core/client/onboarding/first-run-registry";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { toolkitMessagesForLocale } from "../i18n/catalog.js";
import {
  FirstRunOnboarding as FirstRunOnboardingSource,
  manualSetupSettingsRoute,
} from "./FirstRunOnboarding.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

function FirstRunOnboarding() {
  return (
    <AgentNativeI18nProvider
      catalog={toolkitI18nCatalog}
      persistPreference={false}
    >
      <FirstRunOnboardingSource />
    </AgentNativeI18nProvider>
  );
}

const mocks = vi.hoisted(() => ({
  completeFirstRun: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
  routePathname: "/",
  useActualRouter: false,
  navigate: vi.fn(),
  trackOnboardingEvent: vi.fn(),
  setCustomKeyOnboardingAttempt: vi.fn(),
  useOnboarding: vi.fn(),
  useOnboardingPreviewMode: vi.fn(),
  useOnboardingPreviewStep: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLocation: () =>
      mocks.useActualRouter
        ? actual.useLocation()
        : { pathname: mocks.routePathname },
    useHref: () => (mocks.useActualRouter ? actual.useHref("/") : "/"),
    useNavigate: () =>
      mocks.useActualRouter ? actual.useNavigate() : mocks.navigate,
  };
});

vi.mock("@agent-native/core/client/feature-flags/use-feature-flag", () => ({
  useFeatureFlagState: () => ({ status: "ready", enabled: true }),
}));

vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  createOnboardingCorrelationId: () => "test-onboarding-correlation-id",
  setCustomKeyOnboardingAttempt: mocks.setCustomKeyOnboardingAttempt,
  trackOnboardingEvent: mocks.trackOnboardingEvent,
  useOnboarding: mocks.useOnboarding,
}));

vi.mock("@agent-native/core/client/onboarding/use-preview-mode", () => ({
  ONBOARDING_PREVIEW_QUERY_PARAM: "onboarding",
  ONBOARDING_PREVIEW_STEP_QUERY_PARAM: "step",
  useOnboardingPreviewMode: mocks.useOnboardingPreviewMode,
  useOnboardingPreviewStep: mocks.useOnboardingPreviewStep,
}));

vi.mock("@agent-native/core/client/feature-flags/use-feature-flag", () => ({
  useFeatureFlagState: () => ({ status: "ready", enabled: true }),
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
    mocks.useActualRouter = false;
    mocks.navigate.mockReset();
    mocks.completeFirstRun.mockResolvedValue(undefined);
    mocks.useBuilderConnectFlow.mockReset();
    mocks.trackOnboardingEvent.mockReset();
    mocks.setCustomKeyOnboardingAttempt.mockReset();
    mocks.setCustomKeyOnboardingAttempt.mockResolvedValue("stored");
    mocks.useOnboarding.mockReset();
    mocks.useOnboardingPreviewMode.mockReset();
    mocks.useOnboardingPreviewStep.mockReset();
    mocks.useOnboardingPreviewMode.mockReturnValue(false);
    mocks.useOnboardingPreviewStep.mockReturnValue(null);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: false,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
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
            service: "model",
            label: "LLM",
            required: true,
            builderIncluded: true,
            keySummary: "LLM provider key",
            whyKey: "agentChat.onboarding.capability.llm.why",
            why: "Needed for chat",
          },
          {
            id: "voice-input",
            service: "voice",
            label: "Voice input",
            required: false,
            suggested: true,
            builderIncluded: true,
            keySummary: "Voice input",
            why: "Turns speech into text",
          },
          {
            id: "images",
            service: "images",
            label: "Images",
            required: false,
            suggested: true,
            builderIncluded: true,
            keySummary: "Image provider key",
            why: "Needed for image generation",
          },
          {
            id: "embeddings",
            service: "embeddings",
            label: "Embeddings",
            required: false,
            builderIncluded: true,
            keySummary: "Embeddings",
            why: "Improves semantic search",
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
            service: "design-system-intelligence",
            builderOnly: true,
            label: "Design system intelligence",
            required: false,
            builderIncluded: true,
            keySummary: "Builder Design System Intelligence",
            why: "Uses your brand and design-system guidance to keep generated work on brand.",
          },
          {
            id: "background-agents",
            service: "background-agents",
            builderOnly: true,
            label: "Background agents",
            required: false,
            builderIncluded: true,
            keySummary: "Background agents",
            why: "Makes code changes from production.",
          },
          {
            id: "video-generation",
            label: "Video generation",
            required: false,
            suggested: true,
            builderIncluded: true,
            keySummary: "Gemini API key",
            why: "Optional video generation",
          },
          {
            id: "assets-library",
            label: "Assets library",
            required: false,
            builderIncluded: true,
            keySummary: "Connect the Assets app",
            why: "Only needed for managed media",
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
    const appWindow = window as Window & {
      __AGENT_NATIVE_CONFIG__?: unknown;
      __reactRouterManifest?: unknown;
    };
    delete appWindow.__AGENT_NATIVE_CONFIG__;
    delete appWindow.__reactRouterManifest;
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
        .querySelector('[data-testid="first-run-builder-sign-in"]')
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
        .querySelector('[data-testid="first-run-builder-sign-in"]')
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
        .querySelector('[data-testid="first-run-builder-sign-in"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_abandoned",
      expect.objectContaining({ flow: "first_run", reason: "page_exit" }),
    );
  });

  it("hides create-account when one-click provisioning is unavailable", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: false,
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

    expect(
      document.body.querySelector(
        '[data-testid="first-run-builder-create-account"]',
      )?.textContent,
    ).toBeUndefined();
    expect(
      document.body.querySelector('[data-testid="first-run-builder-sign-in"]')
        ?.textContent,
    ).toBe("Sign in with a Builder.io account");
    expect(
      document.body
        .querySelector('[data-testid="first-run-builder-sign-in"]')
        ?.querySelector("svg"),
    ).toBeNull();
  });

  it("keeps existing-account sign-in available when provisioning is unavailable", () => {
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
        .querySelector("[data-testid='first-run-builder-sign-in']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ provisionAccount: false }),
    );
  });

  it("lets users cancel a direct Builder connect during first run", () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
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

  it("keeps Cancel during a failed status poll without offering a fake retry", () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: true,
      connecting: false,
      statusUnavailable: true,
      terminalError: null,
      error: "Connection status is unavailable. Retry to check again.",
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

    expect(document.body.textContent).toContain(
      "Connection status is unavailable. Retry to check again.",
    );
    expect(
      document.body.querySelector('[data-testid="first-run-cancel-builder"]'),
    ).not.toBeNull();
    expect(
      [...document.body.querySelectorAll("button")].some(
        (button) => button.textContent === "Try again",
      ),
    ).toBe(false);

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="first-run-cancel-builder"]',
        )
        ?.click();
    });
    expect(flow.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    {
      mode: "provision",
      choiceId: "first-run-builder-create-account",
      provisionAccount: true,
      failure: "transient status read failure",
      statusUnavailable: true,
      terminalError: null,
      error: "Connection status is unavailable. Retry to check again.",
    },
    {
      mode: "existing",
      choiceId: "first-run-builder-sign-in",
      provisionAccount: false,
      failure: "transient status read failure",
      statusUnavailable: true,
      terminalError: null,
      error: "Connection status is unavailable. Retry to check again.",
    },
    {
      mode: "provision",
      choiceId: "first-run-builder-create-account",
      provisionAccount: true,
      failure: "terminal connection error",
      statusUnavailable: true,
      terminalError: "Builder connection failed.",
      error: "Builder connection failed.",
    },
    {
      mode: "existing",
      choiceId: "first-run-builder-sign-in",
      provisionAccount: false,
      failure: "terminal connection error",
      statusUnavailable: true,
      terminalError: "Builder connection failed.",
      error: "Builder connection failed.",
    },
  ])(
    "restarts the prior $mode mode after a $failure",
    ({
      choiceId,
      provisionAccount,
      statusUnavailable,
      terminalError,
      error,
    }) => {
      const start = vi.fn();
      mocks.useBuilderConnectFlow.mockReturnValue({
        hasFetchedStatus: true,
        statusResolved: true,
        configured: false,
        agentNativeProvisioningEnabled: true,
        connecting: false,
        statusUnavailable,
        terminalError,
        error,
        start,
        cancel: vi.fn(),
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
          .querySelector(`[data-testid='${choiceId}']`)
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(start).toHaveBeenCalledOnce();
      expect(document.body.textContent).toContain(error);
      act(() => {
        [...document.body.querySelectorAll("button")]
          .find((button) => button.textContent === "Try again")
          ?.click();
      });

      expect(start).toHaveBeenCalledTimes(2);
      expect(start).toHaveBeenLastCalledWith(
        expect.objectContaining({ provisionAccount }),
      );
    },
  );

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
    expect(
      document.body.querySelector(
        '[data-testid="first-run-builder-create-account"]',
      )?.textContent,
    ).toBe("Create a Builder.io account");
    expect(
      document.body.querySelector('[data-testid="first-run-builder-sign-in"]')
        ?.textContent,
    ).toBe("Sign in with a Builder.io account");
    expect(
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.querySelector("svg"),
    ).toBeNull();
    act(() => {
      document.body
        .querySelector('[data-testid="first-run-builder-create-account"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain(
      "Activating Builder.io free credits",
    );
    expect(document.body.textContent).toContain(
      "Creating your Builder.io account and activating free credits.",
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

  it("does not attach a status-read failure to a manual setup attempt", async () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      statusUnavailable: true,
      terminalError: null,
      error: "Connection status is unavailable. Retry to check again.",
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

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.click();
      await Promise.resolve();
    });
    flow.error = "Builder status still unavailable.";
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
    expect(mocks.navigate).toHaveBeenCalledWith("/settings/model");
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "custom_keys",
        outcome: "settings_opened",
        onboarding_attempt_id: expect.any(String),
      }),
    );
  });

  it("shows included Builder.io services with descriptions in tooltips", () => {
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

    const builderCard = document.body
      .querySelector("[data-testid='first-run-builder-create-account']")
      ?.closest("section");
    const services = builderCard?.querySelector<HTMLElement>(
      "[data-testid='first-run-builder-services']",
    );
    expect(services?.querySelector("details, summary")).toBeNull();
    const included = services?.textContent ?? "";
    // Every shared service, whether or not the app recommends it, plus the
    // app's own headline capability Builder.io covers.
    for (const service of [
      "LLM",
      "Voice input",
      "Images",
      "Embeddings",
      "Design system intelligence",
      "Background agents",
      "Video generation",
    ]) {
      expect(included).toContain(service);
    }
    expect(included).not.toContain("Needed for chat");
    expect(included).not.toContain("Turns speech into text");
    expect(
      services?.querySelectorAll("button[aria-label^='About']").length,
    ).toBe(1);
    const manualCard = document.body
      .querySelector("[data-testid='first-run-open-key-settings']")
      ?.closest("section");
    expect(builderCard?.textContent).not.toContain(
      "Configure using Builder.io and use your account credits to power the app’s services.",
    );
    expect(manualCard?.textContent).not.toContain(
      "Configure your own API keys and credentials to power the app’s services.",
    );
    expect(manualCard?.textContent).not.toContain("Design system intelligence");
    expect(manualCard?.textContent).not.toContain("Background agents");
    expect(manualCard?.querySelector("svg.tabler-icon-x")).toBeNull();
    // Not Builder.io capabilities, and no per-app extras.
    for (const missing of [
      "Connected agents",
      "Hosting and deployment",
      "Assets library",
    ]) {
      expect(document.body.textContent).not.toContain(missing);
    }
  });

  it("does not ask Mail users to connect Gmail again in manual setup", () => {
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "mail",
        appName: "Mail",
        capabilities: [
          {
            id: "llm",
            service: "model",
            label: "AI model",
            required: true,
            builderIncluded: false,
            keySummary: "Connect your own AI model",
            why: "Needed for agent responses.",
          },
          {
            id: "gmail",
            label: "Gmail",
            required: true,
            builderIncluded: false,
            satisfiedBySignIn: true,
            keySummary: "Connect Gmail with OAuth",
            why: "Google sign-in already connects Mail.",
          },
        ],
      },
      completeFirstRun: mocks.completeFirstRun,
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

    expect(document.body.textContent).not.toContain("Connect Gmail with OAuth");
    expect(document.body.textContent).toContain("Connect your own AI model");
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
      "Setting up Builder.io credits",
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

    const accountExistsFlow = {
      ...flow,
      accountExists: true,
    };
    mocks.useBuilderConnectFlow.mockReturnValue(accountExistsFlow);
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

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="first-run-back-to-choice"]',
        )
        ?.click();
    });

    expect(
      document.body.querySelector('[data-onboarding-screen="choice"]'),
    ).toBeTruthy();
    expect(
      document.body.querySelector(
        '[data-testid="first-run-open-key-settings"]',
      ),
    ).toBeTruthy();

    accountExistsFlow.start.mockImplementation(() => {
      accountExistsFlow.connecting = true;
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="first-run-builder-sign-in"]',
        )
        ?.click();
    });

    expect(document.body.textContent).not.toContain(
      "You already have a Builder.io account",
    );
    expect(
      document.body.querySelector('[data-testid="first-run-cancel-builder"]'),
    ).toBeTruthy();
  });

  it("returns to setup choices after Builder provisioning fails", () => {
    const flow = {
      hasFetchedStatus: true,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: true,
      connecting: false,
      terminalError: "Builder account provisioning failed (503).",
      error: "Builder account provisioning failed (503).",
      start: vi.fn(),
      retry: vi.fn(),
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
        .querySelector<HTMLButtonElement>('[data-testid="first-run-role-skip"]')
        ?.click();
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="first-run-builder-create-account"]',
        )
        ?.click();
    });

    expect(
      document.body.querySelector('[data-testid="first-run-back-to-choice"]'),
    ).toBeTruthy();

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="first-run-back-to-choice"]',
        )
        ?.click();
    });

    expect(
      document.body.querySelector('[data-onboarding-screen="choice"]'),
    ).toBeTruthy();
    expect(
      document.body.querySelector(
        '[data-testid="first-run-open-key-settings"]',
      ),
    ).toBeTruthy();
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
        .querySelector("[data-testid='first-run-builder-sign-in']")
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

    expect(
      document.body.querySelector("[data-testid='first-run-setup-skip']"),
    ).toBeNull();
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
    expect(mocks.setCustomKeyOnboardingAttempt).toHaveBeenCalledWith(attemptId);
    expect(mocks.navigate).toHaveBeenCalledWith("/settings/model");
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

  it.each(["no_session", "unavailable"] as const)(
    "navigates while custom-key attempt storage resolves and reports %s",
    async (status) => {
      let resolveAttemptStorage:
        | ((status: "stored" | "no_session" | "unavailable") => void)
        | undefined;
      mocks.setCustomKeyOnboardingAttempt.mockReturnValue(
        new Promise((resolve) => {
          resolveAttemptStorage = resolve;
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

      await act(async () => {
        document.body
          .querySelector("[data-testid='first-run-open-key-settings']")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(mocks.navigate).toHaveBeenCalledWith(
        manualSetupSettingsRoute({ redesign: true }),
      );
      expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
        "onboarding_method_outcome",
        expect.objectContaining({
          method_id: "custom_keys",
          outcome: "settings_opened",
        }),
      );

      await act(async () => {
        resolveAttemptStorage?.(status);
        await Promise.resolve();
      });
      expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
        "onboarding_correlation_unavailable",
        expect.objectContaining({ correlation_status: status }),
      );
      window.history.replaceState(null, "", "/");
    },
  );

  it("lets Clips skip provider setup and finish first-run onboarding", async () => {
    let resolveCompletion: (() => void) | undefined;
    mocks.completeFirstRun.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "clips",
        appName: "Clips",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: null,
    });
    mocks.routePathname = "/library";

    await act(async () => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const skipSetupButton = document.body.querySelector(
      "[data-testid='first-run-setup-skip']",
    );
    expect(skipSetupButton?.textContent).toBe("Skip for now");

    act(() => {
      skipSetupButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      skipSetupButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    expect(
      mocks.trackOnboardingEvent.mock.calls.filter(
        ([event, properties]) =>
          event === "onboarding_step_skipped" &&
          (properties as Record<string, unknown>).step_id === "choice",
      ),
    ).toHaveLength(1);

    await act(async () => {
      resolveCompletion?.();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith("/record", { replace: true });
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_step_skipped",
      expect.objectContaining({
        flow: "first_run",
        step_id: "choice",
        reason: "user_action",
      }),
    );
    expect(mocks.trackOnboardingEvent).not.toHaveBeenCalledWith(
      "onboarding_method_clicked",
      expect.anything(),
    );
  });

  it("navigates to Clips recording inside the router basename", async () => {
    mocks.useActualRouter = true;
    mocks.useOnboardingPreviewMode.mockReturnValue(true);
    mocks.useOnboardingPreviewStep.mockReturnValue("choice");
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "clips",
        appName: "Clips",
        capabilities: [],
      },
      completeFirstRun: mocks.completeFirstRun,
      completeFirstRunError: null,
    });
    vi.stubEnv("VITE_APP_BASE_PATH", "/clips");
    window.history.replaceState(
      null,
      "",
      "/clips/library?onboarding=preview&step=choice",
    );

    await act(async () => {
      root.render(
        <MemoryRouter
          basename="/clips"
          initialEntries={["/clips/library?onboarding=preview&step=choice"]}
        >
          <Routes>
            <Route path="/library" element={<FirstRunOnboarding />} />
            <Route
              path="/record"
              element={<div data-testid="clips-record-route" />}
            />
            <Route path="*" element={<div data-testid="not-found-route" />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-setup-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.body.querySelector('[data-testid="clips-record-route"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('[data-testid="not-found-route"]'),
    ).toBeNull();
  });

  it("tracks custom-key settings as opened after the settings route renders", async () => {
    mocks.useActualRouter = true;
    let settingsRenderedAtOutcome = false;
    mocks.trackOnboardingEvent.mockImplementation((event, properties) => {
      if (
        event === "onboarding_method_outcome" &&
        (properties as Record<string, unknown>).outcome === "settings_opened"
      ) {
        settingsRenderedAtOutcome =
          document.body.querySelector(
            '[data-testid="model-settings-route"]',
          ) !== null;
      }
    });

    const router = createMemoryRouter(
      [
        {
          path: "/home",
          element: (
            <TooltipProvider>
              <FirstRunOnboarding />
              <div data-testid="home-route">Home</div>
            </TooltipProvider>
          ),
        },
        {
          path: "/settings/model",
          element: <div data-testid="model-settings-route">Model settings</div>,
        },
      ],
      { basename: "/clips", initialEntries: ["/clips/home"] },
    );

    await act(async () => {
      root.render(<RouterProvider router={router} />);
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

    expect(
      document.body.querySelector('[data-testid="model-settings-route"]'),
    ).not.toBeNull();
    expect(router.state.location.pathname).toBe("/clips/settings/model");
    expect(settingsRenderedAtOutcome).toBe(true);
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_outcome",
      expect.objectContaining({
        method_id: "custom_keys",
        outcome: "settings_opened",
      }),
    );
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
      await Promise.resolve();
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

    expect(mocks.navigate).toHaveBeenCalledWith("/settings/model");
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

  it("does not reuse a failed skip redirect for manual setup completion", async () => {
    mocks.completeFirstRun
      .mockRejectedValueOnce(new Error("first-run completion failed: 500"))
      .mockResolvedValueOnce(undefined);
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "clips",
        appName: "Clips",
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
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-setup-skip']")
        ?.click();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-open-key-settings']")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith("/settings/model");
  });

  it("preserves the completed step when first-run completion succeeds on retry", async () => {
    let completionResult: boolean | void;
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
          <button
            type="button"
            onClick={async () => {
              completionResult = await onComplete();
            }}
          >
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
        .querySelector("[data-testid='first-run-builder-sign-in']")
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
    expect(completionResult).toBe(false);
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
            "extension:test-extension:1",
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

  it("renders the role step from the non-English Toolkit catalog", async () => {
    const spanishMessages = toolkitMessagesForLocale("es-ES");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="es-ES"
          initialPreference="es-ES"
          initialMessages={spanishMessages}
          persistPreference={false}
        >
          <TooltipProvider>
            <FirstRunOnboardingSource />
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

  it("keeps setup choices clear and actionable after a failed status read", () => {
    const start = vi.fn();
    const retry = vi.fn();
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      statusUnavailable: true,
      error: "Connection status is unavailable. Retry to check again.",
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
      ),
    ).toBeNull();

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

  it("shows neutral Builder status copy with a retry action", () => {
    const retry = vi.fn(() => true);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      statusResolved: false,
      configured: false,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
      connecting: false,
      statusUnavailable: true,
      error: "Connection status is unavailable. Retry to check again.",
      errorKind: "status-read",
      statusReadSettledCount: 0,
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
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      document.body.querySelector(
        '[data-testid="first-run-builder-status-error"]',
      )?.textContent,
    ).toContain("Connection status is unavailable. Retry to check again.");

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="first-run-builder-retry-status"]',
        )
        ?.click();
    });

    expect(retry).toHaveBeenCalledOnce();
  });

  it("opens Agent › Model without opening the agent sidebar", async () => {
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

    expect(mocks.navigate).toHaveBeenCalledWith("/settings/model");
    expect(mocks.completeFirstRun).toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("routes manual setup through the declared mount with local route definitions", async () => {
    mocks.useActualRouter = true;
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    vi.stubEnv("APP_BASE_PATH", "");
    Object.assign(window, {
      __AGENT_NATIVE_CONFIG__: {
        workspaceAppId: "dispatch",
        workspaceAppPath: "/dispatch",
      },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          home: { id: "home", parentId: "root", path: "home" },
          settings: { id: "settings", parentId: "root", path: "settings" },
          model: { id: "model", parentId: "settings", path: "model" },
        },
      },
    });
    window.history.replaceState(null, "", "/dispatch/home");
    const basename = appBasePath();
    expect(basename).toBe("/dispatch");
    const router = createMemoryRouter(
      [
        {
          path: "/home",
          element: (
            <TooltipProvider>
              <FirstRunOnboarding />
            </TooltipProvider>
          ),
        },
        {
          path: "/settings/model",
          element: <div data-testid="model-settings-route" />,
        },
      ],
      { basename, initialEntries: ["/dispatch/home"] },
    );

    await act(async () => {
      root.render(<RouterProvider router={router} />);
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

    expect(
      document.body.querySelector('[data-testid="model-settings-route"]'),
    ).not.toBeNull();
    expect(router.state.location.pathname).toBe("/dispatch/settings/model");
  });

  it("sends manual setup to Agent › Model", () => {
    expect(manualSetupSettingsRoute({ redesign: true })).toBe(
      "/settings/model",
    );
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

  it("preserves a skip redirect when the diverted completion is retried", async () => {
    mocks.completeFirstRun
      .mockRejectedValueOnce(new Error("first-run completion failed: 500"))
      .mockResolvedValueOnce(undefined);
    mocks.useOnboarding.mockReturnValue({
      firstRun: true,
      loading: false,
      error: null,
      profile: {
        appId: "clips",
        appName: "Clips",
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
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-role-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.body
        .querySelector("[data-testid='first-run-setup-skip']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const extensionSkip = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Extension Skip",
    );
    if (extensionSkip) {
      await act(async () => {
        extensionSkip.click();
        await Promise.resolve();
      });
    }

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "first-run completion failed: 500",
    );
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Try again")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeFirstRun).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith("/record", {
      replace: true,
    });
  });
});
