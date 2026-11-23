import { matchRoutes } from "react-router";

export type FrameKind =
  | "home"
  | "settings"
  | "project"
  | "published-app"
  | "context-studio"
  | "insights"
  | "code-project"
  | "code-app"
  | "model"
  | "explore"
  | "onboarding"
  | "authentication"
  | "link"
  | "platform-admin"
  | "callback"
  | "developer"
  | "asset"
  | "workspace"
  | "server";

export interface RouteIdentity {
  id: string;
  path: string | null;
  frame: FrameKind;
  view: string;
  transport: "client" | "server";
}

export const routeCatalog: readonly RouteIdentity[] = [
  {
    id: "admin-platform",
    path: "/admin-platform/:orgId?",
    frame: "platform-admin",
    view: "admin-platform",
    transport: "client",
  },
  {
    id: "agent-dev-tools",
    path: "/home/agent-dev-tools/:tab?",
    frame: "home",
    view: "agent-dev-tools",
    transport: "client",
  },
  {
    id: "app",
    path: "/app/:projectLocator/:version/:appSessionId?",
    frame: "published-app",
    view: "app",
    transport: "client",
  },
  {
    id: "app-base",
    path: "/app/:projectLocator",
    frame: "published-app",
    view: "app-base",
    transport: "client",
  },
  {
    id: "app-icon",
    path: "/app-icon/:orgId",
    frame: "asset",
    view: "app-icon",
    transport: "client",
  },
  {
    id: "app-latest",
    path: "/app/:projectLocator/latest/:appSessionId?",
    frame: "published-app",
    view: "app",
    transport: "client",
  },
  {
    id: "azure-auth",
    path: "/auth/:orgId/azure",
    frame: "server",
    view: "azure-auth",
    transport: "server",
  },
  {
    id: "azure-signup",
    path: "/auth/azure/signup",
    frame: "server",
    view: "azure-signup",
    transport: "server",
  },
  {
    id: "bigquery-oauth-success",
    path: "/bigquery-oauth-success",
    frame: "callback",
    view: "bigquery",
    transport: "client",
  },
  {
    id: "checkout",
    path: "/checkout",
    frame: "settings",
    view: "checkout",
    transport: "client",
  },
  {
    id: "cli-authorize",
    path: "/cli/authorize",
    frame: "callback",
    view: "cli-authorize",
    transport: "client",
  },
  {
    id: "collection",
    path: "/collection/:collectionId/:collectionName?",
    frame: "home",
    view: "collections",
    transport: "client",
  },
  {
    id: "component",
    path: "/component/:projectLocator/:version",
    frame: "project",
    view: "component",
    transport: "client",
  },
  {
    id: "component-base",
    path: "/component/:projectLocator/:version?/:view?/:appSessionId?",
    frame: "project",
    view: "component",
    transport: "client",
  },
  {
    id: "context-studio",
    path: "/context-studio/:tabView?",
    frame: "context-studio",
    view: "setup",
    transport: "client",
  },
  {
    id: "context-studio-evals",
    path: "/context-studio/evals/:suiteRunId?",
    frame: "context-studio",
    view: "evals",
    transport: "client",
  },
  {
    id: "context-studio-evals-compare",
    path: "/context-studio/evals/compare",
    frame: "context-studio",
    view: "evals-compare",
    transport: "client",
  },
  {
    id: "context-studio-eval-runs",
    path: "/context-studio/evals/runs/:suiteRunId?",
    frame: "context-studio",
    view: "eval-runs",
    transport: "client",
  },
  {
    id: "context-studio-eval-suite",
    path: "/context-studio/evals/suites/:suitePublicId",
    frame: "context-studio",
    view: "eval-suite",
    transport: "client",
  },
  {
    id: "context-studio-models",
    path: "/context-studio/models/:semanticProjectId?/:modelView?",
    frame: "context-studio",
    view: "models",
    transport: "client",
  },
  {
    id: "context-studio-suggestions",
    path: "/context-studio/suggestions/:issueId?/:issueTabId?",
    frame: "context-studio",
    view: "suggestions",
    transport: "client",
  },
  {
    id: "context-workbench",
    path: "/context-studio/workbench",
    frame: "context-studio",
    view: "workbench",
    transport: "client",
  },
  {
    id: "create-user",
    path: "/createUser",
    frame: "authentication",
    view: "create-user",
    transport: "client",
  },
  {
    id: "databricks-oauth-success",
    path: "/databricks-oauth-success",
    frame: "callback",
    view: "databricks",
    transport: "client",
  },
  {
    id: "data-browser",
    path: "/home/data/:tab?/:detailViewType?/:dataSourceId?/:semanticResourceName?",
    frame: "home",
    view: "data",
    transport: "client",
  },
  {
    id: "debug",
    path: "/project/:projectLocator/:version/debug/:appSessionId?",
    frame: "project",
    view: "debug",
    transport: "client",
  },
  {
    id: "dev-agent-chat-thread",
    path: "/dev/agent-chat-thread/:threadId",
    frame: "developer",
    view: "dev-agent-chat-thread",
    transport: "client",
  },
  {
    id: "drafts",
    path: "/home/drafts",
    frame: "home",
    view: "drafts",
    transport: "client",
  },
  {
    id: "email-redirected",
    path: "/app/redirected",
    frame: "link",
    view: "email-redirected",
    transport: "client",
  },
  {
    id: "embed-app-test-page",
    path: "/app/embedded-test-page",
    frame: "developer",
    view: "embed-app-test-page",
    transport: "client",
  },
  {
    id: "explore",
    path: "/explore/:projectLocator/:sessionStateIdOrExploreId?",
    frame: "explore",
    view: "explore",
    transport: "client",
  },
  {
    id: "explore-error",
    path: "/explore-error",
    frame: "explore",
    view: "explore-error",
    transport: "client",
  },
  {
    id: "explore-new",
    path: "/explore-new/:projectLocator/:exploreId",
    frame: "explore",
    view: "explore-new",
    transport: "client",
  },
  {
    id: "favicon",
    path: "/favicon/:orgId",
    frame: "asset",
    view: "favicon",
    transport: "client",
  },
  {
    id: "folders",
    path: "/home/folders/:folderId?",
    frame: "home",
    view: "folders",
    transport: "client",
  },
  {
    id: "github-package-connect-success",
    path: "/github-connect-success",
    frame: "callback",
    view: "github-package-connect-success",
    transport: "client",
  },
  {
    id: "github-package-install-landing",
    path: "/github-install-landing",
    frame: "callback",
    view: "github-package-install-landing",
    transport: "client",
  },
  {
    id: "github-server-package-connect-success",
    path: "/connections/code/github-server/package-import/connect-success",
    frame: "callback",
    view: "github-server-package-connect-success",
    transport: "client",
  },
  {
    id: "github-server-package-install-landing",
    path: "/connections/code/github-server/package-import/install-landing",
    frame: "callback",
    view: "github-server-package-install-landing",
    transport: "client",
  },
  {
    id: "github-server-sync-connect-success",
    path: "/connections/code/github-server/export/connect-success",
    frame: "callback",
    view: "github-server-sync-connect-success",
    transport: "client",
  },
  {
    id: "github-server-sync-install-landing",
    path: "/connections/code/github-server/export/install-landing",
    frame: "callback",
    view: "github-server-sync-install-landing",
    transport: "client",
  },
  {
    id: "github-sync-connect-success",
    path: "/githubsync-connect-success",
    frame: "callback",
    view: "github-sync-connect-success",
    transport: "client",
  },
  {
    id: "github-sync-install-landing",
    path: "/githubsync-install-landing",
    frame: "callback",
    view: "github-sync-install-landing",
    transport: "client",
  },
  {
    id: "gitlab-package-install-landing",
    path: "/connections/code/gitlab/package-import/install-landing",
    frame: "callback",
    view: "gitlab-package-install-landing",
    transport: "client",
  },
  {
    id: "gitlab-server-package-install-landing",
    path: "/connections/code/gitlab-server/package-import/install-landing",
    frame: "callback",
    view: "gitlab-server-package-install-landing",
    transport: "client",
  },
  {
    id: "gitlab-sync-install-landing",
    path: "/gitlabsync-install-landing",
    frame: "callback",
    view: "gitlab-sync-install-landing",
    transport: "client",
  },
  {
    id: "google-auth",
    path: "/auth/:orgId/google",
    frame: "server",
    view: "google-auth",
    transport: "server",
  },
  {
    id: "google-drive-oauth-complete",
    path: "/google-drive-oauth-complete",
    frame: "callback",
    view: "google-drive-oauth-complete",
    transport: "client",
  },
  {
    id: "google-signup",
    path: "/auth/google/signup",
    frame: "server",
    view: "google-signup",
    transport: "server",
  },
  {
    id: "insights",
    path: "/insights",
    frame: "insights",
    view: "insights",
    transport: "client",
  },
  {
    id: "insights-clusters",
    path: "/insights/clusters/:clusterId?",
    frame: "insights",
    view: "insights-clusters",
    transport: "client",
  },
  {
    id: "insights-findings",
    path: "/insights/findings/:findingId?",
    frame: "insights",
    view: "insights-findings",
    transport: "client",
  },
  {
    id: "project-base",
    path: "/project/:projectLocator/:version?/:view?/:appSessionId?",
    frame: "project",
    view: "logic",
    transport: "client",
  },
  {
    id: "home",
    path: "/home/:subView?/:tabView?",
    frame: "home",
    view: "home",
    transport: "client",
  },
  {
    id: "link-invalid",
    path: "/link",
    frame: "link",
    view: "link-invalid",
    transport: "client",
  },
  {
    id: "link-logged-in",
    path: "/link/:key/logged-in",
    frame: "link",
    view: "link-logged-in",
    transport: "client",
  },
  {
    id: "link-wrong-user",
    path: "/link/:key/wrong-user",
    frame: "link",
    view: "link-wrong-user",
    transport: "client",
  },
  {
    id: "logic",
    path: "/project/:projectLocator/:version/logic/:appSessionId?",
    frame: "project",
    view: "logic",
    transport: "client",
  },
  {
    id: "login",
    path: "/login",
    frame: "authentication",
    view: "login",
    transport: "client",
  },
  {
    id: "login-success",
    path: "/login-success",
    frame: "authentication",
    view: "login-success",
    transport: "client",
  },
  {
    id: "logout",
    path: "/logout/:orgId",
    frame: "server",
    view: "logout",
    transport: "server",
  },
  {
    id: "agent-auth-callback",
    path: "/auth/agent/callback",
    frame: "authentication",
    view: "agent-auth-callback",
    transport: "client",
  },
  {
    id: "agent-link-sent",
    path: "/sent",
    frame: "authentication",
    view: "agent-link-sent",
    transport: "client",
  },
  {
    id: "mcp-app-test-harness",
    path: "/app/mcp-test-harness",
    frame: "developer",
    view: "mcp-app-test-harness",
    transport: "client",
  },
  {
    id: "mcp-server-oauth-result",
    path: "/mcp-server-oauth-result",
    frame: "callback",
    view: "mcp-server-oauth-result",
    transport: "client",
  },
  {
    id: "new-collection",
    path: "/home/collections",
    frame: "home",
    view: "new-collection",
    transport: "client",
  },
  {
    id: "new-project",
    path: "/new-project",
    frame: "project",
    view: "new-project",
    transport: "client",
  },
  {
    id: "new-thread",
    path: "/new-thread",
    frame: "project",
    view: "new-thread",
    transport: "client",
  },
  {
    id: "notion-unfurl-authorize",
    path: "/notion-unfurl/authorize",
    frame: "callback",
    view: "notion-unfurl-authorize",
    transport: "client",
  },
  {
    id: "onboarding",
    path: "/onboarding",
    frame: "onboarding",
    view: "onboarding",
    transport: "client",
  },
  {
    id: "org",
    path: "/:orgId",
    frame: "workspace",
    view: "org",
    transport: "client",
  },
  {
    id: "org-selector",
    path: "/org-selector",
    frame: "authentication",
    view: "org-selector",
    transport: "client",
  },
  {
    id: "prompt-onboarding-experience",
    path: "/onboarding/prompt",
    frame: "onboarding",
    view: "prompt-onboarding-experience",
    transport: "client",
  },
  {
    id: "screenshot",
    path: "/screenshot/:projectLocator/:version/:appSessionId",
    frame: "published-app",
    view: "screenshot",
    transport: "client",
  },
  {
    id: "semantic-project-workbench",
    path: "/model-workbench/:semanticProjectId/:semanticProjectVersionId/:tab",
    frame: "model",
    view: "semantic-project-workbench",
    transport: "client",
  },
  {
    id: "semantic-project-workbench-base",
    path: "/model-workbench/:semanticProjectId",
    frame: "model",
    view: "semantic-project-workbench-base",
    transport: "client",
  },
  {
    id: "settings",
    path: "/settings/:subView?/*",
    frame: "settings",
    view: "settings",
    transport: "client",
  },
  {
    id: "signup",
    path: "/signup/:promo?",
    frame: "authentication",
    view: "signup",
    transport: "client",
  },
  {
    id: "slack-install",
    path: "/slack-auth/install/:orgId",
    frame: "server",
    view: "slack-install",
    transport: "server",
  },
  {
    id: "slack-org-install",
    path: "/slack-auth/org-install/:orgId",
    frame: "server",
    view: "slack-org-install",
    transport: "server",
  },
  {
    id: "snowflake-oauth-success",
    path: "/snowflake-oauth-success",
    frame: "callback",
    view: "snowflake",
    transport: "client",
  },
  {
    id: "component-library",
    path: "/component-library/:subView?",
    frame: "authentication",
    view: "component-library",
    transport: "client",
  },
  {
    id: "split-screen",
    path: "/project/:projectLocator/:version/split/:appSessionId?",
    frame: "project",
    view: "split",
    transport: "client",
  },
  {
    id: "sso-auth",
    path: "/auth/:orgId/sso",
    frame: "server",
    view: "sso-auth",
    transport: "server",
  },
  {
    id: "sso-confirmation",
    path: "/sso/confirm",
    frame: "authentication",
    view: "sso-confirmation",
    transport: "client",
  },
  {
    id: "status",
    path: null,
    frame: "server",
    view: "status",
    transport: "server",
  },
  {
    id: "support-email",
    path: null,
    frame: "server",
    view: "support-email",
    transport: "server",
  },
  {
    id: "code-app",
    path: "/code-app/:projectId/:codeAppId",
    frame: "code-app",
    view: "code-app",
    transport: "client",
  },
  {
    id: "code-app-latest",
    path: "/code-app/:projectId/latest",
    frame: "code-app",
    view: "code-app-latest",
    transport: "client",
  },
  {
    id: "code-app-screenshot",
    path: "/code-app/:projectId/:codeAppId/screenshot",
    frame: "code-app",
    view: "code-app-screenshot",
    transport: "client",
  },
  {
    id: "code-project",
    path: "/code/:projectId",
    frame: "code-project",
    view: "code-project",
    transport: "client",
  },
  {
    id: "code-project-react-cell-screenshot",
    path: "/code/:projectId/refs/:projectRefId/screenshot/react-cell/:cellName",
    frame: "code-project",
    view: "code-project-react-cell-screenshot",
    transport: "client",
  },
  {
    id: "code-project-ref",
    path: "/code/:projectId/refs/:projectRefId",
    frame: "code-project",
    view: "code-project-ref",
    transport: "client",
  },
  {
    id: "code-project-screenshot",
    path: "/code/:projectId/refs/:projectRefId/screenshot",
    frame: "code-project",
    view: "code-project-screenshot",
    transport: "client",
  },
  {
    id: "thread",
    path: "/thread/:threadId?",
    frame: "home",
    view: "thread",
    transport: "client",
  },
  {
    id: "trash",
    path: "/home/trash/:folderId?",
    frame: "home",
    view: "trash",
    transport: "client",
  },
  {
    id: "ui",
    path: "/project/:projectLocator/:version/ui/:appSessionId?",
    frame: "project",
    view: "ui",
    transport: "client",
  },
  {
    id: "verify-org-domain",
    path: "/verify-org-domain",
    frame: "authentication",
    view: "verify-org-domain",
    transport: "client",
  },
  {
    id: "welcome",
    path: "/welcome",
    frame: "onboarding",
    view: "welcome",
    transport: "client",
  },
  {
    id: "workspace-picker",
    path: "/workspace-picker/:subView",
    frame: "authentication",
    view: "workspace-picker",
    transport: "client",
  },
];

