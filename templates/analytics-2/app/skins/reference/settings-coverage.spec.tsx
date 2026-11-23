// @vitest-environment happy-dom

import {
  validateSettingsSections,
  type SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_HOOKS,
  STANDALONE_PANEL_HOOK,
  type PanelHook,
} from "./testing/all-panels.hooks";
import { resetAllPanels } from "./testing/all-panels.mocks";
import { mount } from "./testing/mount";

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./testing/all-panels.mocks")).allPanelsHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("./testing/i18n")).i18nMock,
}));
vi.mock("@agent-native/core/client/org", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/org")>()),
  ...(await import("@/components/settings/AnalyticsUsersPage.fixtures"))
    .orgMock,
}));
vi.mock(
  "@agent-native/core/client/resources/use-resources",
  async (original) => ({
    ...(await original<
      typeof import("@agent-native/core/client/resources/use-resources")
    >()),
    ...(
      await import("@/components/settings/AnalyticsNotificationsPage.fixtures")
    ).resourcesMock,
  }),
);
vi.mock(
  "@/components/data/useDataConnectionActions",
  async () =>
    (await import("@/components/data/WorkspaceDataConnections.fixtures"))
      .dataConnectionActionsMock,
);
vi.mock(
  "sonner",
  async () =>
    (await import("@/components/settings/AnalyticsUsersPage.fixtures"))
      .toastMock,
);

/** Calls a sections hook the way a panel does and hands back what it returned. */
function sectionsOf(hook: PanelHook): SettingsSectionDefinition[] {
  let sections: SettingsSectionDefinition[] = [];
  function Probe() {
    sections = hook.useSections();
    return null;
  }
  mount(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  ).unmount();
  return sections;
}

describe("settings rows as data: coverage", () => {
  beforeEach(() => resetAllPanels());

  it.each([...PANEL_HOOKS, STANDALONE_PANEL_HOOK])(
    "$name: the sections are well formed",
    (hook) => {
      expect(validateSettingsSections(sectionsOf(hook))).toEqual([]);
    },
  );

  it("row and section ids are unique across the app", () => {
    expect(validateSettingsSections(PANEL_HOOKS.flatMap(sectionsOf))).toEqual(
      [],
    );
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
