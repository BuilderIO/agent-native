// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redesign: { status: "ready", enabled: false } as {
    status: "ready" | "loading";
    enabled: boolean;
  },
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
  LanguagePicker: () => <div data-testid="language-picker" />,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  SettingsGroup: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: ({ id }: { id?: string }) => <div data-row={id} />,
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

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextSettingsLink: () => (
    <div data-testid="creative-context-link" />
  ),
  createCreativeContextAgentTab: mocks.createCreativeContextAgentTab,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: () => undefined,
}));

vi.mock("@/components/settings/notification-settings", () => ({
  COMMENT_EMAILS_ROW_ID: "comments-replies-mentions",
  LegacyEmailNotificationsRow: () => <div data-testid="legacy-email-row" />,
  NotificationSettings: () => <div data-testid="notification-settings" />,
}));

vi.mock("@/hooks/use-creative-context-lab", () => ({
  useCreativeContextLab: () => mocks.creativeContextLab,
}));

vi.mock("@/hooks/use-settings-redesign", () => ({
  useSettingsRedesign: () => mocks.redesign,
}));

vi.mock("@/i18n-data", () => ({
  messagesByLocale: { "en-US": { settings: { metaTitle: "Settings" } } },
}));

vi.mock("../../CHANGELOG.md?raw", () => ({ default: "" }));

import SettingsRoute from "./_app.settings";

describe("Content settings route", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.redesign = { status: "ready", enabled: false };
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

  it("keeps today's General tab with the redesign off", () => {
    renderSettings();

    expect(container.querySelector("[data-row='language']")).not.toBe(null);
    expect(
      container.querySelector("[data-testid='legacy-email-row']"),
    ).not.toBe(null);
    expect(mocks.settingsProps?.notifications).toBeUndefined();
    expect(mocks.settingsProps?.generalSearchEntries).toHaveLength(2);
    expect(mocks.settingsProps).not.toHaveProperty("team");
    expect(mocks.settingsProps).not.toHaveProperty("teamLabel");
  });

  it("moves comment emails to Notifications with the redesign on", () => {
    mocks.redesign = { status: "ready", enabled: true };
    renderSettings();

    expect(mocks.settingsProps?.general).toBeUndefined();
    expect(mocks.settingsProps?.generalGroups).toBeUndefined();
    expect(mocks.settingsProps?.generalSearchEntries).toBeUndefined();
    expect(container.querySelector("[data-row='language']")).toBe(null);
    expect(
      container.querySelector("[data-testid='notification-settings']"),
    ).not.toBe(null);
    expect(mocks.settingsProps?.notificationsSearchEntries).toEqual([
      expect.objectContaining({ hash: "comments-replies-mentions" }),
    ]);
    expect(mocks.settingsProps?.mcpAbout).toBe("settings.mcpAbout");
    expect(mocks.settingsProps).not.toHaveProperty("team");
  });

  it("passes all five Content labs to the Labs page", () => {
    mocks.redesign = { status: "ready", enabled: true };
    renderSettings();

    const labs = mocks.settingsProps?.labs as Array<{
      key: string;
      displayName?: string;
    }>;
    expect(labs.map((lab) => lab.key)).toEqual([
      "content.creative-context",
      "content.slash.advanced-code",
      "content.slash.layouts",
      "content.slash.visuals",
      "content.slash.developer-docs",
    ]);
    expect(labs[0]?.displayName).toBe("settings.labCreativeContext");
  });

  it("gives the library its settings variant with the redesign on", () => {
    mocks.creativeContextLab = true;
    mocks.redesign = { status: "ready", enabled: true };
    renderSettings();

    const factory = mocks.agentTabsOptions?.agentAdditionalTabFactories?.[0];
    factory?.({ scope: "user", scopeControl: null });
    expect(mocks.createCreativeContextAgentTab).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user", variant: "settings" }),
    );
    expect(
      container.querySelector("[data-testid='creative-context-link']"),
    ).toBe(null);
  });

  it("keeps the library's own header with the redesign off", () => {
    mocks.creativeContextLab = true;
    renderSettings();

    expect(mocks.agentTabsOptions?.agentAdditionalTabFactories).toEqual([
      mocks.createCreativeContextAgentTab,
    ]);
    expect(
      container.querySelector("[data-testid='creative-context-link']"),
    ).not.toBe(null);
  });
});