const LANDING_FRAMES: ReadonlySet<string> = new Set([
  "authentication",
  "onboarding",
  "link",
]);

export interface RoutingContext {
  authenticated?: boolean;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  signupComplete?: boolean;
  foldersEnabled?: boolean;
  tasksEnabled?: boolean;
  insightsEnabled?: boolean;
  development?: boolean;
}

export interface ResolvedRoute {
  id: string;
  frame: FrameKind | "redirect";
  view: string;
  title: string;
  selectedTab?: string | undefined;
  params: Record<string, string | undefined>;
  query: URLSearchParams;
  hash: string;
  to?: string;
}

export function isUnavailableAnalyticsRoute(route: ResolvedRoute): boolean {
  if (route.frame === "explore" || route.view === "explorations") return true;
  if (route.frame === "context-studio") {
    return (
      route.id !== "context-studio" ||
      !["setup", "connections"].includes(route.view)
    );
  }
  if (route.id.startsWith("semantic-project-workbench")) return true;
  if (
    route.id === "data-browser" &&
    !["recommended", "all", "recently-used", "favorites"].includes(
      route.params.tab ?? "all",
    )
  )
    return true;
  return (
    route.frame === "settings" &&
    ["project-security", "scheduled-runs"].includes(route.view)
  );
}

