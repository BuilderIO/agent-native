// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));
const pageProps = vi.hoisted(() => ({
  current: null as { generalSearchEntries?: Array<{ id: string }> } | null,
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
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
  SettingsGroup: ({
    title,
    children,
  }: {
    title?: string;
    children: React.ReactNode;
  }) => (
    <section>
      {title}
      {children}
    </section>
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
    generalGroups?: React.ReactNode;
    generalSearchEntries?: Array<{ id: string }>;
    extraTabs?: Array<{ content: React.ReactNode }>;
  }) => {
    pageProps.current = props;
    return (
      <main>
        <div data-slot="general">{props.general}</div>
        <div data-slot="general-groups">{props.generalGroups}</div>
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

describe("Plan settings route", () => {
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

  function slot(name: string): string {
    return container.querySelector(`[data-slot="${name}"]`)?.textContent ?? "";
  }

  it("enables the Extensions settings tab that /extensions redirects into", () => {
    act(() => {
      root.render(<SettingsRoute />);
    });

    // extensions._index.tsx unconditionally redirects to /settings/extensions,
    // and use-navigation-state.ts maps "extensions" to that same path — without
    // this, that destination silently falls back to General.
    expect(container.textContent).toContain("Extension management");
  });

  it("keeps today's General tab with the language and editor rows", () => {
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(slot("general")).toContain("settings.languageTitle");
    expect(slot("general")).toContain("settings.editorTitle");
    expect(
      pageProps.current?.generalSearchEntries?.map((entry) => entry.id),
    ).toEqual(["plan-language", "plan-editor"]);
  });

  it("gives Plan › General only the editor group in the redesigned Settings", () => {
    flag.enabled = true;
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(slot("general-groups")).toContain("settings.editorGroupTitle");
    expect(slot("general-groups")).toContain("settings.editorTitle");
    expect(slot("general-groups")).not.toContain("settings.languageTitle");
    expect(
      pageProps.current?.generalSearchEntries?.map((entry) => entry.id),
    ).toEqual(["plan-editor"]);
    expect(container.textContent).toContain("Extension management");
  });
});
