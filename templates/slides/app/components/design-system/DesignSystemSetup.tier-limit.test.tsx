// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignSystemSetup } from "./DesignSystemSetup";

const mocks = vi.hoisted(() => ({
  tierLimit: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    if (action === "get-design-system-tier-limit") {
      return { data: mocks.tierLimit };
    }
    if (action === "list-design-systems") {
      return { data: { designSystems: [] } };
    }
    if (action === "get-design-system") {
      return { data: undefined, isLoading: false, isError: false };
    }
    return { data: undefined };
  },
  useActionMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: () => {},
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  openAgentSidebar: () => {},
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Slides DesignSystemSetup tier-limit gating", () => {
  it("shows an at-cap upgrade notice instead of the create form when at the tier cap", () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "free",
      current: 1,
      max: 1,
      atMax: true,
      codeIndexingAllowed: false,
      upgradeUrl: "https://builder.io/account/subscription",
    };

    render(<DesignSystemSetup open onClose={() => {}} onComplete={() => {}} />);

    expect(
      screen.getAllByText("designSystems.tierLimitTitle").length,
    ).toBeGreaterThan(0);
    const upgradeLink = screen.getByRole("link", {
      name: /designSystems.tierLimitUpgrade/,
    });
    expect(upgradeLink.getAttribute("href")).toBe(
      "https://builder.io/account/subscription",
    );
    expect(screen.queryByText("designSystemSetup.figmaFile")).toBeNull();
  });

  it("locks the GitHub/code source row for non-Enterprise plans", () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "pro",
      current: 1,
      max: 3,
      atMax: false,
      codeIndexingAllowed: false,
      upgradeUrl: "https://builder.io/account/subscription",
    };

    render(<DesignSystemSetup open onClose={() => {}} onComplete={() => {}} />);

    const otherSourcesButton = screen.getByText(
      "designSystemSetup.otherSources",
    );
    fireEvent.click(otherSourcesButton.closest("button")!);

    const codeRow = screen
      .getAllByText("designSystemSetup.githubRepository")
      .map((node) => node.closest("button"))
      .find((button): button is HTMLButtonElement => button !== null);
    expect(codeRow?.getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves the GitHub/code source unlocked for Enterprise (unrestricted) plans", () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "enterprise",
      current: 20,
      max: null,
      atMax: false,
      codeIndexingAllowed: true,
      upgradeUrl: null,
    };

    render(<DesignSystemSetup open onClose={() => {}} onComplete={() => {}} />);

    expect(screen.queryByText("designSystems.tierLimitTitle")).toBeNull();

    const otherSourcesButton = screen.getByText(
      "designSystemSetup.otherSources",
    );
    fireEvent.click(otherSourcesButton.closest("button")!);

    const codeRow = screen
      .getAllByText("designSystemSetup.githubRepository")
      .map((node) => node.closest("button"))
      .find((button): button is HTMLButtonElement => button !== null);
    expect(codeRow?.getAttribute("aria-disabled")).toBe("false");
  });
});
