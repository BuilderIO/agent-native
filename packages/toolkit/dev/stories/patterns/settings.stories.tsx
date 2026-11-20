import type { ScreenModel } from "@agent-native/design-system/model";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconBell, IconBook, IconLogout, IconUser } from "@tabler/icons-react";
import type * as React from "react";
import { useMemo } from "react";

import { brandLogoUrl } from "../../../src/app/settings/infra/logos.js";
import { SettingsSurfaceProvider } from "../../../src/app/settings/SettingsSection.js";
import type {
  SettingsPageContext,
  SettingsPageDefinition,
} from "../../../src/app/settings/shell/registry.js";
import { buildSettingsNavModel } from "../../../src/app/settings/shell/settings-nav-model.js";
import { SettingsNavPartsProvider } from "../../../src/design-system/agent-native-parts/settings-nav.js";
import { ModelSurface } from "../../../src/design-system/parts.js";
import { AppShell, AppShellCanvas } from "../../../src/ui/base-ui/app-shell.js";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../../../src/ui/base-ui/item.js";
import {
  PageHeader,
  PageHeaderTitle,
} from "../../../src/ui/base-ui/page-header.js";
import { Sidebar } from "../../../src/ui/base-ui/sidebar.js";

const LOGO = brandLogoUrl("builder-cms");

type Icon = React.ComponentType<{ className?: string }>;

const ICONS: Record<string, Icon> = {
  profile: IconUser,
  notifications: IconBell,
  docs: IconBook,
};

const PAGES = [
  { id: "profile", group: "account", label: "Profile" },
  { id: "notifications", group: "account", label: "Notifications" },
  { id: "whats-new", group: "app", label: "What's new" },
].map(
  (page) =>
    ({
      ...page,
      icon: ICONS[page.id] ?? IconBook,
    }) as unknown as SettingsPageDefinition,
);

const SECTIONS = [
  {
    id: "account",
    label: "Account",
    items: [
      { id: "profile", type: "page" as const, pageId: "profile" },
      { id: "notifications", type: "page" as const, pageId: "notifications" },
      {
        id: "notifications-email",
        type: "page" as const,
        pageId: "notifications",
        sub: "email",
        label: "Email",
      },
    ],
  },
  {
    id: "more",
    label: "More",
    items: [
      { id: "whats-new", type: "page" as const, pageId: "whats-new" },
      {
        id: "docs",
        type: "link" as const,
        label: "Docs",
        href: "/docs",
        icon: IconBook,
      },
      {
        id: "docs-off",
        type: "link" as const,
        label: "Archive",
        href: "/archive",
        disabled: true,
      },
      {
        id: "sign-out",
        type: "action" as const,
        label: "Sign out",
        icon: IconLogout,
        onSelect: () => {},
      },
    ],
  },
];

const ACTIVE = { pageId: "profile", sub: null as string | null };
const UNREAD = ["whats-new"];
const pageHref = (page: SettingsPageDefinition, sub: string | undefined) =>
  sub ? `/settings/${page.id}/${sub}` : `/settings/${page.id}`;
const pageIcon = (page: SettingsPageDefinition) => page.icon as Icon;

