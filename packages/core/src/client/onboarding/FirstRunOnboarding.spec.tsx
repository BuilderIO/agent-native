// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
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
}));

describe("FirstRunOnboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.completeFirstRun.mockReset();
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
        'a[href="https://agent-native.com/docs/environment-variables"]',
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

  it("skips the generic integrations catalog when configured for a workflow app", () => {
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
      document.body.querySelector("[data-onboarding-screen='ready']"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("This app is an agent.");
    expect(document.body.textContent).not.toContain("Agent integrations");
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

    expect(document.body.textContent).toContain(
      "Who should be able to use this connection?",
    );
    expect(mocks.createMcpServerMutation).not.toHaveBeenCalled();
  });
});