export const homeSections: Record<
  string,
  { title: string; selectedTab: string }
> = {
  home: { title: "Home", selectedTab: "home" },
  data: { title: "Data browser", selectedTab: "data" },
  collections: { title: "Collections", selectedTab: "collections" },
  // The Collections page has its own route id; without this entry the home
  // frame reset it to the Home tab and the page resolved to nothing.
  "new-collection": { title: "Collections", selectedTab: "collections" },
  explorations: { title: "Explorations", selectedTab: "explorations" },
  components: { title: "Components", selectedTab: "components" },
  all: { title: "Projects", selectedTab: "all" },
  you: { title: "Projects", selectedTab: "all" },
  sharedWithYou: { title: "Projects", selectedTab: "all" },
  sharedWithOrg: { title: "Projects", selectedTab: "all" },
  library: { title: "Library", selectedTab: "library" },
  archive: { title: "Archived", selectedTab: "archive" },
  threads: { title: "Threads", selectedTab: "threads" },
  tasks: { title: "Tasks", selectedTab: "tasks" },
  folders: { title: "Folders", selectedTab: "folders" },
  drafts: { title: "Drafts", selectedTab: "drafts" },
  trash: { title: "Trash", selectedTab: "trash" },
  "agent-dev-tools": {
    title: "Agent Dev Tools",
    selectedTab: "agent-dev-tools",
  },
};

