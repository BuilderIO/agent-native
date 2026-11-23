import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import type { WorkspaceShellProps } from "../../components/shell/types";
export function shellProps(
  overrides: Partial<WorkspaceShellProps> = {},
): WorkspaceShellProps {
  return {
    children: null,
    workspace: { id: "space-a", name: "Test workspace" },
    user: { id: "person-a", name: "Test Person", email: "person@example.test" },
    capabilities: [
      capabilityDecisionSchema.parse({
        controlId: ANALYTICS_CONTROL_IDS.dataBrowse,
        scope: { kind: "workspace", workspaceId: "space-a" },
        status: "allowed",
        target: { kind: "route", routeId: "data-browser" },
      }),
      capabilityDecisionSchema.parse({
        controlId: ANALYTICS_CONTROL_IDS.createProject,
        scope: { kind: "workspace", workspaceId: "space-a" },
        status: "allowed",
        target: { kind: "action", actionName: "create-project" },
      }),
    ],
    features: {
      contextStudio: true,
      isManagerOrAbove: true,
      folders: true,
      threads: true,
      tasks: true,
      library: true,
      developerTools: true,
      canCreateProject: true,
      canCreateThread: true,
    },
    recents: [
      {
        id: "project-a",
        title: "Recent project",
        kind: "project",
        href: "/project/project-a/latest",
      },
      {
        id: "thread-a",
        title: "Recent thread",
        kind: "thread",
        href: "/threads/thread-a",
      },
      {
        id: "collection-a",
        title: "Recent collection",
        kind: "collection",
        href: "/home/collections/collection-a",
      },
      {
        id: "data-a",
        title: "Recent data",
        kind: "data",
        href: "/home/data/data-a",
      },
    ],
    favorites: [
      {
        id: "project-b",
        title: "Favorite project",
        kind: "project",
        href: "/project/project-b/latest",
      },
      {
        id: "collection-b",
        title: "Favorite collection",
        kind: "collection",
        href: "/home/collections/collection-b",
      },
      {
        id: "data-b",
        title: "Favorite data",
        kind: "data",
        href: "/home/data/data-b",
      },
    ],
    onCreateProject: () => {},
    onCreateThread: () => {},
    onOpenSearch: () => {},
    quickCreate: { onImportProject: () => {} },
    workspaceMenu: {
      workspaces: [
        {
          id: "space-a",
          name: "Test workspace",
          memberCount: 1,
          role: "Owner",
        },
        {
          id: "space-b",
          name: "Second workspace",
          memberCount: 2,
          role: "Member",
        },
        {
          id: "space-c",
          name: "Login workspace",
          needsLogin: true,
          ssoEnforced: true,
        },
        { id: "space-d", name: "Fourth workspace" },
      ],
    },
    ...overrides,
  };
}
export const workspaceRows = [
  "shell.nav",
  "sidebar.header",
  "sidebar.workspace.open",
  "sidebar.notifications.open",
  "sidebar.create.project",
  "sidebar.create.thread",
  "sidebar.create.open",
  "sidebar.nav.search",
  "sidebar.nav.home",
  "sidebar.nav.data",
  "sidebar.nav.folders",
  "sidebar.nav.drafts",
  "sidebar.nav.projects",
  "sidebar.nav.collections",
  "sidebar.nav.threads",
  "sidebar.nav.tasks",
  "sidebar.nav.archive",
  "sidebar.nav.trash",
  "sidebar.nav.context",
  "sidebar.more.open",
  "sidebar.recents",
  "sidebar.recents.item",
  "sidebar.favorite-projects",
  "sidebar.favorite-projects.item",
  "sidebar.favorite-collections",
  "sidebar.favorite-collections.item",
  "sidebar.favorite-data",
  "sidebar.favorite-data.item",
  "sidebar.footer",
  "sidebar.account.open",
  "sidebar.nav.settings",
  "shell.main",
  "shell.shortcuts",
];
export const workspaceMenuRows = [
  "sidebar.workspace.preferences",
  "sidebar.workspace.switch.item",
  "sidebar.workspace.search",
  "sidebar.workspace.add",
  "sidebar.workspace.log-out",
  "sidebar.workspace.log-out-all",
];
export const themeRows = [
  "sidebar.theme.system",
  "sidebar.theme.light",
  "sidebar.theme.dark",
];
export const accountRows = [
  "sidebar.account.theme",
  "sidebar.account.help",
  "sidebar.account.documentation",
  "sidebar.account.changelog",
  "sidebar.account.service-status",
  "sidebar.account.email-support",
  "sidebar.account.copy-debug-info",
];
export const notificationRows = [
  "sidebar.notifications.empty",
  "sidebar.notifications.filter",
  "sidebar.notifications.mark-all-read",
];
export const moreRows = [
  "sidebar.more.components",
  "sidebar.more.library",
  "sidebar.more.explorations",
  "sidebar.more.agent-dev-tools",
];