function PartNav() {
  const navModel = useMemo(
    () =>
      buildSettingsNavModel({
        pages: PAGES,
        allPages: PAGES,
        groups: ["account", "app"],
        activePageId: ACTIVE.pageId,
        activeSub: ACTIVE.sub,
        unreadPageIds: UNREAD,
        context: {} as SettingsPageContext,
        appNavigationSections: SECTIONS,
        navLabel: "Settings",
        groupLabel: (group) => group,
        pageLabel: (page) => String(page.label),
        pageIcon,
        pageHref,
        linkHref: (href) => href,
      }),
    [],
  );
  const actions = useMemo(
    () =>
      Object.fromEntries(
        [...navModel.targets.keys()].map((rowId) => [
          `settings-nav:${rowId}`,
          () => {},
        ]),
      ),
    [navModel],
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

const rowsModel: ScreenModel = {
  id: "gallery",
  rows: [
    {
      id: "gallery.settings.group",
      part: "settings.group",
      label: "Notifications",
      rows: [
        {
          id: "gallery.settings.toggle",
          part: "settings.row",
          kind: "toggle",
          label: "Error emails",
          description: "Email me when a scheduled query fails.",
          state: { checked: false },
          effect: { kind: "action", effectId: "toggle" },
        },
        {
          id: "gallery.settings.toggle-on",
          part: "settings.row",
          kind: "toggle",
          label: "Completion bell",
          state: { checked: true },
          effect: { kind: "action", effectId: "toggle" },
        },
        {
          id: "gallery.settings.destination",
          part: "settings.row",
          label: "Credentials",
          description: "Keys the agent uses to read your data sources.",
          icon: { kind: "symbol", key: "google" },
          rows: [
            {
              id: "gallery.settings.destination.manage",
              part: "button",
              kind: "destination",
              label: "Manage data sources",
              effect: { kind: "navigate", to: "#notifications" },
            },
          ],
        },
        {
          id: "gallery.settings.action",
          part: "settings.row",
          label: "Meeting capture",
          description: "Record meetings from the desktop app.",
          rows: [
            {
              id: "gallery.settings.action.open",
              part: "button",
              kind: "action",
              label: "Open Clips desktop",
              icon: { kind: "symbol", key: "external-link" },
              effect: { kind: "action", effectId: "noop" },
            },
          ],
        },
        {
          id: "gallery.settings.pending",
          part: "settings.row",
          label: "Google Calendar",
          rows: [
            {
              id: "gallery.settings.pending.connect",
              part: "button",
              kind: "action",
              label: "Connect",
              state: { pending: true },
              effect: { kind: "action", effectId: "noop" },
            },
          ],
        },
        {
          id: "gallery.settings.info",
          part: "settings.row",
          kind: "info",
          label: "Workspace",
          description: "Acme",
        },
      ],
    },
    {
      id: "gallery.settings.extras",
      part: "settings.group",
      label: "Usage",
      labelHidden: true,
      rows: [
        {
          id: "gallery.settings.badge",
          part: "settings.row",
          label: "Monthly budget",
          description: "Alerts at 80% of 500 credits.",
          state: { badge: { kind: "label", value: "Default" } },
        },
        {
          id: "gallery.settings.status",
          part: "settings.row",
          label: "Default model",
          description: "Uses the global LLM default.",
          regions: { status: "source" },
        },
        {
          id: "gallery.settings.detail",
          part: "settings.row",
          label: "Domain auto-join",
          regions: { detail: "domains" },
        },
        {
          id: "gallery.settings.description",
          part: "settings.row",
          label: "API key",
          description: "Used by Organization.",
          regions: { description: "used-by" },
        },
        {
          id: "gallery.settings.label",
          part: "settings.row",
          label: "OPENAI_API_KEY",
          regions: { label: "key-name" },
        },
        {
          id: "gallery.settings.image",
          part: "settings.row",
          label: "AI model",
          description: "Builder",
          icon: { kind: "image", src: LOGO },
        },
      ],
    },
    {
      id: "gallery.settings.notice",
      part: "settings.notice",
      label: "Usage couldn't load.",
      rows: [
        {
          id: "gallery.settings.notice.retry",
          part: "button",
          kind: "action",
          label: "Retry",
          effect: { kind: "action", effectId: "noop" },
        },
      ],
    },
  ],
};

const SLOTS = {
  source: "Workspace",
  domains: "acme.test",
  "used-by": (
    <>
      Used by <a href="#notifications">Organization</a>.
    </>
  ),
  "key-name": <code>OPENAI_API_KEY</code>,
  content: (
    <Item>
      <ItemContent>
        <ItemTitle>Provider</ItemTitle>
        <ItemDescription>Builder</ItemDescription>
      </ItemContent>
    </Item>
  ),
};

const pageModel: ScreenModel = {
  id: "gallery",
  rows: [
    {
      id: "gallery.section.page",
      part: "settings.section",
      label: "LLM",
      description: "Choose the model provider.",
      anchor: "case-page",
      state: { complete: true },
      slot: "content",
    },
    {
      id: "gallery.section.required",
      part: "settings.section",
      label: "Email",
      anchor: "case-required",
      state: { badge: { kind: "label", value: "Required", tone: "attention" } },
      slot: "content",
    },
    {
      id: "gallery.section.flat",
      part: "settings.section",
      label: "Demo mode",
      anchor: "case-flat",
      regions: { body: "content" },
    },
    {
      id: "gallery.section.group",
      part: "settings.group",
      label: "Agent",
      rows: [
        {
          id: "gallery.section.grouped",
          part: "settings.section",
          label: "Agent Limits",
          anchor: "case-grouped",
          slot: "content",
        },
      ],
    },
  ],
};

const sidebarModel: ScreenModel = {
  id: "gallery",
  rows: [
    {
      id: "gallery.section.sidebar",
      part: "settings.section",
      label: "LLM",
      anchor: "case-sidebar",
      icon: { kind: "symbol", key: "brain" },
      state: { complete: true, expanded: false },
      effect: { kind: "action", effectId: "toggle" },
      slot: "content",
    },
    {
      id: "gallery.section.sidebar-open",
      part: "settings.section",
      label: "Email",
      description: "Needed before deploy for password resets.",
      anchor: "case-sidebar-open",
      icon: { kind: "symbol", key: "mail" },
      state: {
        expanded: true,
        badge: { kind: "label", value: "Required", tone: "attention" },
      },
      effect: { kind: "action", effectId: "toggle" },
      slot: "content",
    },
  ],
};

const noop = () => {};

function SettingsPage() {
  return (
    <div className="h-screen">
      <AppShell>
        <Sidebar aria-label="Settings">
          <PartNav />
        </Sidebar>
        <AppShellCanvas>
          <div className="mx-auto flex w-full max-w-170 flex-col gap-8 px-8 py-6">
            <PageHeader>
              <PageHeaderTitle>Account</PageHeaderTitle>
            </PageHeader>
            <SettingsSurfaceProvider surface="page">
              <ModelSurface
                model={rowsModel}
                navigate={noop}
                actions={{ toggle: noop, noop }}
                slots={SLOTS}
              />
              <ModelSurface model={pageModel} slots={SLOTS} />
            </SettingsSurfaceProvider>
          </div>
        </AppShellCanvas>
      </AppShell>
    </div>
  );
}

function SidebarSections() {
  return (
    <SettingsSurfaceProvider surface="sidebar">
      <div className="flex w-72 flex-col gap-2 p-6">
        <ModelSurface
          model={sidebarModel}
          actions={{ toggle: noop }}
          slots={SLOTS}
        />
      </div>
    </SettingsSurfaceProvider>
  );
}

const meta = {
  title: "Patterns/Settings",
  parameters: { layout: "fullscreen" },
  tags: ["!manifest"],
} satisfies Meta;

export default meta;

/** A settings page: the nav, rows of every kind, sections and a notice. */
export const Page: StoryObj = {
  render: () => <SettingsPage />,
};

/** Sections as they collapse in a narrow sidebar surface. */
export const SidebarSurface: StoryObj = {
  render: () => <SidebarSections />,
};
