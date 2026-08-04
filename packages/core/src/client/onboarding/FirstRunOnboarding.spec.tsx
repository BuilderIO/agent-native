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
  useBuilderConnectFlow: vi.fn(),
  useMcpServers: vi.fn(),
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
    mocks.useBuilderConnectFlow.mockReset();
    mocks.useMcpServers.mockReset();
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

    act(() => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click();
    });

    expect(document.body.textContent).toContain("Builder.io free credits");

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
});
