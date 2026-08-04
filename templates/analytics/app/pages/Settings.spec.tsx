// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useActionQuery: vi.fn(() => ({
    data: {},
    isLoading: false,
  })),
  useActionMutation: vi.fn(() => ({
    mutateAsync: vi.fn(async () => ({ success: true })),
    isPending: false,
  })),
  useLegacyAuth: vi.fn(() => {
    throw new Error("Settings must not depend on the template AuthProvider");
  }),
  useReplayStorageStatus: vi.fn(() => ({
    data: { configured: false },
    isLoading: false,
  })),
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: mocks.useActionMutation,
  useActionQuery: mocks.useActionQuery,
  useSession: () => ({
    session: { email: "settings-user@example.com" },
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  LanguagePicker: () => null,
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => <div>settings-user@example.com</div>,
  SettingsGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsRow: ({
    id,
    label,
    description,
    control,
  }: {
    id?: string;
    label: React.ReactNode;
    description?: React.ReactNode;
    control?: React.ReactNode;
  }) => (
    <div id={id}>
      {label}
      {description}
      {control}
    </div>
  ),
  SettingsTabsPage: ({
    account,
    general,
  }: {
    account: React.ReactNode;
    general: React.ReactNode;
  }) => (
    <main>
      {account}
      {general}
    </main>
  ),
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/core/client/org", () => ({ TeamPage: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: mocks.useLegacyAuth,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    "aria-label": ariaLabel,
    checked,
  }: {
    "aria-label"?: string;
    checked: boolean;
  }) => <button aria-label={ariaLabel} aria-pressed={checked} />,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
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

  it("keeps new error alert emails disabled by default", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    const toggle = container.querySelector(
      '[aria-label="settings.errorEmailNotifications"]',
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });
});