export const settingsSections: Record<string, string> = {
  skills: "Skills",
  profile: "Profile",
  preferences: "Preferences",
  notifications: "Notifications",
  "connected-apps": "Connected apps",
  "api-keys": "API keys",
  general: "General",
  compute: "Compute",
  agent: "AI & agents",
  "trusted-mode": "Trusted mode",
  organization: "Organization",
  "asset-statuses": "Asset statuses",
  "asset-categories": "Asset categories",
  styling: "Styling",
  "data-sources": "Data sources",
  secrets: "Secrets",
  "git-integrations": "Git integrations",
  sharing: "Sharing settings",
  integrations: "Integrations",
  environment: "Environment",
  "scheduled-runs": "Scheduled runs",
  users: "Users",
  groups: "Groups",
  "directory-sync": "Directory sync",
  "audit-logs": "Audit logs",
  sso: "SSO",
  "project-security": "Workspace security",
  "data-retention": "Data retention",
};

const candidates = routeCatalog
  .filter(
    (route): route is RouteIdentity & { path: string } => route.path !== null,
  )
  .map((route) => ({ path: route.path, handle: route }));

const HOME_SECTION_ALIAS_PATHS: Readonly<Record<string, string>> = {
  "/home/projects": "/home/all",
  "/home/archived": "/home/archive",
  "/home/recent": "/home",
  "/home/recents": "/home",
  "/home/recent-projects": "/home",
};

