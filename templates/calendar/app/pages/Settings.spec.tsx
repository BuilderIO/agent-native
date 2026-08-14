// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  LanguagePicker: () => null,
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/org", () => ({
  TeamPage: () => null,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  AccountSettingsCard: () => null,
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
      <span>{label}</span>
      {description}
      {control}
    </div>
  ),
  SettingsTabsPage: ({ general }: { general: React.ReactNode }) => (
    <main>{general}</main>
  ),
  useAgentSettingsTabs: () => [],
}));

vi.mock("@agent-native/core/client/ui", () => ({
  AppearancePicker: () => null,
}));

vi.mock("@/components/calendar/GoogleSetupWizard", () => ({
  GoogleSetupWizard: () => null,
}));

vi.mock("@/components/TimezoneCombobox", () => ({
  TimezoneCombobox: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
  }: {
    asChild?: boolean;
    children?: React.ReactNode;
  }) => (asChild ? children : <button>{children}</button>),
}));

vi.mock("@/components/ui/card", () => {
  const CardPart = ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>;
  return {
    Card: CardPart,
    CardContent: CardPart,
    CardDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
    CardHeader: CardPart,
    CardTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useDisconnectGoogle: () => ({ mutateAsync: vi.fn(async () => undefined) }),
  useGoogleAuthStatus: () => ({
    data: { connected: false, accounts: [] },
  }),
  useGoogleAuthUrl: () => ({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
  }),
  useGoogleDesktopAuth: () => ({
    isDesktopGoogleAuth: false,
    isGoogleDesktopAuthPending: false,
    startDesktopGoogleAuth: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: {
      bookingPageDescription: "",
      bookingPageTitle: "",
      defaultEventDuration: 30,
      timezone: "America/New_York",
      weekStart: "sunday",
    },
  }),
  useUpdateSettings: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-zoom-auth", () => ({
  useConnectZoom: () => ({ isPending: false, mutate: vi.fn() }),
  useDisconnectZoom: () => ({ isPending: false, mutate: vi.fn() }),
  useZoomStatus: () => ({
    data: { accounts: [], configured: true, connected: false },
  }),
}));

vi.mock("@/lib/google-oauth-setup", () => ({
  shouldOfferGoogleOAuthSetup: () => false,
}));

vi.mock("react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import Settings from "./Settings";

describe("Calendar Settings", () => {
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

  it("links to availability from General settings", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    const availabilityLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/booking-links?tab=availability"]',
    );

    expect(availabilityLink).not.toBeNull();
    expect(availabilityLink?.textContent).toContain(
      "bookingLinks.availability",
    );
  });

  it("renders the week-start setting in General settings", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    expect(container.textContent).toContain("settings.weekStartLabel");
    expect(container.textContent).toContain("settings.weekStartSunday");
    expect(container.textContent).toContain("settings.weekStartMonday");
  });
});
