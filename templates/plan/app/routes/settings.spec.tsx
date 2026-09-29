// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageProps = vi.hoisted(() => ({
  current: null as { generalSearchEntries?: Array<{ id: string }> } | null,
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
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

    expect(container.textContent).toContain("Extension management");
  });

  it("gives Plan › General only the editor group", () => {
    act(() => {
      root.render(<SettingsRoute />);
    });

    expect(slot("general-groups")).toContain("settings.editorGroupTitle");
    expect(slot("general-groups")).toContain("settings.editorTitle");
    expect(slot("general-groups")).not.toContain("settings.languageTitle");
    expect(slot("general")).toBe("");
    expect(
      pageProps.current?.generalSearchEntries?.map((entry) => entry.id),
    ).toEqual(["plan-editor"]);
    expect(container.textContent).toContain("Extension management");
  });
});
