// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useLegacyAuth: vi.fn(() => {
    throw new Error("Settings must not depend on the template AuthProvider");
  }),
  useReplayStorageStatus: vi.fn(() => ({
    data: { configured: false },
    isLoading: false,
  })),
}));

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
  ChangelogSettingsCard: () => null,
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  LanguagePicker: () => null,
  SettingsTabsPage: ({ general }: { general: React.ReactNode }) => (
    <main>{general}</main>
  ),
  useAgentSettingsTabs: () => [],
  useBuilderConnectFlow: () => ({
    configured: false,
    hasFetchedStatus: true,
    statusResolved: true,
  }),
  useBuilderStatus: () => ({ loading: false, status: null }),
  useSession: () => ({
    session: { email: "settings-user@example.com" },
    isLoading: false,
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/org", () => ({ TeamPage: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: mocks.useLegacyAuth,
}));
vi.mock("./settings/AlertRulesSettingsCard", () => ({
  AlertRulesSettingsCard: () => null,
}));
vi.mock("../hooks/use-replay-storage-status", () => ({
  useReplayStorageStatus: mocks.useReplayStorageStatus,
}));
vi.mock("./sessions/SessionsPage", () => ({
  ReplayStorageHint: () => null,
}));
vi.mock("react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Settings from "./Settings";

describe("Analytics Settings", () => {
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
    vi.clearAllMocks();
  });

  it("renders from the framework session without a template AuthProvider", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    expect(container.textContent).toContain("settings-user@example.com");
    expect(mocks.useLegacyAuth).not.toHaveBeenCalled();
  });

  it("keeps optional replay storage out of general settings", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    expect(container.textContent).not.toContain("settings.replayStorage");
  });
});
