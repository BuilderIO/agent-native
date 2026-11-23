import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useSession } from "@agent-native/core/client/use-session";
import type { WorkspaceUserGroup } from "@agent-native/core/workspace-connections/groups";
import { GroupsSection, OrgMembersPage } from "@agent-native/toolkit/app/org";
import {
  SettingsGroup,
  defineSettingsPage,
  registerSettingsPages,
  CORE_SETTINGS_PAGES,
  type AppSettingsPageDefinition,
  type AppSettingsNavigationSection,
} from "@agent-native/toolkit/app/settings";
import { Skeleton } from "@agent-native/toolkit/design-system";
import {
  IconBell,
  IconBolt,
  IconBrain,
  IconBuilding,
  IconChartBar,
  IconCpu,
  IconDatabaseCog,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconSettings,
  IconUsers,
  IconUserCircle,
} from "@tabler/icons-react";

import { AnalyticsAccountPreferencesPage } from "@/components/settings/AnalyticsAccountPreferences";
import { AnalyticsPreferencesPage } from "@/components/settings/AnalyticsPreferencesPage";
import { Button } from "@/components/ui/button";

import type environmentPackages from "../../../actions/list-environment-packages";
import { AnalyticsConnectedAppsPage } from "./AnalyticsConnectedAppsPage";
import { useAnalyticsNotificationsPageSections } from "./useAnalyticsNotificationsPageSections";

const accountPreferencesPage = CORE_SETTINGS_PAGES.find(
  (page) => page.id === "preferences",
);
if (accountPreferencesPage) {
  registerSettingsPages([
    {
      ...accountPreferencesPage,
      component: AnalyticsAccountPreferencesPage,
      keywords: `${accountPreferencesPage.keywords ?? ""} personal preferences instructions theme`,
    },
  ]);
}

