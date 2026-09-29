// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creativeContextEnabled: false,
  settingsRedesign: false,
  pageProps: null as Record<string, unknown> | null,
  mutateAsync: vi.fn(async () => ({ success: true })),
  // Stable like react-query's structurally shared data.
  prefs: {},
  useActionQuery: vi.fn(() => ({
    data: mocks.prefs,
    isLoading: false,
  })),
  useActionMutation: vi.fn((_name: string) => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  })),
  useLegacyAuth: vi.fn(() => {
    throw new Error("Settings must not depend on the template AuthProvider");
  }),
  useOrg: vi.fn(
    (): {
      data?: { orgId?: string; role?: string };
      isLoading?: boolean;
      isError?: boolean;
    } => ({
      data: { orgId: "org-1", role: "member" },
      isLoading: false,
      isError: false,
    }),
  ),
  useReplayStorageStatus: vi.fn(() => ({
    data: { configured: false },
    isLoading: false,
  })),
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/creative-context", () => ({
  CREATIVE_CONTEXT_LIBRARY_LAB: {
    key: "creative-context.library",
    defaultEnabled: false,
  },
}));

vi.mock("@agent-native/creative-context/client", () => ({
  createCreativeContextAgentTab: vi.fn(),
  useCreativeContextLab: () => mocks.creativeContextEnabled,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({
    status: "ready",
    enabled: mocks.settingsRedesign,
  }),
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

vi.mock("@agent-native/core/client/navigation", () => ({
  buildSettingsRoute: (section: string) => `/settings/${section}`,
}));

vi.mock("@agent-native/core/client/observability", () => ({
  ObservabilityDashboard: ({
    routeBasePath,
    showHumanReview,
    renderArtifactPreview,
  }: {
    routeBasePath: string;
    showHumanReview?: boolean;
    renderArtifactPreview?: (...args: unknown[]) => React.ReactNode;
  }) => (
    <div
      data-testid="observability-dashboard"
      data-route-base-path={routeBasePath}
      data-show-human-review={String(showHumanReview === true)}
      data-has-artifact-preview={String(
        typeof renderArtifactPreview === "function",
      )}
    />
  ),
}));

vi.mock("../components/AnalyticsReviewArtifactPreview", () => ({
  AnalyticsReviewArtifactPreview: () => null,
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
  SettingsTabsPage: (props: {
    account: React.ReactNode;
    general?: React.ReactNode;
    notifications?: React.ReactNode;
    appAreas?: Array<{ id: string; content: React.ReactNode }>;
    extraTabs?: Array<{
      id: string;
      label: string;
      href?: string;
      group?: string;
      content: React.ReactNode;
    }>;
    labs?: Array<{
      key: string;
      defaultEnabled?: boolean;
      displayName?: string;
      description?: string;
    }>;
  }) => {
    mocks.pageProps = props;
    return (
      <main>
        {props.account}
        {props.general}
        <nav>
          {props.extraTabs?.map((tab) => (
            <a
              key={tab.id}
              data-testid={`settings-tab-${tab.id}`}
              data-group={tab.group}
              href={tab.href}
            >
              {tab.label}
            </a>
          ))}
        </nav>
        {props.labs?.map((lab) => (
          <div key={lab.key} data-testid="creative-context-lab">
            {lab.displayName}
            {lab.description}
            <span data-default-enabled={String(lab.defaultEnabled === true)} />
          </div>
        ))}
        {props.extraTabs?.map((tab) => (
          <div key={tab.id} data-tab={tab.id}>
            {tab.content}
          </div>
        ))}
        {props.appAreas?.map((area) => (
          <div key={area.id} data-area={area.id}>
            {area.content}
          </div>
        ))}
        {props.notifications ? (
          <div data-page="notifications">{props.notifications}</div>
        ) : null}
      </main>
    );
  },
  useAgentSettingsTabs: ({
    agentAdditionalContent,
    agentAdditionalTabFactories,
  }: {
    agentAdditionalContent?: React.ReactNode;
    agentAdditionalTabFactories?: unknown[];
  } = {}) => [
    {
      id: "agent",
      label: "Agent",
      content: agentAdditionalContent ?? null,
    },
    ...(agentAdditionalTabFactories?.length
      ? [
          {
            id: "creative-context",
            label: "Library",
            content: <div id="creative-context-agent-tab">Library</div>,
          },
        ]
      : []),
  ],
}));

vi.mock("@agent-native/core/client/org", () => ({
  TeamPage: () => null,
  useOrg: mocks.useOrg,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: mocks.useLegacyAuth,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    "aria-label": ariaLabel,
    checked,
    onCheckedChange,
  }: {
    "aria-label"?: string;
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <button
      aria-label={ariaLabel}
      aria-pressed={checked}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));
vi.mock("./settings/AlertRulesSettingsCard", () => ({
  AlertRulesSettingsCard: ({ embedded }: { embedded?: boolean }) => (
    <div data-alert-rules={embedded ? "embedded" : "card"} />
  ),
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
    mocks.creativeContextEnabled = false;
    mocks.settingsRedesign = false;
    mocks.pageProps = null;
    mocks.useOrg.mockReturnValue({
      data: { orgId: "org-1", role: "member" },
      isLoading: false,
      isError: false,
    });
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

  it("does not render an About section", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    expect(container.querySelector("#about")).toBeNull();
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

  it("keeps the completion bell disabled by default", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    const toggle = container.querySelector('[aria-label="settings.bellSound"]');
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("lists Creative Context in Labs but hides its tab until enabled", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    expect(container.textContent).toContain("creativeContext.share.title");
    expect(container.textContent).toContain("creativeContext.description");
    expect(
      container.querySelector(
        '[data-testid="creative-context-lab"] [data-default-enabled="false"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector("#creative-context-agent-tab")).toBeNull();
  });

  it("shows the Creative Context settings tab when its Lab is enabled", async () => {
    mocks.creativeContextEnabled = true;

    await act(async () => {
      root.render(<Settings />);
    });

    expect(
      container.querySelector("#creative-context-agent-tab"),
    ).not.toBeNull();
  });

  it("keeps today's tabs with the settings redesign off", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    expect(container.querySelector("#language")).not.toBeNull();
    expect(
      container.querySelector('[data-tab="alerts"] [data-alert-rules="card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-tab="agent"] #bell-sound'),
    ).not.toBeNull();
    expect(container.querySelector('[data-page="notifications"]')).toBeNull();
    expect(mocks.pageProps).not.toHaveProperty("team");
    expect(mocks.pageProps).not.toHaveProperty("appAreas");
  });

  it("moves rows into the redesigned pages with the flag on", async () => {
    mocks.settingsRedesign = true;

    await act(async () => {
      root.render(<Settings />);
    });

    const areas = [...container.querySelectorAll("[data-area]")].map((area) =>
      area.getAttribute("data-area"),
    );
    expect(areas).toEqual(["alerts", "data-sources"]);
    expect(
      container.querySelector(
        '[data-area="alerts"] [data-alert-rules="embedded"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-area="data-sources"] #credentials'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-page="notifications"] #error-email-notifications',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-page="notifications"] #bell-sound'),
    ).not.toBeNull();
    expect(container.querySelector("#language")).toBeNull();
    expect(container.querySelector('[data-tab="alerts"]')).toBeNull();
    expect(
      container.querySelector('[data-tab="agent"] #bell-sound'),
    ).toBeNull();
    expect(container.querySelectorAll("#bell-sound")).toHaveLength(1);
    expect(mocks.pageProps?.general).toBeUndefined();
    expect(mocks.pageProps).not.toHaveProperty("team");
  });

  it("saves only the notification preference that changed", async () => {
    mocks.settingsRedesign = true;

    await act(async () => {
      root.render(<Settings />);
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="settings.bellSound"]',
    );
    await act(async () => {
      toggle?.click();
    });

    expect(mocks.useActionMutation).toHaveBeenCalledWith(
      "update-analytics-notification-preferences",
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ bellSoundEnabled: true });
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  });

  it.each(["owner", "admin"] as const)(
    "shows the org observability route to an %s",
    async (role) => {
      mocks.useOrg.mockReturnValue({
        data: { orgId: "org-1", role },
        isLoading: false,
        isError: false,
      });

      await act(async () => {
        root.render(<Settings />);
      });

      const tab = container.querySelector<HTMLAnchorElement>(
        '[data-testid="settings-tab-observability"]',
      );
      expect(tab?.getAttribute("href")).toBe(
        "/settings/observability/overview",
      );
      expect(tab?.getAttribute("data-group")).toBe("agent");
      expect(
        container
          .querySelector("[data-testid='observability-dashboard']")
          ?.getAttribute("data-route-base-path"),
      ).toBe("/settings/observability");
      expect(
        container
          .querySelector("[data-testid='observability-dashboard']")
          ?.getAttribute("data-show-human-review"),
      ).toBe("true");
      expect(
        container
          .querySelector("[data-testid='observability-dashboard']")
          ?.getAttribute("data-has-artifact-preview"),
      ).toBe("true");
    },
  );

  it.each([
    ["a member", { data: { orgId: "org-1", role: "member" } }],
    ["while the org is loading", { data: undefined, isLoading: true }],
    ["when org loading fails", { data: undefined, isError: true }],
    ["without an active org", { data: { role: "admin" } }],
  ])("fails closed for %s", async (_state, orgResult) => {
    mocks.useOrg.mockReturnValue(orgResult);

    await act(async () => {
      root.render(<Settings />);
    });

    expect(
      container.querySelector('[data-testid="settings-tab-observability"]'),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='observability-dashboard']"),
    ).toBeNull();
  });

  it("keeps the org observability page with the settings redesign on", async () => {
    mocks.settingsRedesign = true;
    mocks.useOrg.mockReturnValue({
      data: { orgId: "org-1", role: "owner" },
      isLoading: false,
      isError: false,
    });

    await act(async () => {
      root.render(<Settings />);
    });

    expect(
      container
        .querySelector('[data-testid="settings-tab-observability"]')
        ?.getAttribute("href"),
    ).toBe("/settings/observability/overview");
    expect(
      container.querySelector("[data-testid='observability-dashboard']"),
    ).not.toBeNull();
  });
});
