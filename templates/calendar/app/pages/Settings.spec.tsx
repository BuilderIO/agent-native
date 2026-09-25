// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  flagState,
  googleStatusState,
  requestMeetingStartNotificationPermissionMock,
  settingsTabsPageProps,
  updateSettingsMutateMock,
  zoomDisconnectMock,
  zoomStatusState,
} = vi.hoisted(() => ({
  flagState: { enabled: false },
  googleStatusState: {
    data: { connected: false, accounts: [] as Array<{ email: string }> },
  } as Record<string, unknown>,
  requestMeetingStartNotificationPermissionMock: vi.fn(async () => "granted"),
  settingsTabsPageProps: { current: null as Record<string, unknown> | null },
  updateSettingsMutateMock: vi.fn(),
  zoomDisconnectMock: vi.fn(),
  zoomStatusState: {
    data: { accounts: [], configured: true, connected: false },
  } as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/changelog", () => ({
  ChangelogSettingsCard: () => null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({
    status: "ready",
    enabled: flagState.enabled,
  }),
}));

vi.mock("@agent-native/core/client/integrations", () => ({
  startWorkspaceProviderOAuth: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  LanguagePicker: () => <span>language-picker</span>,
  useT: () => (key: string) => key,
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
  SettingsTabsPage: (props: {
    general?: React.ReactNode;
    generalGroups?: React.ReactNode;
    appAreas?: Array<{ id: string; content: React.ReactNode }>;
    notifications?: React.ReactNode;
  }) => {
    settingsTabsPageProps.current = props;
    // Mirrors the real page: today's tabs show `general`, the redesigned
    // shell shows the groups, each area, and the Notifications page.
    if (!flagState.enabled) return <main>{props.general}</main>;
    return (
      <main>
        <section data-page="app">{props.generalGroups}</section>
        {props.appAreas?.map((area) => (
          <section key={area.id} data-area={area.id}>
            {area.content}
          </section>
        ))}
        <section data-page="notifications">{props.notifications}</section>
      </main>
    );
  },
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

vi.mock("@/components/ui/alert-dialog", () => {
  const Part = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (open ? <div role="alertdialog">{children}</div> : null),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => <button onClick={onClick}>{children}</button>,
    AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
      <button>{children}</button>
    ),
    AlertDialogContent: Part,
    AlertDialogDescription: Part,
    AlertDialogFooter: Part,
    AlertDialogHeader: Part,
    AlertDialogTitle: Part,
  };
});

vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (open ? <div role="dialog">{children}</div> : null),
    DialogContent: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <span data-skeleton />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    disabled,
    onClick,
  }: {
    asChild?: boolean;
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) =>
    asChild ? (
      children
    ) : (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
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
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useDisconnectGoogle: () => ({ mutateAsync: vi.fn(async () => undefined) }),
  useGoogleAuthStatus: () => googleStatusState,
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
    mutate: updateSettingsMutateMock,
  }),
}));

vi.mock("@/hooks/use-meeting-start-notifications", () => ({
  getMeetingStartNotificationPermission: () => "default",
  requestMeetingStartNotificationPermission:
    requestMeetingStartNotificationPermissionMock,
}));