export function AnalyticsComputePage() {
  const t = useT();
  const packages = useActionQuery<
    Awaited<ReturnType<typeof environmentPackages.run>>
  >("list-environment-packages", {});
  const runtime = [packages.data?.runtime, packages.data?.runtimeVersion]
    .filter(Boolean)
    .join(" ");
  return (
    <SettingsGroup title={runtime || t("analytics.computeSettings.runtime")}>
      {packages.isError ? (
        <div className="space-y-2 p-2">
          <p role="alert">{t("analytics.computeSettings.loadError")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void packages.refetch()}
          >
            {t("editorPreferences.retry")}
          </Button>
        </div>
      ) : packages.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : packages.data.packages.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {packages.data.packages.map(({ name, version }) => (
            <li key={name} className="flex justify-between gap-4 px-4 py-2">
              <span>{name}</span>
              <span className="text-muted-foreground">{version}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-2 text-sm text-muted-foreground">
          {t("analytics.computeSettings.empty")}
        </p>
      )}
    </SettingsGroup>
  );
}

export function AnalyticsGroupsPage() {
  const t = useT();
  const orgQuery = useOrg();
  const { session, isLoading: sessionLoading } = useSession();
  const email = session?.email.toLowerCase();
  const org = orgQuery.data;
  const admin = org?.role === "owner" || org?.role === "admin";
  const groups = useActionQuery<WorkspaceUserGroup[]>(
    "list-workspace-user-groups",
    {},
    {
      enabled: Boolean(email && org?.orgId) && !admin,
      queryKeyScope: [email, org?.orgId],
    },
  );
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {t("analytics.settings.workspace.groupsDescription")}
      </p>
      <SettingsGroup>
        <div className="p-2">
          {admin ? (
            <GroupsSection />
          ) : orgQuery.isError ||
            (!sessionLoading && !email) ||
            (!orgQuery.isPending && !org?.orgId) ||
            groups.isError ? (
            <p role="alert">
              {t("analytics.settings.workspace.groupsLoadError")}
            </p>
          ) : sessionLoading || !email || !org?.orgId || groups.isPending ? (
            <Skeleton className="h-12 w-full" />
          ) : groups.data.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {groups.data.map((group) => (
                <li className="px-4 py-3" key={group.id}>
                  {group.name}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("org.noGroups")}</p>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}

export const analyticsWorkspaceSettingsPages: readonly AppSettingsPageDefinition[] =
  [
    {
      id: "analytics-preferences",
      order: 100,
      labelKey: "analytics.settings.workspace.general",
      icon: IconSettings,
      component: AnalyticsPreferencesPage,
      keywords: "preferences general sql formatting keywords newline",
    },
    {
      // This page is its rows and nothing else, so it is registered as data.
      ...defineSettingsPage({
        id: "analytics-notifications",
        group: "app",
        order: 110,
        labelKey: "analytics.settings.rail.notifications",
        icon: IconBell,
        sections: useAnalyticsNotificationsPageSections,
        presentation: { hints: { frame: "group" } },
        keywords: "notifications email digest alerts",
      }),
      group: "app",
    },
    {
      id: "analytics-connected-apps",
      order: 115,
      labelKey: "analytics.settings.rail.connectedApps",
      icon: IconPlugConnected,
      component: AnalyticsConnectedAppsPage,
      keywords: "connected apps integrations connections",
    },
    {
      id: "analytics-compute",
      order: 150,
      labelKey: "analytics.computeSettings.title",
      icon: IconCpu,
      component: AnalyticsComputePage,
      keywords: "python runtime packages",
    },
    {
      id: "analytics-users",
      order: 160,
      labelKey: "analytics.settings.workspace.users",
      icon: IconUsers,
      component: () => <OrgMembersPage />,
      keywords: "users members people roles access",
    },
    {
      id: "analytics-groups",
      order: 170,
      labelKey: "analytics.settings.workspace.groups",
      icon: IconUsers,
      component: AnalyticsGroupsPage,
      keywords: "groups teams members access",
    },
  ];

/**
 * The groups the rail renders. The navigation model below keeps the reference's shape, including
 * its final PLAN & BILLING group, because a frozen check pins that shape; the rail itself never
 * shows a plan, a tier or a credits link, because this app gives its work away free (Steve's 11/5
 * rule, recorded in DEVIATIONS.md). The filtering lives here rather than at the model so the pinned
 * shape is untouched and only what a reader sees changes.
 */
export function settingsNavigationForDisplay(
  t: (key: string) => string,
): readonly AppSettingsNavigationSection[] {
  return analyticsSettingsNavigationSections(t).filter(
    (section) => section.id !== "plan",
  );
}

/**
 * The workspace settings rail: Preferences, the Projects tools, and the
 * access lists. Integrations and Users point at the shared pages because this
 * app already implements those through the same actions.
 */
export function analyticsSettingsNavigationSections(
  t: (key: string) => string,
): readonly AppSettingsNavigationSection[] {
  // Groups run in this order: ACCOUNT, WORKSPACE, FEATURES, PROJECTS, ACCESS & SECURITY, PLAN &
  // BILLING. Only rows this app backs are listed; PLAN & BILLING waits on the credits work. There
  // is no placeholder Projects page; project rows sit under the PROJECTS group.
  return [
    {
      id: "account",
      label: t("analytics.settings.rail.account"),
      items: [
        {
          // The account's own profile (photo, name, email) is a core settings page. It is listed
          // first in ACCOUNT so people can reach it without searching.
          id: "profile",
          type: "page",
          pageId: "profile",
          icon: IconUserCircle,
        },
        {
          // ACCOUNT > Preferences is the personal preferences page; the
          // workspace formatting page is WORKSPACE > General.
          id: "preferences",
          type: "page",
          pageId: "preferences",
          icon: IconSettings,
        },
        {
          // ACCOUNT > Notifications and > Connected apps are shipped pages of
          // this app; the rail had dropped both, so the rows the source lists
          // were unreachable.
          id: "notifications",
          type: "page",
          pageId: "analytics-notifications",
          label: t("analytics.settings.rail.notifications"),
          icon: IconBell,
        },
        {
          id: "connected-apps",
          type: "page",
          pageId: "analytics-connected-apps",
          label: t("analytics.settings.rail.connectedApps"),
          icon: IconPlugConnected,
        },
        {
          id: "api-keys",
          type: "page",
          pageId: "api-keys",
          icon: IconKey,
        },
      ],
    },
    {
      id: "workspace",
      label: t("analytics.settings.rail.workspace"),
      items: [
        {
          // The running app's WORKSPACE > General is the workspace-wide
          // formatting page ("SQL formatting", "Workspace name"), and its
          // WORKSPACE > Organization is the org/membership page the rail used
          // to open from "General" (measured /settings 2026-11-05 at 1280x900).
          id: "general",
          type: "page",
          pageId: "analytics-preferences",
          label: t("analytics.settings.workspace.general"),
          icon: IconBuilding,
        },
        {
          id: "organization",
          type: "page",
          pageId: "org",
          label: t("analytics.settings.workspace.organization"),
          icon: IconBuilding,
        },
        {
          id: "data-sources",
          type: "page",
          pageId: "workspace-connections",
          // The row is labeled "Data sources", the same title as the page it opens, which has a
          // "Data connections" section.
          label: t("context.rail.relatedSourcesItem"),
          icon: IconDatabaseCog,
        },
      ],
    },
    {
      // The running app's rail puts AI & agents and Context Studio between
      // WORKSPACE and PROJECTS under FEATURES (measured /settings 2026-11-05 at
      // 1280x900). Only rows this app can answer are listed: AI & agents opens
      // the provider/model page, Context Studio opens the studio itself.
      // Governed mode has no page here, so it is not shipped as a dead row.
      id: "features",
      label: t("analytics.settings.rail.features"),
      items: [
        {
          id: "ai-agents",
          type: "page",
          pageId: "model",
          // The running app's FEATURES group names this row "AI & agents" (the
          // shared page's own title is "Model"); the label is the source's.
          label: t("analytics.settings.rail.aiAgents"),
          icon: IconBrain,
        },
        {
          id: "context-studio",
          type: "link",
          label: t("analytics.shell.contextStudio"),
          href: "/context",
          icon: IconBolt,
        },
      ],
    },
    {
      id: "projects",
      label: t("analytics.settings.rail.projects"),
      items: [
        {
          id: "secrets",
          type: "page",
          pageId: "analytics-secrets",
          icon: IconLock,
        },
        {
          id: "integrations",
          type: "page",
          pageId: "integrations",
          icon: IconPlugConnected,
        },
        {
          id: "compute",
          type: "page",
          pageId: "analytics-compute",
          icon: IconCpu,
        },
      ],
    },
    {
      id: "access",
      label: t("analytics.settings.rail.access"),
      items: [
        {
          id: "users",
          type: "page",
          pageId: "analytics-users",
          icon: IconUsers,
        },
        {
          id: "groups",
          type: "page",
          pageId: "analytics-groups",
          icon: IconUsers,
        },
        {
          // The reference's ACCESS & SECURITY group lists SSO; core's SSO page
          // owns the allowed-email-domain control a member asks for (row 153).
          id: "sso",
          type: "page",
          pageId: "sso",
          icon: IconLock,
        },
      ],
    },
    {
      // PLAN & BILLING. Only Credits is backed here (the usage page); there is no Billing summary
      // page in this app.
      id: "plan",
      label: t("analytics.settings.rail.plan"),
      items: [
        {
          id: "credits",
          type: "page",
          pageId: "usage",
          // The running app's PLAN & BILLING group names this row "Credits".
          label: t("analytics.settings.rail.credits"),
          icon: IconChartBar,
        },
      ],
    },
  ];
}
