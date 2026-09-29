// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));
const pageProps = vi.hoisted(() => ({
  current: null as {
    general?: unknown;
    team?: unknown;
    generalSearchEntries?: unknown;
  } | null,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({ status: "ready", enabled: flag.enabled }),
}));

vi.mock("@agent-native/core/feature-flags/registry", () => ({
  SETTINGS_REDESIGN_FLAG: { key: "settings-redesign" },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  LanguagePicker: () => null,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  SettingsGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: ({ label }: { label: React.ReactNode }) => <div>{label}</div>,
  SettingsTabsPage: (props: {
    general?: React.ReactNode;
    team?: React.ReactNode;
    generalSearchEntries?: unknown;
  }) => {
    pageProps.current = props;
    return <main>{props.general}</main>;
  },
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: () => {},
}));

vi.mock("@/lib/app-config", () => ({ APP_TITLE: "Chat" }));

import SettingsRoute from "./settings";

describe("Chat settings route", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    flag.enabled = false;
    pageProps.current = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the language row on today's General tab", () => {
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(container.textContent).toContain("settings.languageTitle");
    expect(pageProps.current?.team).toBeUndefined();
  });

  it("drops the language row in the redesigned Settings", () => {
    flag.enabled = true;
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(pageProps.current?.general).toBeUndefined();
    expect(pageProps.current?.generalSearchEntries).toBeUndefined();
    expect(container.textContent).not.toContain("settings.languageTitle");
  });
});