vi.mock("@/hooks/use-zoom-auth", () => ({
  useConnectZoom: () => ({ isPending: false, mutate: vi.fn() }),
  useDisconnectZoom: () => ({ isPending: false, mutate: zoomDisconnectMock }),
  useZoomStatus: () => zoomStatusState,
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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import Settings from "./Settings";

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === name,
  );
}

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
    flagState.enabled = false;
    for (const key of Object.keys(googleStatusState)) {
      delete googleStatusState[key];
    }
    googleStatusState.data = { connected: false, accounts: [] };
    zoomStatusState.data = { accounts: [], configured: true, connected: false };
    settingsTabsPageProps.current = null;
  });

  async function renderSettings() {
    const queryClient = new QueryClient();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Settings />
        </QueryClientProvider>,
      );
    });
  }

  it("keeps today's tabs unchanged with the redesign flag off", async () => {
    await renderSettings();

    const props = settingsTabsPageProps.current;
    expect(props?.appAreas).toBeUndefined();
    expect(props?.notifications).toBeUndefined();
    expect(props).not.toHaveProperty("team");
    expect(container.textContent).toContain("language-picker");
    expect(container.querySelector("#google-calendar")).toBeNull();
    expect(container.querySelector("#zoom")).not.toBeNull();
  });

  it("splits Settings into General, Calendars, Booking, and Notifications with the flag on", async () => {
    flagState.enabled = true;
    await renderSettings();

    const props = settingsTabsPageProps.current;
    expect(
      (props?.appAreas as Array<{ id: string }>).map((area) => area.id),
    ).toEqual(["calendars", "booking"]);

    const general = container.querySelector('[data-page="app"]');
    // Calendar's own zone must not read as the account-wide Preferences one.
    expect(general?.querySelector("#timezone")?.textContent).toContain(
      "calendarSettings.timezone",
    );
    expect(
      (
        props?.generalSearchEntries as Array<{ id: string; label: string }>
      ).find((entry) => entry.id === "calendar-timezone")?.label,
    ).toBe("calendarSettings.timezone");
    expect(general?.querySelector("#week-start")).not.toBeNull();
    expect(general?.querySelector("#default-duration")).not.toBeNull();
    expect(general?.querySelector("#appearance")).not.toBeNull();
    // Interface language lives on Account › Preferences.
    expect(container.textContent).not.toContain("language-picker");

    const calendars = container.querySelector('[data-area="calendars"]');
    expect(calendars?.querySelector("#zoom")).not.toBeNull();
    const booking = container.querySelector('[data-area="booking"]');
    expect(
      booking?.querySelector('a[href="/booking-links?tab=availability"]'),
    ).not.toBeNull();
    expect(booking?.querySelector("#booking-page")).not.toBeNull();

    const notifications = container.querySelector(
      '[data-page="notifications"]',
    );
    expect(
      notifications?.querySelector("#desktop-notifications"),
    ).not.toBeNull();
  });

  it("saves the week start as soon as it changes", async () => {
    flagState.enabled = true;
    await renderSettings();

    const select =
      container.querySelector<HTMLSelectElement>("#week-start select");
    expect(select).not.toBeNull();
    await act(async () => {
      select!.value = "monday";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(updateSettingsMutateMock).toHaveBeenCalledWith(
      { weekStart: "monday" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("asks before disconnecting Zoom", async () => {
    flagState.enabled = true;
    zoomStatusState.data = {
      accounts: [{ id: "zoom-1", email: "person@example.com" }],
      configured: true,
      connected: true,
    };
    await renderSettings();

    const zoomRow = container.querySelector<HTMLElement>(
      '[data-area="calendars"] #zoom',
    );
    expect(zoomRow?.textContent).toContain("calendarSettings.connectedAs");
    await act(async () => {
      buttonNamed(zoomRow!, "common.disconnect")?.click();
    });
    expect(zoomDisconnectMock).not.toHaveBeenCalled();

    const confirm = container.querySelector<HTMLElement>(
      '[role="alertdialog"]',
    );
    expect(confirm?.textContent).toContain(
      "calendarSettings.disconnectZoomTitle",
    );
    await act(async () => {
      buttonNamed(confirm!, "common.disconnect")?.click();
    });
    expect(zoomDisconnectMock).toHaveBeenCalledOnce();
  });

  it("shows a retry row when the Google status can't load", async () => {
    flagState.enabled = true;
    const refetch = vi.fn();
    googleStatusState.data = undefined;
    googleStatusState.isError = true;
    googleStatusState.refetch = refetch;
    await renderSettings();

    const googleRow = container.querySelector<HTMLElement>(
      '[data-area="calendars"] #google-calendar',
    );
    expect(googleRow?.textContent).toContain("common.loadFailed");
    await act(async () => {
      buttonNamed(googleRow!, "common.retry")?.click();
    });
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("links to availability from General settings", async () => {
    await renderSettings();

    const availabilityLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/booking-links?tab=availability"]',
    );

    expect(availabilityLink).not.toBeNull();
    expect(availabilityLink?.textContent).toContain(
      "bookingLinks.availability",
    );
  });

  it("renders the week-start setting in General settings", async () => {
    await renderSettings();

    expect(container.textContent).toContain("settings.weekStartLabel");
    expect(container.textContent).toContain("settings.weekStartSunday");
    expect(container.textContent).toContain("settings.weekStartMonday");
  });

  it("requests system notification permission from the settings row", async () => {
    await renderSettings();

    const enableButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "settings.enableDesktopNotifications",
    );
    expect(enableButton).not.toBeUndefined();

    await act(async () => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      requestMeetingStartNotificationPermissionMock,
    ).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "settings.desktopNotificationsEnabled",
    );
  });
});
