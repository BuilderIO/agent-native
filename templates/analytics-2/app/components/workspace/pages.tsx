import type { ComponentType } from "react";

import type { ResolvedRoute } from "@/routes/routing/registry";

import { lazyRoute } from "./lazy-route";
import { loadHomeComposer, loadNotebookCell } from "./route-critical-code";
import { ThreadPageSkeleton } from "./ThreadPageSkeleton";
import type { RoutePageProps } from "./types";
import type { RoutePageEntry, RoutePageRegistry } from "./types";

/**
 * Route page registry.
 *
 * Keys are resolved route ids, or `${id}:${view}` when one route id covers
 * several source views. A route with no entry renders nothing; unimplemented
 * surfaces are not replaced with stand-in screens.
 *
 * Pages are loaded on demand so one route's screens do not sit in the active
 * client graph of every other route. The shell renders each entry inside a
 * Suspense boundary.
 */
const TasksPage = lazyRoute(() =>
  import("@/components/tasks/TasksPage").then((module) => ({
    default: module.TasksPage,
  })),
);
const ThreadsPage = lazyRoute(() =>
  import("@/components/threads/ThreadsPage").then((module) => ({
    default: module.ThreadsPage,
  })),
);
const ComponentsPage = lazyRoute(() =>
  import("@/components/components-page/ComponentsPage").then((module) => ({
    default: module.ComponentsPage,
  })),
);
export const preloadHomePage = () => {
  void loadHomeComposer().catch(() => {});
  return import("./HomePageView").then((module) => ({
    default: module.HomePageView,
  }));
};
const HomePage = lazyRoute(preloadHomePage);
const LibraryPage = lazyRoute(() =>
  import("./LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
const ProjectsPage = lazyRoute(() =>
  import("@/components/projects").then((module) => ({
    default: module.ProjectsPage,
  })),
);
const DataPage = lazyRoute(() =>
  import("./DataPage").then((module) => ({ default: module.DataPage })),
);
const DataConnectionsPage = lazyRoute(() =>
  import("./DataConnectionsPage").then((module) => ({
    default: module.DataConnectionsPage,
  })),
);
const NotebookPage = lazyRoute(() => {
  void loadNotebookCell().catch(() => {});
  return import("./NotebookPage").then((module) => ({
    default: module.NotebookPage,
  }));
});
const PublishedProjectPage = lazyRoute(() =>
  import("@/components/published/PublishedProjectPage").then((module) => ({
    default: module.PublishedProjectPage,
  })),
);
// Collections: the sidebar and Home both link here, and the route ids resolved to
// an empty frame. The index and a collection's own page read the same action.
// Context Studio lives under More and renders its own Observability/Management
// rail. The page exists but no registry entry pointed at it, so the route drew an
// empty frame and the More entry stayed hidden (row 122).
const ContextStudioPage = lazyRoute(() =>
  import("@/components/context/ContextStudioPage").then((module) => ({
    default: module.ContextStudioPage,
  })),
);
const CollectionsPage = lazyRoute(() =>
  import("@/components/collections/CollectionsPage").then((module) => ({
    default: module.CollectionsPage,
  })),
);
const ThreadPage = lazyRoute(() =>
  import("./ThreadPage").then((module) => ({ default: module.ThreadPage })),
);
// The settings rail lists Notifications and Connected apps, so both views need a
// page: without an entry the rail renders a label that leads to nothing.
// Preferences is the rail's own account-preferences view; the older in-tree page
// cannot load here (its ui imports are gone), so this one composes the settings
// kit's Preferences group.
const ProfilePage = lazyRoute(() =>
  import("@/components/settings/AnalyticsProfilePage").then((module) => ({
    default: module.AnalyticsProfilePage,
  })),
);
const PreferencesPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsAccountPreferences").then(
    (module) => ({
      default: module.AnalyticsAccountPreferencesPage,
    }),
  ),
);
// Workspace -> General is the workspace name screen; the rail lists it and
// nothing rendered it until now (same defect class as the account views).
const AssetLabelsSettingsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsAssetLabelsSettings").then(
    (module) => ({
      default: module.AnalyticsAssetLabelsSettings,
    }),
  ),
);
// The shared surfaces below declare their own optional props (an edit label, a
// settings path, a focus key) and take no route props, so they register through
// this adapter: the registry renders every page with route props, and a page
// that ignores them needs no change to satisfy that contract.
const lazyBarePage = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a surface with
  // its own optional props; the adapter does not pass them and the page defaults.
  loader: () => Promise<{ default: ComponentType<any> }>,
) =>
  lazyRoute(async () => {
    const { default: Page } = await loader();
    return { default: (_props: RoutePageProps) => <Page /> };
  });

