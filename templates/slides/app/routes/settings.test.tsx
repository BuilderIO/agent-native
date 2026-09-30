// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creativeContextLab: false,
  settingsProps: null as Record<string, unknown> | null,
  agentTabsOptions: null as {
    agentAdditionalTabFactories?: Array<(context: object) => unknown>;
  } | null,
  createCreativeContextAgentTab: vi.fn((context: object) => ({
    id: "library",
    context,
  })),
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  buildSettingsRoute: (section: string) => `/settings/${section}`,
}));

vi.mock("@agent-native/toolkit/app/observability", () => ({
  ObservabilityDashboard: () => null,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  AccountSettingsCard: () => null,
  SettingsTabsPage: (props: Record<string, unknown>) => {
    mocks.settingsProps = props;
    return (
      <main>
        <div data-testid="general">{props.general as ReactNode}</div>
        <div data-testid="notifications">
          {props.notifications as ReactNode}
        </div>
      </main>
    );
  },
  useAgentSettingsTabs: (options: typeof mocks.agentTabsOptions) => {
    mocks.agentTabsOptions = options;
    return [];
  },
}));

vi.mock("@agent-native/creative-context", () => ({
  CREATIVE_CONTEXT_LIBRARY_LAB: { key: "creative-context" },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  createCreativeContextAgentTab: mocks.createCreativeContextAgentTab,
  useCreativeContextLab: () => mocks.creativeContextLab,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: () => undefined,
}));

vi.mock("@shared/labs", () => ({ SLIDES_LABS: [] }));

vi.mock("@/components/settings/notification-settings", () => ({
  COMMENT_EMAILS_ROW_ID: "comments-and-replies",
  NotificationSettings: () => <div data-testid="notification-settings" />,
}));

vi.mock("../../CHANGELOG.md?raw", () => ({ default: "" }));

import SettingsRoute from "./settings";

describe("Slides settings route", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.creativeContextLab = false;
    mocks.settingsProps = null;
    mocks.agentTabsOptions = null;
    mocks.createCreativeContextAgentTab.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderSettings() {
    act(() => root.render(<SettingsRoute />));
  }

  it("moves comment emails to Notifications", () => {
    renderSettings();

    expect(mocks.settingsProps?.general).toBeUndefined();
    expect(mocks.settingsProps?.generalGroups).toBeUndefined();
    expect(mocks.settingsProps?.generalSearchEntries).toBeUndefined();
    expect(
      container.querySelector("[data-testid='notification-settings']"),
    ).not.toBe(null);
    expect(mocks.settingsProps?.notificationsSearchEntries).toEqual([
      expect.objectContaining({ hash: "comments-and-replies" }),
    ]);
    expect(mocks.settingsProps?.mcpAbout).toBe("settings.mcpAbout");
    expect(mocks.settingsProps).not.toHaveProperty("team");
  });

  it("gives the library its settings variant", () => {
    mocks.creativeContextLab = true;
    renderSettings();

    const factory = mocks.agentTabsOptions?.agentAdditionalTabFactories?.[0];
    factory?.({ scope: "user", scopeControl: null });
    expect(mocks.createCreativeContextAgentTab).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user", variant: "settings" }),
    );
  });
});
