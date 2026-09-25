// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOrg: vi.fn(),
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  LanguagePicker: () => null,
}));

vi.mock("@agent-native/core/client/observability", () => ({
  ObservabilityDashboard: ({
    routeBasePath,
    showHumanReview,
  }: {
    routeBasePath: string;
    showHumanReview?: boolean;
  }) => (
    <div
      data-testid="observability-dashboard"
      data-route-base-path={routeBasePath}
      data-show-human-review={String(showHumanReview === true)}
    />
  ),
}));

vi.mock("@agent-native/core/client/org", () => ({
  TeamPage: () => null,
  useOrg: mocks.useOrg,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  SettingsGroup: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: () => null,
  SettingsTabsPage: ({
    extraTabs = [],
  }: {
    extraTabs?: Array<{
      id: string;
      label: string;
      href?: string;
      group?: string;
      content: ReactNode;
    }>;
  }) => (
    <main>
      <nav>
        {extraTabs.map((tab) => (
          <a
            key={tab.id}
            data-testid={`settings-tab-${tab.id}`}
            data-group={tab.group}
            href={tab.href}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      {extraTabs.map((tab) => (
        <section key={tab.id}>{tab.content}</section>
      ))}
    </main>
  ),
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/creative-context", () => ({
  CREATIVE_CONTEXT_LIBRARY_LAB: { key: "creative-context" },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextSettingsLink: () => null,
  createCreativeContextAgentTab: vi.fn(),
  useCreativeContextLab: () => false,
}));

vi.mock("@shared/labs", () => ({ DESIGN_LABS: [] }));

import SettingsRoute from "./settings";

describe("Design settings observability tab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mocks.useOrg.mockReset();
    vi.unstubAllGlobals();
  });

  function renderSettings() {
    act(() => root.render(<SettingsRoute />));
  }

  it.each(["owner", "admin"] as const)(
    "shows the org observability route to an %s",
    (role) => {
      mocks.useOrg.mockReturnValue({
        data: { orgId: "org-1", role },
        isLoading: false,
        isError: false,
      });

      renderSettings();

      const tab = container.querySelector<HTMLAnchorElement>(
        '[data-testid="settings-tab-observability"]',
      );
      expect(tab?.getAttribute("href")).toBe(
        "/settings/observability/overview",
      );
      expect(tab?.getAttribute("data-group")).toBe("agent");
      expect(
        container
          .querySelector("[data-testid='observability-dashboard']")
          ?.getAttribute("data-route-base-path"),
      ).toBe("/settings/observability");
      expect(
        container
          .querySelector("[data-testid='observability-dashboard']")
          ?.getAttribute("data-show-human-review"),
      ).toBe("true");
    },
  );

  it.each([
    ["a non-admin", { data: { orgId: "org-1", role: "member" } }],
    ["while the org is loading", { data: undefined, isLoading: true }],
    [
      "when org loading fails",
      {
        data: { orgId: "org-1", role: "admin" },
        isError: true,
      },
    ],
    ["without an active org", { data: { role: "admin" } }],
  ])("fails closed %s", (_state, orgResult) => {
    mocks.useOrg.mockReturnValue(orgResult);

    renderSettings();

    expect(
      container.querySelector('[data-testid="settings-tab-observability"]'),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='observability-dashboard']"),
    ).toBeNull();
  });
});