const WorkspaceGeneralPage = lazyBarePage(() =>
  import("@/components/settings/AnalyticsPreferencesPage").then((module) => ({
    default: module.AnalyticsPreferencesPage,
  })),
);
const NotificationsPage = lazyRoute(() =>
  import("@/components/settings/SettingsShellBridgedPages").then((module) => ({
    default: module.NotificationsSettingsPage,
  })),
);
const ConnectedAppsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsConnectedAppsPage").then((module) => ({
    default: module.AnalyticsConnectedAppsPage,
  })),
);
const IntegrationsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsIntegrationsPage").then((module) => ({
    default: module.AnalyticsIntegrationsPage,
  })),
);

// The Access & Security rail lists Users, Groups, Directory sync and SSO. Those
// pages already exist in the shared org surface (member details with group and
// role, bulk invites, allowed email domain, SSO and SCIM), so the rail points at
// them instead of at nothing.
// Settings → Users: the members surface plus the invite link an admin can share.
const UsersSettingsPage = lazyRoute(() =>
  import("@/components/settings/SettingsShellBridgedPages").then((module) => ({
    default: module.UsersSettingsPage,
  })),
);
const GroupsSettingsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsWorkspaceSettings").then((module) => ({
    default: module.AnalyticsGroupsPage,
  })),
);
const ComputeSettingsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsWorkspaceSettings").then((module) => ({
    default: module.AnalyticsComputePage,
  })),
);
// The shared org pages read the settings-shell context (route, navigate, header),
// because their home is the toolkit shell. Mounted raw in this app's own rail they
// throw "useSettingsShell must be used inside the Settings shell", which testers saw
// as "Something went wrong" on those tabs; the bridge supplies the context from this
// app's router.
const AuthenticationSettingsPage = lazyRoute(() =>
  import("@/components/settings/SettingsShellBridgedPages").then((module) => ({
    default: module.AuthenticationSettingsPage,
  })),
);

const ApiKeysSettingsPage = lazyRoute(() =>
  import("@/components/settings/SettingsShellBridgedPages").then((module) => ({
    default: module.ApiKeysSettingsPage,
  })),
);
const AuditLogsSettingsPage = lazyBarePage(
  () => import("@agent-native/toolkit/app/settings/shell/pages/audit"),
);
const AgentSettingsPage = lazyBarePage(() =>
  import("@/components/settings/AnalyticsAgentSettingsPage").then((module) => ({
    default: module.AnalyticsAgentSettingsPage,
  })),
);
const SecretsSettingsPage = lazyBarePage(() =>
  import("@/components/settings/AnalyticsSecretsPage").then((module) => ({
    default: module.AnalyticsSecretsPage,
  })),
);
const GitIntegrationsSettingsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsGitAndSharingPages").then(
    (module) => ({ default: module.AnalyticsGitIntegrationsPage }),
  ),
);
const SharingSettingsPage = lazyRoute(() =>
  import("@/components/settings/AnalyticsGitAndSharingPages").then(
    (module) => ({ default: module.AnalyticsSharingSettingsPage }),
  ),
);
const SkillsSettingsPage = lazyRoute(() =>
  import("@/components/settings/SettingsShellBridgedPages").then((module) => ({
    default: module.SkillsSettingsPage,
  })),
);
const OrganizationSettingsPage = lazyRoute(() =>
  import("@/components/settings/SettingsShellBridgedPages").then((module) => ({
    default: module.OrganizationSettingsPage,
  })),
);

