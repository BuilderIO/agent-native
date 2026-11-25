// @vitest-environment happy-dom

import {
  captureRows,
  compareRowSnapshots,
  type RowSnapshot,
  type ScreenModel,
} from "@agent-native/design-system/model";
import {
  IconAlertTriangle,
  IconBell,
  IconBook,
  IconLogout,
  IconUser,
} from "@tabler/icons-react";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useOptionalLocale: () => ({}),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "steve@builder.io" },
    status: "authenticated",
  }),
}));
vi.mock("@agent-native/core/client/app-config", () => ({
  injectedAgentNativeConfig: () => ({
    themeFamily: {
      families: ["original", "agent-native"],
      defaultFamily: "agent-native",
    },
  }),
}));
vi.mock("../shared/index.js", () => ({
  LanguagePicker: ({ label }: { label?: string }) => (
    <button type="button">{label}</button>
  ),
}));
vi.mock("./SchedulingTimezoneField.js", () => ({
  SchedulingTimezoneField: () => <div />,
}));
vi.mock("./VoiceTranscriptionSection.js", () => ({
  useVoiceTranscriptionRow: () => ({
    rows: [
      {
        id: "settings.voice.transcription",
        part: "settings.row",
        label: "Voice transcription",
        anchor: "voice",
        slot: "voice-transcription-control",
      },
    ],
    slots: { "voice-transcription-control": <div /> },
  }),
}));
vi.mock("./VoiceChatSettings.js", () => ({
  VoiceChatSettings: () => <section id="voice-chat" />,
}));
vi.mock("./account/ThemeFamilySettings.js", () => ({
  ThemeFamilySettings: () => <div />,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  uploadAvatar: vi.fn(async () => "data:,"),
  invalidateAvatarCache: vi.fn(),
  useAvatarUrl: () => null,
  useActionQuery: (name: string) => ({
    data:
      name === "get-user-profile"
        ? { email: "steve@example.com", name: "Steve" }
        : { hasPassword: false },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({
    error: null,
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
  useSession: () => ({
    session: { email: "steve@example.com", name: "Steve" },
    status: "authenticated",
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { emailConfigured: true }, isLoading: false }),
}));
vi.mock("@agent-native/core/client/auth/two-factor", () => ({
  getTwoFactorStatus: vi.fn(async () => ({ enabled: false })),
  enableTwoFactor: vi.fn(),
  verifyTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
}));

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { ThemeProvider } from "next-themes";

import { SettingsNavPartsProvider } from "../../design-system/agent-native-parts/settings-nav.js";
import { DesignSystemContext } from "../../design-system/context.js";
import { checkPartSetEquivalence } from "../../design-system/parts-testing.js";
import {
  AGENT_NATIVE_PART_SET,
  definePartSet,
  ModelSurface,
  type PartComponent,
  type PartSet,
} from "../../design-system/parts.js";
import { PLAIN_SETTINGS_PART_SET } from "../../design-system/testing/plain-settings-parts.js";
import { createToolkitI18nCatalog } from "../i18n.js";
import { PreferencesSettings } from "./account/PreferencesSettings.js";
import { ProfileSettings } from "./account/ProfileSettings.js";
import { SecuritySettings } from "./account/SecuritySettings.js";
import { SettingsSurfaceProvider } from "./SettingsSection.js";
import type {
  SettingsPageContext,
  SettingsPageDefinition,
} from "./shell/registry.js";
import { buildSettingsNavModel } from "./shell/settings-nav-model.js";

const catalog = createToolkitI18nCatalog({ messages: {} });

async function drawRows(
  partSet: PartSet,
  screen: ReactNode,
): Promise<RowSnapshot[]> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ThemeProvider attribute="class" enableSystem>
        <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
          <DesignSystemContext.Provider
            value={{ definition: { parts: partSet } }}
          >
            {screen}
          </DesignSystemContext.Provider>
        </AgentNativeI18nProvider>
      </ThemeProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  const rows = captureRows(container);
  act(() => root.unmount());
  container.remove();
  return rows;
}

async function compareScreens(screen: ReactNode, target: PartSet) {
  const ours = await drawRows(AGENT_NATIVE_PART_SET, screen);
  const theirs = await drawRows(target, screen);
  return { ours, report: compareRowSnapshots(ours, theirs) };
}

const ICONS = { profile: IconUser, notifications: IconBell } as const;

const PAGES = [
  { id: "profile", group: "account", label: "Profile" },
  { id: "notifications", group: "account", label: "Notifications" },
  { id: "whats-new", group: "app", label: "What's new" },
].map(
  (page) =>
    ({
      ...page,
      icon: page.id in ICONS ? ICONS[page.id as keyof typeof ICONS] : IconBook,
    }) as unknown as SettingsPageDefinition,
);

function SettingsNav() {
  const navModel = buildSettingsNavModel({
    pages: PAGES,
    allPages: PAGES,
    groups: ["account", "app"],
    activePageId: "profile",
    activeSub: null,
    unreadPageIds: ["whats-new"],
    context: {} as SettingsPageContext,
    appNavigationSections: [
      {
        id: "account",
        label: "Account",
        items: [
          { id: "profile", type: "page", pageId: "profile" },
          { id: "notifications", type: "page", pageId: "notifications" },
          {
            id: "notifications-email",
            type: "page",
            pageId: "notifications",
            sub: "email",
            label: "Email",
            status: { icon: IconAlertTriangle, label: "Needs setup" },
          },
        ],
      },
      {
        id: "more",
        label: "More",
        items: [
          { id: "whats-new", type: "page", pageId: "whats-new" },
          {
            id: "docs",
            type: "link",
            label: "Docs",
            href: "/docs",
            icon: IconBook,
          },
          {
            id: "archive",
            type: "link",
            label: "Archive",
            href: "/archive",
            disabled: true,
          },
          {
            id: "sign-out",
            type: "action",
            label: "Sign out",
            icon: IconLogout,
            onSelect: () => {},
          },
        ],
      },
    ],
    navLabel: "Settings",
    groupLabel: (group) => group,
    pageLabel: (page) => String(page.label),
    pageIcon: (page) => page.icon as typeof IconBook,
    pageHref: (page, sub) =>
      sub ? `/settings/${page.id}/${sub}` : `/settings/${page.id}`,
    linkHref: (href) => href,
  });
  const actions = Object.fromEntries(
    [...navModel.targets.keys()].map((rowId) => [
      `settings-nav:${rowId}`,
      () => {},
    ]),
  );
  return (
    <SettingsNavPartsProvider
      value={{ details: navModel.details, unreadLabel: "Unread" }}
    >
      <ModelSurface
        model={navModel.model}
        navigate={() => {}}
        actions={actions}
      />
    </SettingsNavPartsProvider>
  );
}

const SCREENS: ReadonlyArray<readonly [string, () => ReactNode]> = [
  ["Preferences", () => <PreferencesSettings />],
  ["Profile", () => <ProfileSettings />],
  ["Security", () => <SecuritySettings />],
  ["the settings nav", () => <SettingsNav />],
];

const statesModel: ScreenModel = {
  id: "states",
  rows: [
    {
      id: "states.group",
      part: "settings.group",
      label: "Notifications",
      rows: [
        {
          id: "states.group.off",
          part: "settings.row",
          kind: "toggle",
          label: "Error emails",
          state: { checked: false },
          effect: { kind: "action", effectId: "toggle" },
        },
        {
          id: "states.group.on",
          part: "settings.row",
          kind: "toggle",
          label: "Completion bell",
          state: { checked: true, badge: { kind: "label", value: "New" } },
          effect: { kind: "action", effectId: "toggle" },
        },
        {
          id: "states.group.locked",
          part: "settings.row",
          kind: "toggle",
          label: "Digest",
          state: { checked: true, disabled: true },
          effect: { kind: "action", effectId: "toggle" },
        },
        {
          id: "states.group.connect",
          part: "settings.row",
          label: "Google Calendar",
          rows: [
            {
              id: "states.group.connect.button",
              part: "button",
              kind: "action",
              label: "Connect",
              state: { pending: true },
              effect: { kind: "action", effectId: "toggle" },
            },
          ],
        },
        {
          id: "states.group.limits",
          part: "settings.section",
          label: "Agent limits",
          slot: "content",
        },
        {
          id: "states.group.manage",
          part: "settings.row",
          label: "Credentials",
          rows: [
            {
              id: "states.group.manage.link",
              part: "button",
              kind: "destination",
              label: "Manage",
              effect: { kind: "navigate", to: "/credentials" },
            },
          ],
        },
      ],
    },
    {
      id: "states.closed",
      part: "settings.section",
      label: "LLM",
      state: { complete: true, expanded: false },
      effect: { kind: "action", effectId: "toggle" },
      slot: "content",
    },
    {
      id: "states.open",
      part: "settings.section",
      label: "Email",
      description: "Needed before deploy.",
      state: {
        expanded: true,
        badge: { kind: "label", value: "Required", tone: "attention" },
      },
      effect: { kind: "action", effectId: "toggle" },
      slot: "content",
    },
    {
      id: "states.notice",
      part: "settings.notice",
      label: "Usage couldn't load.",
      rows: [
        {
          id: "states.notice.retry",
          part: "button",
          kind: "action",
          label: "Retry",
          effect: { kind: "action", effectId: "toggle" },
        },
      ],
    },
    {
      id: "states.report",
      part: "settings.report",
      label: "This month",
      regions: { action: "report-action" },
      rows: [
        {
          id: "states.report.total",
          part: "settings.row",
          kind: "info",
          label: "Credits used",
          description: "120 of 500",
        },
      ],
    },
  ],
};

const STATES_RUNTIME = {
  navigate: () => {},
  actions: { toggle: () => {} },
  slots: {
    content: <p>Provider</p>,
    "report-action": <a href="/usage">Details</a>,
  },
};

function requirePart(name: string): PartComponent {
  const part = PLAIN_SETTINGS_PART_SET.parts[name];
  if (!part) throw new Error(`The plain part set has no ${name}`);
  return part;
}

describe("toolkit's settings drawn by two part sets", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it.each(SCREENS)(
    "draws %s with the same rows, names and states",
    async (_name, screen) => {
      const { ours, report } = await compareScreens(
        screen(),
        PLAIN_SETTINGS_PART_SET,
      );
      expect(ours.length).toBeGreaterThan(2);
      expect(report.compared).toBe(ours.length);
      expect(report.differences).toEqual([]);
    },
  );

  it("agrees on toggles, pending and disabled controls, collapsed sections, notices and reports", async () => {
    const report = await checkPartSetEquivalence({
      model: statesModel,
      target: PLAIN_SETTINGS_PART_SET,
      runtime: STATES_RUNTIME,
    });
    expect(report.differences).toEqual([]);
    expect(report.unrendered).toEqual({ ours: [], target: [] });
    expect(report.equivalent).toBe(true);

    const page = await compareScreens(
      <SettingsSurfaceProvider surface="page">
        <ModelSurface model={statesModel} {...STATES_RUNTIME} />
      </SettingsSurfaceProvider>,
      PLAIN_SETTINGS_PART_SET,
    );
    expect(page.ours.map((row) => row.id)).toContain("states.group.limits");
    expect(page.report.differences).toEqual([]);
  });

  it("catches a part set that drops a row's label", async () => {
    const PlainRow = requirePart("settings.row");
    const unlabelled = definePartSet({
      name: "unlabelled",
      parts: {
        ...PLAIN_SETTINGS_PART_SET.parts,
        "settings.row": ({ row, children }) => (
          <PlainRow row={{ ...row, label: "" }}>{children}</PlainRow>
        ),
      },
    });
    const { report } = await compareScreens(<ProfileSettings />, unlabelled);
    expect(report.differences).toContainEqual({
      rowId: "settings.profile.details.photo",
      field: "name",
      ours: "Profile photo",
      target: "",
    });
    expect(
      new Set(report.differences.map((difference) => difference.field)),
    ).toEqual(new Set(["name"]));
  });
});
