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
  useOnboarding: vi.fn(),
  useOnboardingPreviewMode: vi.fn(),
}));

vi.mock("./use-onboarding.js", () => ({
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
    mocks.useOnboarding.mockReset();
    mocks.useOnboardingPreviewMode.mockReset();
    mocks.useOnboardingPreviewMode.mockReturnValue(false);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: false,
      configured: false,
      error: null,
      start: vi.fn(),
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
    expect(shell?.firstElementChild?.getAttribute("data-testid")).toBe(
      "onboarding-progress",
    );
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