export const routePages: RoutePageRegistry = {
  "home:home": { component: HomePage },
  "home:all": { component: ProjectsPage },
  "home:library": { component: LibraryPage },
  // Archive is the same project list over its archived view; without this the
  // sidebar's Archive link resolved to the Home id with no page (blank frame).
  "home:archive": { component: ProjectsPage },
  "data-browser": { component: DataPage },
  // Home's Data tab is the data browser surface; it rendered an empty frame
  // while only the /data-browser route id resolved.
  "home:data": { component: DataPage },
  "home:threads": { component: ThreadsPage },
  // The More menu links here; with no page registered it opened a blank frame.
  "home:components": { component: ComponentsPage },
  // The sidebar's Tasks row is gated on a registered home/tasks page; without it
  // the surface the tester opened (/home/tasks) drew Home (row 221).
  "home:tasks": { component: TasksPage },
  // Collections: the sidebar and Home both link here, and both route ids drew an
  // empty frame until the page was registered (row 119).
  "home:new-collection": { component: CollectionsPage },
  "new-collection": { component: CollectionsPage },
  collection: { component: CollectionsPage },
  // The sidebar's Trash link has a route (id trash) but no page, so it opened an
  // empty frame; the same project list renders the action's trash view.
  trash: { component: ProjectsPage },
  "settings:data-sources": { component: DataConnectionsPage },
  "settings:general": { component: WorkspaceGeneralPage },
  "settings:asset-statuses": { component: AssetLabelsSettingsPage },
  "settings:asset-categories": { component: AssetLabelsSettingsPage },
  "settings:profile": { component: ProfilePage },
  "settings:preferences": { component: PreferencesPage },
  "settings:notifications": { component: NotificationsPage },
  "settings:connected-apps": { component: ConnectedAppsPage },
  "settings:integrations": { component: IntegrationsPage },
  "settings:users": { component: UsersSettingsPage },
  "settings:groups": { component: GroupsSettingsPage },
  "settings:compute": { component: ComputeSettingsPage },
  "settings:directory-sync": { component: AuthenticationSettingsPage },
  "settings:sso": { component: AuthenticationSettingsPage },
  "settings:audit-logs": { component: AuditLogsSettingsPage },
  "settings:api-keys": { component: ApiKeysSettingsPage },
  "settings:agent": { component: AgentSettingsPage },
  "settings:git-integrations": { component: GitIntegrationsSettingsPage },
  "settings:sharing": { component: SharingSettingsPage },
  "settings:secrets": { component: SecretsSettingsPage },
  "settings:organization": { component: OrganizationSettingsPage },
  "settings:skills": { component: SkillsSettingsPage },
  "project-base:logic": { component: NotebookPage },
  "project-base:agent": { component: NotebookPage },
  "project-base:app": { component: NotebookPage },
  logic: { component: NotebookPage },
  ui: { component: NotebookPage },
  "split-screen": { component: NotebookPage },
  debug: { component: NotebookPage },
  app: { component: PublishedProjectPage },
  "app-latest:app": { component: PublishedProjectPage },
  "app-base:app-base": { component: PublishedProjectPage },
  "context-studio": { component: ContextStudioPage },
  thread: { component: ThreadPage, fallback: <ThreadPageSkeleton /> },
};

const ADMIN_SETTINGS_VIEWS = new Set([
  "general",
  "agent",
  "magic",
  "trusted-mode",
  "organization",
  "styling",
  "data-sources",
  "secrets",
  "git-integrations",
  "sharing",
  "integrations",
  "environment",
  "scheduled-runs",
  "directory-sync",
  "audit-logs",
  "sso",
  "project-security",
  "data-retention",
  "asset-statuses",
  "asset-categories",
]);

export function settingsPageView(
  view: string,
  access?: { isAdmin: boolean },
): string {
  return access?.isAdmin === false && ADMIN_SETTINGS_VIEWS.has(view)
    ? "preferences"
    : view;
}

export function resolveRoutePage(
  route: ResolvedRoute,
  access?: { isAdmin: boolean },
): RoutePageEntry | undefined {
  const view =
    route.id === "settings" ? settingsPageView(route.view, access) : route.view;
  return routePages[`${route.id}:${view}`] ?? routePages[route.id];
}

/**
 * Whether a route has a page at all. Navigation uses this so a rail entry
 * never advertises a view that resolves to an empty frame.
 */
export function hasRoutePage(id: string, view: string): boolean {
  return (
    routePages[`${id}:${view}`] !== undefined || routePages[id] !== undefined
  );
}
