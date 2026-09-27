// @vitest-environment happy-dom

import { MAIL_SETTINGS_AREA_IDS } from "@shared/settings-navigation";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { flagState, registerChannelSettingsExtensions, syncMock, tabsProps } =
  vi.hoisted(() => ({
    flagState: { enabled: true },
    registerChannelSettingsExtensions: vi.fn(() => () => {}),
    syncMock: vi.fn(),
    tabsProps: { current: null as Record<string, unknown> | null },
  }));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({ status: "ready", enabled: flagState.enabled }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  LanguagePicker: () => null,
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  SettingsGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: () => null,
  SettingsShellSkeleton: () => <div data-testid="skeleton" />,
  SettingsTabsPage: (props: Record<string, unknown>) => {
    tabsProps.current = props;
    return null;
  },
  registerChannelSettingsExtensions,
  useAgentSettingsTabs: () => [
    { id: "organization", label: "Organization", content: null },
  ],
}));

vi.mock("@/hooks/use-navigation-state", () => ({
  useNavigationState: () => ({ sync: syncMock }),
}));

import { SettingsPage } from "./SettingsPage";

let container: HTMLDivElement;
let root: Root;
let location = "";

function LocationProbe() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/settings/*"
            element={
              <>
                <SettingsPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  tabsProps.current = null;
  syncMock.mockClear();
  location = "";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Mail Settings with the redesign on", () => {
  beforeEach(() => {
    flagState.enabled = true;
  });

  it("passes Mail's areas as tabs on Mail › General", async () => {
    await renderAt("/settings/app");

    const props = tabsProps.current!;
    const areas = props.appAreas as Array<{ id: string }>;
    expect(areas.map((area) => area.id)).toEqual([...MAIL_SETTINGS_AREA_IDS]);
    expect(props.general).toBeUndefined();
    expect(props.team).toBeUndefined();
    expect(typeof props.whatsNewMarkdown).toBe("string");
  });

  it("sends the old inbox-rules link to Rules", async () => {
    await renderAt("/settings?section=automations");

    expect(location).toBe("/settings/app/rules");
  });

  it("keeps the rest of the query when it redirects", async () => {
    await renderAt("/settings?section=aliases&alias=alias-1");

    expect(location).toBe("/settings/app/aliases?alias=alias-1");
  });

  it("sends the old Slack intake link to Channels › Slack", async () => {
    await renderAt("/settings?section=slack");

    expect(location).toBe("/settings/channels/slack");
  });

  it("leaves core section ids to the shell", async () => {
    await renderAt("/settings?section=integrations");

    expect(location).toBe("/settings?section=integrations");
    expect(tabsProps.current).not.toBeNull();
  });

  it("tells the agent which Mail area is open", async () => {
    await renderAt("/settings/app/rules");

    expect(syncMock).toHaveBeenCalledWith({
      view: "settings",
      settingsSection: "rules",
    });
  });
});

describe("Mail Settings with the redesign off", () => {
  beforeEach(() => {
    flagState.enabled = false;
  });

  it("opens today's tab for a redesigned area path", async () => {
    await renderAt("/settings/app/rules");

    expect(location).toBe("/settings");
    expect(tabsProps.current?.value).toBe("automations");
  });

  it("opens the Organization tab for an old team link", async () => {
    await renderAt("/settings?section=team");

    expect(tabsProps.current?.value).toBe("organization");
    expect(tabsProps.current?.team).toBeUndefined();
  });

  it("keeps the Slack intake tab", async () => {
    await renderAt("/settings/channels/slack");

    expect(tabsProps.current?.value).toBe("slack");
    const tabs = tabsProps.current?.extraTabs as Array<{ id: string }>;
    expect(tabs.map((tab) => tab.id)).toContain("slack");
  });
});

it("adds Mail's Slack draft requests to Channels › Slack", () => {
  expect(registerChannelSettingsExtensions).toHaveBeenCalledWith([
    expect.objectContaining({ id: "mail-draft-requests", platform: "slack" }),
  ]);
});
