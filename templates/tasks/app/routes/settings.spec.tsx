// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));
const pageProps = vi.hoisted(() => ({
  current: null as { general?: unknown; whatsNewMarkdown?: string } | null,
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
  SettingsGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: ({
    label,
    control,
  }: {
    label: React.ReactNode;
    control?: React.ReactNode;
  }) => (
    <div>
      {label}
      {control}
    </div>
  ),
  SettingsTabsPage: (props: {
    general?: React.ReactNode;
    whatsNewMarkdown?: string;
    extraTabs?: Array<{ content: React.ReactNode }>;
  }) => {
    pageProps.current = props;
    return (
      <main>
        {props.general}
        {props.extraTabs?.map((tab, index) => (
          <div key={index}>{tab.content}</div>
        ))}
      </main>
    );
  },
  useAgentSettingsTabs: (options: { extensionTools?: boolean } = {}) =>
    options.extensionTools === true
      ? [
          {
            id: "extensions",
            label: "Extensions",
            content: <div>Extension management</div>,
          },
        ]
      : [],
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: () => {},
}));

import SettingsRoute from "./settings";

describe("Tasks settings route", () => {
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

  it("enables the Extensions settings tab that /extensions redirects into", () => {
    act(() => {
      root.render(<SettingsRoute />);
    });

    // extensions._index.tsx unconditionally redirects to /settings/extensions;
    // without this, that route silently falls back to General.
    expect(container.textContent).toContain("Extension management");
  });

  it("keeps the language row on today's General tab", () => {
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(container.textContent).toContain("settings.languageTitle");
  });

  it("drops the language row in the redesigned Settings and feeds What's new", () => {
    flag.enabled = true;
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(pageProps.current?.general).toBeUndefined();
    expect(container.textContent).not.toContain("settings.languageTitle");
    expect(container.textContent).toContain("Extension management");
    expect(pageProps.current?.whatsNewMarkdown).toContain("# Changelog");
  });
});
