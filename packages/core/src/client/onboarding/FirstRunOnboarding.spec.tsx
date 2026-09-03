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
  createMcpServer: vi.fn(),
  createMcpServerMutation: vi.fn(),
  testMcpServer: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
  useMcpServers: vi.fn(),
  useMcpServersApi: vi.fn(),
  trackOnboardingEvent: vi.fn(),
  useOnboarding: vi.fn(),
  useOnboardingPreviewMode: vi.fn(),
}));

vi.mock("./use-onboarding.js", () => ({
  trackOnboardingEvent: mocks.trackOnboardingEvent,
  useOnboarding: mocks.useOnboarding,
}));

vi.mock("./use-preview-mode.js", () => ({
  useOnboardingPreviewMode: mocks.useOnboardingPreviewMode,
}));

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

vi.mock("../resources/use-mcp-servers.js", () => ({
  useCreateMcpServer: mocks.createMcpServer,
  useMcpServers: mocks.useMcpServers,
  useMcpServersApi: mocks.useMcpServersApi,
  formatMcpServerError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  formatMcpServersLoadError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

describe("FirstRunOnboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.completeFirstRun.mockReset();
    mocks.completeFirstRun.mockResolvedValue(undefined);
    mocks.createMcpServer.mockReset();
    mocks.testMcpServer.mockReset();
    mocks.useBuilderConnectFlow.mockReset();
    mocks.useMcpServers.mockReset();
    mocks.useMcpServersApi.mockReset();
    mocks.trackOnboardingEvent.mockReset();
    mocks.useOnboarding.mockReset();
    mocks.useOnboardingPreviewMode.mockReset();
    mocks.useOnboardingPreviewMode.mockReturnValue(false);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: false,
      statusResolved: true,
      configured: false,
      agentNativeProvisioningEnabled: false,
      error: null,
      start: vi.fn(),
      retry: vi.fn(),
    });
    mocks.useMcpServers.mockReturnValue({
      data: { user: [], org: [], orgId: null, role: null },
      isSuccess: true,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    mocks.useMcpServersApi.mockReturnValue({ test: mocks.testMcpServer });
    mocks.createMcpServerMutation.mockReset();
    mocks.createMcpServerMutation.mockResolvedValue(undefined);
    mocks.createMcpServer.mockReturnValue({
      mutateAsync: mocks.createMcpServerMutation,
      isPending: false,
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
            builderIncluded: true,
            keySummary: "Image provider key",
            why: "Needed for image generation",
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
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    expect(
      document.body.querySelector('[data-testid="first-run-connect-builder"]')
        ?.textContent,
    ).toContain("Connect Builder.io free credits");
    expect(
      document.body.querySelector('[data-testid="first-run-builder-consent"]'),
    ).toBeNull();
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
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
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

  it("opens the additional Builder services when the count is clicked", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    const moreServices = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "+8 more",
    );
    expect(moreServices).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "Also included with Builder.io free credits",
    );

    act(() => moreServices?.click());

    expect(document.body.textContent).toContain(
      "Also included with Builder.io free credits",
    );
    expect(document.body.textContent).toContain("Voice input");
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
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
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
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
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

  it("shows the searchable integration catalog and keeps onboarding open after connecting", async () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    const shell = document.body.querySelector(
      "[data-onboarding-screen='intro']",
    );
    expect(
      shell?.querySelector('[data-testid="onboarding-progress"]'),
    ).toBeTruthy();
    expect(shell?.querySelector("header")).toBeNull();
    expect(document.body.textContent).not.toContain("Builder App");
    expect(document.body.textContent).not.toMatch(/\b[123] \/ 3\b/);

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    expect(document.body.textContent).toContain("Builder.io free credits");
    expect(document.body.textContent).toContain("Design system intelligence");
    expect(
      document.body.querySelector(
        'button[aria-label="About Design system intelligence"]',
      ),
    ).toBeTruthy();
    const localProviderNote = document.body.querySelector(
      '[data-testid="first-run-local-provider-note"]',
    );
    expect(localProviderNote).toBeTruthy();
    expect(localProviderNote?.className).toContain("text-center");
    expect(localProviderNote?.textContent).toContain(
      "make that provider available to everyone using this app",
    );
    expect(
      document.body.querySelector(
        'a[href="https://www.agent-native.com/docs/environment-variables"]',
      ),
    ).toBeTruthy();

    act(() => {
      [...document.body.querySelectorAll("[role='button']")]
        .find((element) => element.textContent?.includes("Use my own keys"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue to tools")
        ?.click();
    });

    expect(
      document.body.querySelector("[data-onboarding-screen='tools']"),
    ).toBeTruthy();
    expect(
      document.body.querySelector("[data-testid='onboarding-tools-footer']"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b(?:OAuth|Token|Direct)\b/);

    const search = document.body.querySelector(
      'input[aria-label="Search integrations"]',
    ) as HTMLInputElement | null;
    expect(search).toBeTruthy();

    expect(
      document.body.querySelectorAll("button[aria-label^='Connect ']").length,
    ).toBeGreaterThan(4);

    act(() => {
      if (!search) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "Context7");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      [...document.body.querySelectorAll("button[aria-label^='Connect ']")].map(
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual(["Connect Context7"]);

    act(() => {
      document.body
        .querySelector('button[aria-label="Connect Context7"]')
        ?.click();
    });

    expect(mocks.createMcpServerMutation).toHaveBeenCalledOnce();
    await act(async () => {
      await mocks.createMcpServerMutation.mock.results[0]?.value;
    });
    expect(mocks.completeFirstRun).not.toHaveBeenCalled();
    expect(
      document.body.querySelector("[data-onboarding-screen='tools']"),
    ).toBeTruthy();
  });

  it("skips the generic integrations catalog but still asks for a role", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding skipIntegrations />
        </TooltipProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    expect(
      document.body.querySelector("[data-onboarding-screen='role']"),
    ).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Let’s customize this for you.",
    );
    expect(document.body.textContent).not.toContain("This app is an agent.");
    expect(document.body.textContent).not.toContain("Agent integrations");
  });

  it("routes the optional integrations skip through the role step", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue to tools")
        ?.click();
    });

    act(() => {
      document.body
        .querySelector("[data-testid='onboarding-tools-footer'] button")
        ?.click();
    });

    expect(
      document.body.querySelector("[data-onboarding-screen='role']"),
    ).toBeTruthy();
    expect(mocks.completeFirstRun).not.toHaveBeenCalled();
  });

  it("only records first-run steps completed after moving forward", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding skipIntegrations />
        </TooltipProvider>,
      );
    });

    const completedSteps = () =>
      mocks.trackOnboardingEvent.mock.calls
        .filter(([event]) => event === "onboarding_step_completed")
        .map(([, properties]) => (properties as { step_id: string }).step_id);

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    expect(completedSteps()).toEqual(["intro", "choice", "manual"]);

    act(() => {
      document.body
        .querySelector("[data-onboarding-screen='role'] button")
        ?.click();
    });

    expect(completedSteps()).toEqual(["intro", "choice", "manual"]);
  });

  it("saves the selected role before completing first-run onboarding", async () => {
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
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue to tools")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector(
          "[data-testid='onboarding-tools-footer'] button.bg-primary",
        )
        ?.click();
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
    expect(mocks.completeFirstRun).toHaveBeenCalledOnce();
  });

  it("keeps first-run integrations disabled until scope metadata is ready", () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.useMcpServers.mockReturnValue({
      data: { user: [], org: [], orgId: null, role: null },
      isSuccess: false,
      isError: true,
      error: new Error("Scope metadata unavailable"),
      isFetching: false,
      refetch,
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue to tools")
        ?.click();
    });

    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("Scope metadata unavailable");
    expect(
      document.body.querySelector('button[aria-label="Connect Context7"]'),
    ).toHaveProperty("disabled", true);

    const retry = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    act(() => retry?.click());
    expect(refetch).toHaveBeenCalledOnce();
    expect(mocks.createMcpServerMutation).not.toHaveBeenCalled();
  });

  it("asks a workspace admin for scope before connecting a shared-capable integration", () => {
    mocks.useMcpServers.mockReturnValue({
      data: { user: [], org: [], orgId: "org-builder", role: "owner" },
      isSuccess: true,
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue to tools")
        ?.click();
    });

    const search = document.body.querySelector(
      'input[aria-label="Search integrations"]',
    ) as HTMLInputElement | null;
    expect(search).toBeTruthy();

    act(() => {
      if (!search) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "Context7");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector('button[aria-label="Connect Context7"]')
        ?.click();
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(mocks.createMcpServerMutation).not.toHaveBeenCalled();
  });

  it("shows the workspace permission requirement to a non-admin", () => {
    mocks.useMcpServers.mockReturnValue({
      data: { user: [], org: [], orgId: "org-builder", role: "member" },
      isSuccess: true,
    });

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding />
        </TooltipProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue to tools")
        ?.click();
    });

    const search = document.body.querySelector(
      'input[aria-label="Search integrations"]',
    ) as HTMLInputElement | null;
    expect(search).toBeTruthy();

    act(() => {
      if (!search) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "Context7");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      document.body
        .querySelector('button[aria-label="Connect Context7"]')
        ?.click();
    });

    expect(document.body.textContent).toContain("Who should use this?");
    expect(document.body.textContent).toContain(
      "Workspace owner or admin required.",
    );
    const workspace = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Set up for workspace") ?? false,
    );
    expect(workspace).toHaveProperty("disabled", true);
    expect(mocks.createMcpServerMutation).not.toHaveBeenCalled();
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

    act(() => {
      root.render(
        <TooltipProvider>
          <FirstRunOnboarding skipIntegrations />
        </TooltipProvider>,
      );
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Skip for now")
        ?.click();
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
            <FirstRunOnboarding skipIntegrations />
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });
    act(() => {
      document.body
        .querySelector("[data-testid='first-run-use-own-keys']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    expect(document.body.textContent).toContain("Personalicemos esto para ti.");
    expect(document.body.textContent).toContain("Producto");
    expect(document.body.textContent).toContain("Desarrollo");
    expect(document.body.textContent).not.toMatch(/\bProduct\b/);
  });
});
