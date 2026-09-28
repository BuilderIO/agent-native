// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CapturedTab = {
  id: string;
  label: string;
  href?: string;
  group?: string;
  content: ReactNode;
};

type CapturedProps = {
  extraTabs?: CapturedTab[];
  general?: ReactNode;
  team?: ReactNode;
  labs?: Array<{ key: string }>;
  labsIntro?: string;
  mcpAbout?: string;
  generalSearchEntries?: unknown[];
};

const mocks = vi.hoisted(() => ({
  useOrg: vi.fn(),
  redesign: false,
  creativeContext: false,
  props: null as CapturedProps | null,
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({ status: "ready", enabled: mocks.redesign }),
}));

vi.mock("@agent-native/core/feature-flags/registry", () => ({
  SETTINGS_REDESIGN_FLAG: { key: "settings-redesign" },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  LanguagePicker: () => <div data-testid="language-picker" />,
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
  useOrg: mocks.useOrg,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  SettingsGroup: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: ({ id, control }: { id: string; control: ReactNode }) => (
    <div data-testid={`settings-row-${id}`}>{control}</div>
  ),
  SettingsTabsPage: (props: CapturedProps) => {
    mocks.props = props;
    const extraTabs = props.extraTabs ?? [];
    return (
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
        <div data-testid="settings-general">{props.general}</div>
        {extraTabs.map((tab) => (
          <section key={tab.id}>{tab.content}</section>
        ))}
      </main>
    );
  },
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/creative-context", () => ({
  CREATIVE_CONTEXT_LIBRARY_LAB: { key: "creative-context" },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextSettingsLink: () => (
    <div data-testid="creative-context-settings-link" />
  ),
  createCreativeContextAgentTab: vi.fn(),
  useCreativeContextLab: () => mocks.creativeContext,
}));

vi.mock("@shared/labs", () => ({ DESIGN_LABS: [{ key: "design-tweaks" }] }));

import SettingsRoute from "./settings";

describe("Design settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.useOrg.mockReturnValue({
      data: { orgId: "org-1", role: "member" },
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mocks.useOrg.mockReset();
    mocks.redesign = false;
    mocks.creativeContext = false;
    mocks.props = null;
    vi.unstubAllGlobals();
  });

  function renderSettings() {
    act(() => root.render(<SettingsRoute />));
  }

  const observabilityTab = () =>
    container.querySelector<HTMLAnchorElement>(
      '[data-testid="settings-tab-observability"]',
    );
  const dashboard = () =>
    container.querySelector("[data-testid='observability-dashboard']");

  describe.each([
    ["today's tabs", false],
    ["the redesigned Settings", true],
  ] as const)("observability in %s", (_surface, redesign) => {
    beforeEach(() => {
      mocks.redesign = redesign;
    });

    it.each(["owner", "admin"] as const)(
      "shows the org observability dashboard to an %s",
      (role) => {
        mocks.useOrg.mockReturnValue({
          data: { orgId: "org-1", role },
          isLoading: false,
          isError: false,
        });

        renderSettings();

        expect(observabilityTab()).not.toBeNull();
        expect(dashboard()?.getAttribute("data-route-base-path")).toBe(
          "/settings/observability",
        );
        expect(dashboard()?.getAttribute("data-show-human-review")).toBe(
          "true",
        );
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

      expect(observabilityTab()).toBeNull();
      expect(dashboard()).toBeNull();
    });
  });

  describe("today's tabs", () => {
    it("links the observability tab to the dashboard's first tab", () => {
      mocks.useOrg.mockReturnValue({
        data: { orgId: "org-1", role: "owner" },
        isLoading: false,
        isError: false,
      });

      renderSettings();

      expect(observabilityTab()?.getAttribute("href")).toBe(
        "/settings/observability/overview",
      );
      expect(observabilityTab()?.getAttribute("data-group")).toBe("agent");
    });

    it("keeps the language row and the creative-context link on General", () => {
      mocks.creativeContext = true;

      renderSettings();

      expect(
        container.querySelector('[data-testid="settings-row-language"]'),
      ).not.toBeNull();
      expect(
        container.querySelector(
          '[data-testid="creative-context-settings-link"]',
        ),
      ).not.toBeNull();
      expect(mocks.props?.team).toBeUndefined();
    });
  });

  describe("the redesigned Settings", () => {
    beforeEach(() => {
      mocks.redesign = true;
    });

    it("makes observability a page inside Settings, not a link out", () => {
      mocks.useOrg.mockReturnValue({
        data: { orgId: "org-1", role: "admin" },
        isLoading: false,
        isError: false,
      });

      renderSettings();

      expect(observabilityTab()).not.toBeNull();
      expect(observabilityTab()?.hasAttribute("href")).toBe(false);
    });

    it("leaves language to Preferences and the library to its own page", () => {
      mocks.creativeContext = true;

      renderSettings();

      expect(mocks.props?.general).toBeUndefined();
      expect(mocks.props?.generalSearchEntries).toBeUndefined();
      expect(mocks.props?.team).toBeUndefined();
      expect(
        container.querySelector('[data-testid="settings-row-language"]'),
      ).toBeNull();
      expect(
        container.querySelector(
          '[data-testid="creative-context-settings-link"]',
        ),
      ).toBeNull();
    });

    it("passes Design's labs and MCP about line to the shell", () => {
      renderSettings();

      expect(mocks.props?.labs?.map((lab) => lab.key)).toEqual([
        "design-tweaks",
        "creative-context",
      ]);
      expect(mocks.props?.labsIntro).toBeUndefined();
      expect(mocks.props?.mcpAbout).toBe("settings.mcpAbout");
    });
  });
});
