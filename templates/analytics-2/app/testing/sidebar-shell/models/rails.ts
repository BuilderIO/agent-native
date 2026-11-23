import type {
  NavigationEntry,
  NavigationModel,
  NavigationSection,
  ShellModel,
} from "@agent-native/toolkit/app-shell/sidebar-shell";

import {
  CONTEXT_RAIL_GROUPS,
  RELATED_SETTINGS,
} from "../../../components/context/ContextStudioPage";
import { resolveRoutePage } from "../../../components/workspace/pages";
import { NAV_GROUPS } from "../../../components/workspace/SettingsShell";
import type { SettingsShell } from "../../../components/workspace/SettingsShell";
import messages from "../../../i18n/en-US";

export type RailFixture =
  | { name: string; kind: "context"; path: string }
  | {
      name: string;
      kind: "settings";
      path: string;
      props: Omit<Parameters<typeof SettingsShell>[0], "children">;
      missingPages?: readonly string[];
    };

function translate(key: string): string {
  let value: unknown = messages;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object" || !(part in value))
      throw new Error(`Missing fixture translation: ${key}`);
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== "string") throw new Error(`Not a label: ${key}`);
  return value;
}

const contextIcons: Record<string, string> = {
  overview: "chart",
  suggestions: "bulb",
  evals: "flask",
  endorsements: "rosette",
  guides: "certificate",
  models: "share",
  repositories: "stack",
  connections: "link",
};
const settingsIcons: Record<string, string> = {
  profile: "user",
  preferences: "settings",
  notifications: "bell",
  "connected-apps": "link",
  "api-keys": "key",
  skills: "bolt",
  general: "adjustments",
  organization: "tag",
  "asset-statuses": "tags",
  "asset-categories": "tag",
  styling: "palette",
  "data-sources": "database",
  agent: "sparkles",
  "trusted-mode": "shield",
  "context-studio": "stack",
  secrets: "lock",
  integrations: "api",
  environment: "package",
  compute: "cpu",
  "scheduled-runs": "calendar",
  users: "users",
  groups: "usersGroup",
  "directory-sync": "refresh",
  "audit-logs": "archive",
  sso: "lock",
  "project-security": "shieldLock",
};

function destination(
  id: string,
  containerId: string,
  order: number,
  label: string,
  to: string,
  active: boolean,
  key: string | undefined,
): NavigationEntry {
  if (!key) throw new Error(`Missing fixture icon: ${id}`);
  return {
    id,
    part: "sidebar",
    subPart: "sidebar.item",
    containerId,
    order,
    kind: "destination",
    label,
    icon: { kind: "symbol", key },
    effect: { kind: "navigate", to },
    active: { kind: "resolved", value: active, ruleId: "rail-host-selection" },
  };
}

