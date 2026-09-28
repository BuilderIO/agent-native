// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flag: { status: "loading", enabled: false } as {
    status: "loading" | "ready" | "unavailable";
    enabled: boolean;
  },
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => mocks.flag,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  LanguagePicker: () => null,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
  BuilderConnectPopover: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  SettingsGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SettingsRow: () => null,
  SettingsTabsPage: ({ generalGroups }: { generalGroups?: ReactNode }) => (
    <div
      data-testid="settings-tabs"
      data-shell={generalGroups ? "redesigned" : "legacy"}
    />
  ),
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/creative-context", () => ({
  CREATIVE_CONTEXT_LIBRARY_LAB: { key: "creative-context" },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextSettingsLink: () => null,
  createCreativeContextAgentTab: vi.fn(),
  useCreativeContextLab: () => false,
}));

vi.mock("@/components/layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="page-shell">{children}</div>
  ),
}));

vi.mock("@/components/settings/AssetsGeneralGroups", () => ({
  AssetsGeneralGroups: () => null,
}));

vi.mock("@/components/settings/AssetsNotificationSettings", () => ({
  AssetsNotificationSettings: () => null,
}));

vi.mock("@/components/settings/generation-setup", () => ({
  builderDescription: () => "",
  generationSummary: () => "",
  ManualMethodPanel: () => null,
  useGenerationSetup: () => ({}),
}));

vi.mock("@/hooks/use-assets-prefs", () => ({
  useAssetsPrefs: () => ({ prefs: {}, loading: false, save: vi.fn() }),
}));

import SettingsRoute from "./settings";

describe("Assets settings route flag gate", () => {
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

  function render(flag: typeof mocks.flag) {
    mocks.flag = flag;
    act(() => root.render(<SettingsRoute />));
    return {
      shell: container
        .querySelector("[data-testid='settings-tabs']")
        ?.getAttribute("data-shell"),
      pageShell: container.querySelector("[data-testid='page-shell']"),
    };
  }

  it("holds the redesigned shell, without the legacy header, while the flag loads", () => {
    const view = render({ status: "loading", enabled: false });
    expect(view.shell).toBe("redesigned");
    expect(view.pageShell).toBeNull();
  });

  it("renders the redesigned shell when the flag is on", () => {
    const view = render({ status: "ready", enabled: true });
    expect(view.shell).toBe("redesigned");
    expect(view.pageShell).toBeNull();
  });

  it.each([
    { status: "ready", enabled: false },
    { status: "unavailable", enabled: false },
  ] as const)(
    "renders the legacy page when the flag is $status off",
    (flag) => {
      const view = render(flag);
      expect(view.shell).toBe("legacy");
      expect(view.pageShell).not.toBeNull();
    },
  );
});
