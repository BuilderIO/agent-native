// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  SettingsTabsPage: ({
    generalGroups,
    notifications,
  }: {
    generalGroups?: ReactNode;
    notifications?: ReactNode;
  }) => (
    <div
      data-testid="settings-tabs"
      data-general-groups={String(Boolean(generalGroups))}
      data-notifications={String(Boolean(notifications))}
    />
  ),
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/creative-context", () => ({
  CREATIVE_CONTEXT_LIBRARY_LAB: { key: "creative-context" },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  createCreativeContextAgentTab: vi.fn(),
  useCreativeContextLab: () => false,
}));

vi.mock("@/components/settings/AssetsGeneralGroups", () => ({
  AssetsGeneralGroups: () => null,
}));

vi.mock("@/components/settings/AssetsNotificationSettings", () => ({
  AssetsNotificationSettings: () => null,
}));

import SettingsRoute from "./settings";

describe("Assets settings route", () => {
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
    vi.unstubAllGlobals();
  });

  it("renders the Settings shell with Assets' General groups and Notifications", () => {
    act(() => root.render(<SettingsRoute />));
    const shell = container.querySelector("[data-testid='settings-tabs']");
    expect(shell?.getAttribute("data-general-groups")).toBe("true");
    expect(shell?.getAttribute("data-notifications")).toBe("true");
  });
});