export function railModel(fixture: RailFixture): ShellModel {
  const context = fixture.kind === "context";
  const sections: NavigationSection[] = context
    ? CONTEXT_RAIL_GROUPS.map((group, order) => {
        const key = group.headingKey.split(".").at(-1);
        if (!key) throw new Error("Missing context group key");
        const id = `sidebar.context.${key}`;
        return {
          id,
          part: "sidebar",
          subPart: "sidebar.section",
          containerId: "context-rail",
          order,
          label: translate(group.headingKey),
          hideIfEmpty: false,
          entries: group.items.map((item, index) =>
            destination(
              `sidebar.context.${item.id}`,
              id,
              index,
              translate(item.labelKey),
              item.to,
              fixture.path === item.to ||
                fixture.path.startsWith(`${item.to}/`),
              contextIcons[item.id],
            ),
          ),
        };
      })
    : NAV_GROUPS.filter(
        (group) => !group.adminOnly || fixture.props.canManageWorkspace,
      )
        .map((group, order): NavigationSection => {
          const key =
            group.title === "Access & Security"
              ? "access-security"
              : group.title.toLowerCase();
          const id = `sidebar.settings.${key}`;
          return {
            id,
            part: "sidebar",
            subPart: "sidebar.section",
            containerId: "settings-rail",
            order,
            label: group.title,
            hideIfEmpty: true,
            entries: group.items
              .filter(
                (item) =>
                  !fixture.missingPages?.includes(item.tab) &&
                  Boolean(
                    resolveRoutePage({
                      id: "settings",
                      view: item.tab,
                      frame: "settings",
                      title: "Settings",
                      params: {},
                      query: new URLSearchParams(),
                      hash: "",
                    }),
                  ),
              )
              .map((item, index) =>
                destination(
                  `settings.nav.${item.tab}`,
                  id,
                  index,
                  item.label,
                  item.tab === "context-studio"
                    ? "/context-studio"
                    : `/settings/${item.tab}`,
                  item.tab === fixture.props.activeTab,
                  settingsIcons[item.tab],
                ),
              ),
          };
        })
        .filter((group) => group.entries.length > 0);
  if (context) {
    sections.unshift({
      id: "sidebar.context.setup-group",
      part: "sidebar",
      subPart: "sidebar.section",
      containerId: "context-rail",
      order: -1,
      hideIfEmpty: false,
      entries: [
        destination(
          "sidebar.context.setup",
          "sidebar.context.setup-group",
          0,
          translate("context.rail.setup"),
          "/context-studio/setup",
          fixture.path.startsWith("/context-studio/setup"),
          "collections",
        ),
      ],
    });
    sections.push({
      id: "sidebar.context.related-settings",
      part: "sidebar",
      subPart: "sidebar.section",
      containerId: "context-rail-footer",
      order: sections.length,
      label: "Related settings",
      hideIfEmpty: false,
      entries: RELATED_SETTINGS.map((entry, order) =>
        destination(
          `sidebar.context.${entry.id}`,
          "sidebar.context.related-settings",
          order,
          entry.label,
          entry.to,
          fixture.path.startsWith(entry.to),
          entry.id === "settings" ? "link" : "collections",
        ),
      ),
    });
  }
  const navigation: NavigationModel = {
    entries: [
      {
        id: context ? "sidebar.context.header" : "sidebar.settings",
        part: "sidebar",
        subPart: "sidebar.header",
        containerId: context ? "context-header" : "settings-header",
        order: 0,
        kind: "heading",
        label: context ? "Context Studio" : "Settings",
        accessibleLabel: context ? translate("context.rail.label") : "Settings",
        ...(context ? { icon: { kind: "symbol" as const, key: "stack" } } : {}),
      },
    ],
    sections,
    presentation: {
      collapsed: { value: false },
      mobileOpen: { value: false },
      peekOpen: false,
      profile: fixture.kind,
      themeFamily: "original",
      visibility: "visible",
      width: 0,
    },
  };
  return {
    frame: { key: fixture.kind, routeRuleId: "resolved-route-frame" },
    navigation,
    regions: [],
    shortcuts: [],
    preferences: [],
    effects: [],
  };
}

export const railFixtures: RailFixture[] = [
  ...[false, true].flatMap((admin) =>
    [
      "profile",
      "preferences",
      "notifications",
      "connected-apps",
      "api-keys",
      "skills",
      "general",
      "organization",
      "asset-statuses",
      "asset-categories",
      "data-sources",
      "secrets",
      "users",
      "groups",
      "directory-sync",
      "sso",
    ].map(
      (activeTab): RailFixture => ({
        kind: "settings",
        name: `settings-${admin ? "admin" : "member"}-${activeTab}`,
        path: `/settings/${activeTab}`,
        props: { activeTab, canManageWorkspace: admin },
      }),
    ),
  ),
  {
    kind: "settings",
    name: "settings-filtered-groups",
    path: "/settings/profile",
    props: { activeTab: "profile", canManageWorkspace: true },
    missingPages: [
      "users",
      "groups",
      "directory-sync",
      "sso",
      "general",
      "organization",
      "asset-statuses",
      "asset-categories",
      "data-sources",
    ],
  },
  {
    kind: "settings",
    name: "settings-admin-access-group",
    path: "/settings/sso",
    props: { activeTab: "sso", canManageWorkspace: true },
  },
  {
    kind: "settings",
    name: "settings-member-visible",
    path: "/settings/skills",
    props: { activeTab: "skills", canManageWorkspace: false },
  },
  {
    kind: "settings",
    name: "frame-settings-profile",
    path: "/settings/profile",
    props: { activeTab: "profile", canManageWorkspace: true },
  },
  ...[
    "overview",
    "suggestions",
    "evals",
    "endorsements",
    "guides",
    "models",
    "repositories",
    "knowledge",
    "apps",
  ].map(
    (view): RailFixture => ({
      kind: "context",
      name: `context-${view}`,
      path: `/context-studio/${view}`,
    }),
  ),
  {
    kind: "context",
    name: "context-nested-models",
    path: "/context-studio/models/model-a/view",
  },
  {
    kind: "context",
    name: "context-connections-first-render",
    path: "/context-studio/connections",
  },
  {
    kind: "context",
    name: "context-connections-settled",
    path: "/context-studio/connections",
  },
  {
    kind: "context",
    name: "frame-context-studio-overview",
    path: "/context-studio/overview",
  },
];
