// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creativeContextEnabled: false,
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
  SettingsTabsPage: ({
    account,
    general,
    extraTabs,
    labs,
  }: {
    account: React.ReactNode;
    general: React.ReactNode;
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
  }) => (
    <main>
      {account}
      {general}
      <nav>
        {extraTabs?.map((tab) => (
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
      {labs?.map((lab) => (
        <div key={lab.key} data-testid="creative-context-lab">
          {lab.displayName}
          {lab.description}
          <span data-default-enabled={String(lab.defaultEnabled === true)} />
        </div>
      ))}
      {extraTabs?.map((tab) => tab.content)}
    </main>
  ),
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
    mocks.creativeContextEnabled = false;
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
});
