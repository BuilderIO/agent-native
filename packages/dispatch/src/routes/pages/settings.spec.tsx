// @vitest-environment happy-dom

import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchAccessDescriptor } from "../../shared/app-roles.js";

const state = vi.hoisted(() => ({
  redesign: false,
  registered: [] as Array<{
    id: string;
    component: ComponentType;
    searchEntries?: unknown;
  }>,
  membersAppRoles: undefined as unknown,
  pageProps: null as null | {
    general?: ReactNode;
    generalGroups?: ReactNode;
    generalSearchEntries?: Array<{ id: string; hash?: string }>;
    extraTabs?: Array<{ id: string; href?: string }>;
    whatsNew?: ReactNode;
  },
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  CHAT_FIRST_MODE_CHANGED_EVENT: "chat-first-mode-changed",
  readChatFirstModeState: () => ({ enabled: false, availability: "ok" }),
  writeChatFirstMode: () => ({ ok: true }),
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: ({ markdown }: { markdown: string }) => (
    <div data-changelog>{markdown}</div>
  ),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
  useFeatureFlagState: () => ({ status: "ready", enabled: state.redesign }),
}));

vi.mock("@agent-native/core/feature-flags/registry", () => ({
  CONNECT_APPS_FLAG: { key: "connect-apps" },
  SETTINGS_REDESIGN_FLAG: { key: "settings-redesign" },
  defineFeatureFlag: (flag: { key: string }) => flag,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  LanguagePicker: () => null,
}));

vi.mock("@agent-native/core/client/org", () => ({
  TeamPage: () => null,
  OrgMembersPage: ({ appRoles }: { appRoles?: unknown }) => {
    state.membersAppRoles = appRoles;
    return <div data-members-page />;
  },
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  CORE_SETTINGS_PAGES: [
    { id: "profile", component: () => null },
    {
      id: "members",
      component: () => null,
      searchEntries: [{ id: "invite-members" }],
    },
  ],
  registerSettingsPages: (pages: typeof state.registered) => {
    state.registered.push(...pages);
  },
  SettingsGroup: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: ({
    id,
    label,
    children,
  }: {
    id?: string;
    label: ReactNode;
    children?: ReactNode;
  }) => (
    <div data-row={id}>
      {label}
      {children}
    </div>
  ),
  SettingsTabsPage: (props: NonNullable<typeof state.pageProps>) => {
    state.pageProps = props;
    return <main>{state.redesign ? props.generalGroups : props.general}</main>;
  },
  useAgentSettingsTabs: () => [{ id: "organization", label: "Organization" }],
}));

const { DispatchSettingsPage } = await import("./settings.js");

describe("Dispatch settings route", () => {
  let container: HTMLDivElement;
  let root: Root;

  function render() {
    act(() => {
      root.render(
        <MemoryRouter>
          <DispatchSettingsPage changelog="## 2026-09-25" />
        </MemoryRouter>,
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.redesign = false;
    state.pageProps = null;
    state.membersAppRoles = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("replaces core Members with one that keeps Dispatch app roles", () => {
    const members = state.registered.find((page) => page.id === "members");
    expect(members?.searchEntries).toEqual([{ id: "invite-members" }]);

    const Members = members!.component;
    act(() => {
      root.render(<Members />);
    });

    expect(container.querySelector("[data-members-page]")).not.toBeNull();
    expect(state.membersAppRoles).toBe(dispatchAccessDescriptor);
  });

  it("keeps the language row and Admin link on today's General tab", () => {
    render();

    expect(container.querySelector('[data-row="language"]')).not.toBeNull();
    expect(container.textContent).toContain(
      "settings.chatFirstSessionWatchDescription",
    );
    expect(
      state.pageProps?.generalSearchEntries?.map((entry) => entry.id),
    ).toContain("dispatch-language");
    expect(
      state.pageProps?.extraTabs?.find((tab) => tab.id === "admin")?.href,
    ).toBe("/admin");
  });

  it("drops the language row in the redesigned Settings", () => {
    state.redesign = true;
    render();

    expect(container.querySelector('[data-row="language"]')).toBeNull();
    expect(container.querySelector('[data-row="chat-first"]')).not.toBeNull();
    expect(
      container.querySelector('[data-row="workspace-resources"]')?.textContent,
    ).toContain("settings.resourcesTitle");
    expect(container.textContent).not.toContain(
      "settings.chatFirstSessionWatchDescription",
    );
    expect(
      state.pageProps?.generalSearchEntries?.map((entry) => entry.hash),
    ).toEqual(["workspace-resources", "chat-first"]);
    expect(
      state.pageProps?.extraTabs?.find((tab) => tab.id === "admin")?.href,
    ).toBe("/admin");
  });
});