export function resolveRoute(
  input: string,
  context: RoutingContext = {},
): ResolvedRoute {
  const url = new URL(input, "http://routing.local");
  const query = url.searchParams;
  const suffix = url.search + url.hash;
  const result: ResolvedRoute = {
    id: "home",
    frame: "home",
    view: "home",
    title: "Home",
    selectedTab: "home",
    params: {},
    query,
    hash: url.hash,
  };
  const redirect = (to: string): ResolvedRoute => ({
    ...result,
    frame: "redirect",
    to,
  });
  const authentication = (): ResolvedRoute => ({
    ...result,
    id: "login",
    frame: "authentication",
    view: "login",
    title: "",
    selectedTab: undefined,
  });
  if (
    context.authenticated === false &&
    !["/login", "/login-success", "/sso/confirm"].includes(url.pathname)
  ) {
    return authentication();
  }
  if (
    context.isAdmin &&
    context.signupComplete === false &&
    !url.pathname.startsWith("/welcome") &&
    url.pathname !== "/onboarding/prompt"
  ) {
    return {
      ...result,
      id: "welcome",
      frame: "onboarding",
      view: "welcome",
      title: "",
      selectedTab: undefined,
    };
  }
  if (url.pathname === "/") return redirect("/home" + suffix);
  // The list surfaces moved under /home when the shell was rebuilt; a bookmark
  // or a shared link still asks for the old top-level path, and landing on Home
  // silently opens the wrong screen instead of the list it names.
  const LEGACY_LIST_PATHS: Record<string, string> = {
    "/projects": "/home/all",
    "/threads": "/home/threads",
    // The source's Tasks tab has always been reachable at /tasks; without this
    // the path fell through to Home.
    "/tasks": "/home/tasks",
    "/trash": "/home/trash",
    "/data": "/home/data",
    "/search": "/home/search",
  };
  const legacyList = LEGACY_LIST_PATHS[url.pathname];
  if (legacyList !== undefined) return redirect(legacyList + suffix);
  const homeAlias = HOME_SECTION_ALIAS_PATHS[url.pathname.replace(/\/+$/, "")];
  if (homeAlias !== undefined) return redirect(homeAlias + suffix);
  if (url.pathname === "/library") return redirect("/home/library" + suffix);
  if (url.pathname === "/new-thread") return redirect("/thread" + suffix);
  const savedThread = /^\/threads\/([^/]+)\/?$/.exec(url.pathname);
  if (savedThread) return redirect(`/thread/${savedThread[1]}` + suffix);
  if (url.pathname === "/admin/members")
    return redirect(context.isAdmin ? "/settings/users" + suffix : "/home");
  if (
    url.pathname === "/checkout" ||
    ["/settings/billing", "/settings/credits", "/settings/tiers"].includes(
      url.pathname,
    )
  ) {
    return redirect("/settings/general");
  }
  // An exact path wins over a parameterised pattern: /home/collections must
  // resolve to the Collections page even when a /home/:subView route also
  // matches, otherwise the page exists but the frame stays empty.
  const exact = candidates.find((candidate) => candidate.path === url.pathname);
  const match = matchRoutes(candidates, url.pathname)?.at(-1);
  if (!match && !exact) {
    return {
      ...result,
      id: "not-found",
      frame: "home",
      view: url.pathname,
      selectedTab: undefined,
      title: "Page not found",
    };
  }
  // `exact` can win without `match`, so read the params from whichever side
  // actually resolved instead of asserting `match` is present.
  const params = match?.params ?? {};
  const route = exact ? exact.handle : match!.route.handle;
  Object.assign(result, {
    id: route.id,
    frame: route.frame,
    view: route.view,
    selectedTab: undefined,
    params: exact ? {} : params,
    title: "",
  });
  if (
    (route.frame === "platform-admin" && !context.isPlatformAdmin) ||
    (route.frame === "insights" &&
      !(context.isPlatformAdmin && context.insightsEnabled)) ||
    (route.frame === "developer" && !context.development)
  ) {
    return redirect("/home");
  }
  if (
    LANDING_FRAMES.has(route.frame) &&
    context.authenticated !== false &&
    !(context.isAdmin && context.signupComplete === false)
  )
    return redirect("/home");
  if (route.id === "workspace") return redirect("/home");
  if (route.id === "org") return redirect("/home");
  if (route.id === "app-base")
    return redirect(
      `/app/${encodeURIComponent(params.projectLocator ?? "")}/latest${suffix}`,
    );
  if (route.id === "semantic-project-workbench-base")
    return redirect(
      `/model-workbench/${encodeURIComponent(params.semanticProjectId ?? "")}/draft/datasets${suffix}`,
    );
  if (route.frame === "settings") {
    // Shared chat setup links use both the current and legacy provider page ids.
    const section = ["model", "keys"].includes(params.subView ?? "")
      ? "agent"
      : params.subView;
    const selected = section || "general";
    return {
      ...result,
      view: selected,
      selectedTab: selected,
      title: settingsSections[selected] ?? "Page not found",
    };
  }
  if (route.frame === "home") {
    let section = route.id === "home" ? (params.subView ?? "home") : route.view;
    if (
      route.id === "home" &&
      ((section === "tasks" && !context.tasksEnabled) ||
        (["folders", "drafts"].includes(section) && !context.foldersEnabled) ||
        (section === "agent-dev-tools" && !context.development) ||
        !Object.hasOwn(homeSections, section))
    )
      section = "home";
    const display = homeSections[section];
    if (display) return { ...result, view: display.selectedTab, ...display };
  }
  if (route.id === "context-studio")
    return {
      ...result,
      view: params.tabView ?? route.view,
    };
  if (route.id === "project-base")
    return { ...result, view: params.view ?? "logic" };
  if (route.id === "component-base")
    return { ...result, view: params.view ?? "component" };
  return result;
}
