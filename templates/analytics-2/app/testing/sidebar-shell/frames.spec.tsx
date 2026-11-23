// @vitest-environment happy-dom
import { act } from "react";
import { Routes, Route, useLocation, useOutletContext } from "react-router";
import { afterEach, assert, expect, it, vi } from "vitest";

import * as secondaryFeatures from "../../components/shell/secondary-features";
import messages from "../../i18n/en-US";
import "../../components/published/PublishedProjectPage";
import { shellProps, workspaceRows } from "./fixtures";
import {
  init,
  dispose,
  mount,
  capture,
  button,
  click,
  input,
  key,
  settle,
  route,
} from "./harness";

import settingsStyles from "../../components/workspace/settings.css?inline";
const m = vi.hoisted(() => ({
  data: undefined as ReturnType<typeof shellProps> | undefined,
  navigation: undefined as
    | {
        library: boolean;
        workspaces: NonNullable<
          ReturnType<typeof shellProps>["workspaceMenu"]
        >["workspaces"];
      }
    | undefined,
  pending: false,
  bootstrap: undefined as unknown,
  bootstrapError: null as Error | null,
  error: null as Error | null,
  refetch: vi.fn(),
  mutations: [] as string[],
  calls: [] as string[],
  failThread: false,
  showOwnerActions: false,
  failProject: false,
  queryOptions: [] as unknown[],
  missingPages: [] as string[],
  switchOrg: vi.fn(async (_id: string) => {}),
  toastError: vi.fn(),
  observedWorkspace: undefined as string | undefined,
  observedAdmin: undefined as boolean | undefined,
  observedAuthenticated: undefined as boolean | undefined,
  threadPageChunk: undefined as Promise<void> | undefined,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (name: string, _args: unknown, options: unknown) => {
    m.queryOptions.push(options);
    if (name === "get-workspace-bootstrap")
      return {
        data: m.bootstrap,
        isPending: !m.bootstrap && !m.bootstrapError,
        isError: !!m.bootstrapError,
        error: m.bootstrapError,
        refetch: m.refetch,
      };
    if (name === "get-workspace-navigation") return { data: m.navigation };
    if (
      name === "open-published-app-session" ||
      name === "get-published-app-session"
    )
      return {
        data: {
          projectId: "project-a",
          releaseId: "release-a",
          sessionId: "session-a",
          inputRevision: "0",
          projection: {
            project: {
              id: "project-a",
              title: "Synthetic page content",
              cells: [],
              appLayout: null,
            },
            outputs: {},
            runningCellIds: [],
            tabSlugs: [],
            canViewSource: false,
          },
          effectiveValues: {},
          inputChoices: {},
          overrides: {},
          baselineManifestId: null,
          defaultCacheGeneration: "0",
          refreshedAt: null,
          ageStatus: "fresh",
          sessionHref: "/app/project-a/latest",
          caps: { refreshDefault: false, saveView: false },
          cursor: "0",
          state: "ready",
          runId: null,
          staleAfter: { kind: "workspace-default" },
        },
        isPending: false,
        isError: false,
        error: null,
        refetch: m.refetch,
      };
    if (name === "list-projects") {
      const view = (_args as { view: string }).view;
      const { user, workspace } = shellProps();
      return {
        data: {
          viewer: { email: user.email, orgId: workspace.id },
          capabilities: [],
          projects: [
            {
              id: "lifecycle-project",
              title: `Fixture in ${view}`,
              ownerEmail: "person@example.test",
              description: "",
              language: "python",
              updatedAt: "2026-11-12T08:00:00.000Z",
              archivedAt:
                view === "archive" ? "2026-11-12T08:00:00.000Z" : null,
              trashedAt: view === "trash" ? "2026-11-12T08:00:00.000Z" : null,
            },
          ],
        },
        isPending: false,
        isError: false,
      };
    }
    if (name === "get-workspace-activity") {
      const scope = (options as { queryKeyScope: readonly unknown[] })
        .queryKeyScope;
      const data =
        m.data?.workspace.id === scope[0] && m.data?.user.email === scope[1]
          ? m.data
          : undefined;
      return { data, isPending: m.pending, isError: !!m.error };
    }
    return {
      data:
        name === "list-workspace-notifications"
          ? { items: [], unreadCount: 0 }
          : name === "get-project"
            ? {
                project: {
                  id: "project-a",
                  title: "Synthetic page content",
                  cells: [],
                },
              }
            : m.data,
      isPending: m.pending,
      isError: !!m.error,
      error: m.error,
      refetch: m.refetch,
    };
  },
  useActionMutation: (
    name: string,
    options: {
      onSuccess?: (result: unknown) => void;
      onError?: (error: Error) => void;
    },
  ) => ({
    isPending: false,
    mutate: () => {
      m.mutations.push(name);
      if (name === "create-thread" && m.failThread)
        options.onError?.(new Error("Synthetic thread failure"));
      else options.onSuccess?.({ created: false, href: "/home" });
    },
  }),
  callAction: async (name: string) => {
    m.calls.push(name);
    if (m.failProject) throw new Error("Synthetic project failure");
    return { id: "project-new", href: "/home", project: { id: "project-new" } };
  },
}));
vi.mock("sonner", () => ({ toast: { error: m.toastError } }));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: "space-a" },
    isPending: false,
    isError: false,
  }),
  useSwitchOrg: () => ({ mutateAsync: m.switchOrg }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({ queries }: { queries: unknown[] }) => {
    expect(queries).toEqual([]);
    return [];
  },
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [], isError: false, isPending: false }),
  useUpdateResource: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@agent-native/toolkit/app/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/toolkit/app/sharing")>()),
  ShareButton: () => <button type="button">Share</button>,
}));
vi.mock("../../components/search", () => ({
  WorkspaceSearch: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Workspace search" /> : null,
}));
vi.mock("../../components/search/useSearchFilterOptions", () => ({
  useSearchFilterOptions: () => ({}),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => {
    let v: unknown = messages;
    for (const part of key.split("."))
      v =
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[part]
          : undefined;
    return typeof v === "string" ? v : key;
  },
}));
vi.mock("../../components/workspace/pages", async (original) => {
  const real =
    await original<typeof import("../../components/workspace/pages")>();
  return {
    ...real,
    resolveRoutePage: (...args: Parameters<typeof real.resolveRoutePage>) =>
      m.missingPages.includes(args[0].view)
        ? undefined
        : real.resolveRoutePage(...args),
  };
});
vi.mock("../../components/workspace/ThreadPage", async () => {
  await m.threadPageChunk;
  return {
    ThreadPage: ({ route }: { route: { params: { threadId: string } } }) => (
      <article>{route.params.threadId}</article>
    ),
  };
});
vi.mock("../../components/workspace/HomePageView", () => ({
  HomePageView: () => null,
}));
import { ContextStudioPage } from "../../components/context/ContextStudioPage";
import { SettingsShell } from "../../components/workspace/SettingsShell";
import { WorkspaceApplication } from "../../components/workspace/WorkspaceApplication";
import { useWorkspaceData } from "../../components/workspace/WorkspaceDataContext";
import ApplicationRoute from "../../routes/$";
import type { RouteOutletContext } from "../../routes/routing/frames";
import { resolveRoute } from "../../routes/routing/registry";
import rows from "./rows.json";
const settingsRows = rows
  .filter(
    (r) =>
      r.id.startsWith("sidebar.settings") ||
      r.id.startsWith("settings.nav") ||
      r.id.startsWith("shell.settings"),
  )
  .map((r) => r.id);
const contextRows = rows
  .filter(
    (r) => r.id.startsWith("sidebar.context.") || r.id === "shell.context",
  )
  .map((r) => r.id);
function reset(options?: Parameters<typeof init>[0]) {
  init(options);
  const props = shellProps();
  m.data = props;
  m.navigation = { library: true, workspaces: props.workspaceMenu?.workspaces };
  m.pending = false;
  m.bootstrap = {
    ...props,
    features: { ...props.features, library: undefined, isAdmin: true },
  };
  m.bootstrapError = null;
  m.error = null;
  m.failThread = false;
  m.showOwnerActions = false;
  m.failProject = false;
  m.calls = [];
  m.mutations = [];
  m.queryOptions = [];
  m.missingPages = [];
  m.refetch.mockClear();
}
function Probe() {
  const context = useOutletContext<RouteOutletContext>();
  const workspace = useWorkspaceData();
  m.observedWorkspace = workspace?.shell.workspace.id;
  m.observedAdmin = context.routing?.isAdmin;
  m.observedAuthenticated = context.routing?.authenticated;
  const location = useLocation();
  const route = resolveRoute(
    location.pathname + location.search + location.hash,
    context.routing,
  );
  return context.renderFrame?.(
    route,
    route.view === "archive" || route.view === "trash" ? (
      context.renderPage?.(route)
    ) : (
      <div data-domain-content="">
        Synthetic page content
        {m.showOwnerActions && (
          <button type="button" onClick={() => workspace?.onCreateThread()}>
            Create thread through owner
          </button>
        )}
      </div>
    ),
  );
}
function App() {
  return (
    <Routes>
      <Route element={<WorkspaceApplication />}>
        <Route path="*" element={<Probe />} />
      </Route>
    </Routes>
  );
}
afterEach(dispose);
it("keeps Home and More usable while workspace activity loads or fails", async () => {
  reset();
  m.pending = true;
  m.data = undefined;
  const navigation = m.navigation;
  m.navigation = undefined;
  const app = await mount(<App />, "/home");
  expect(document.querySelector(".ws-sidebar")).not.toBeNull();
  expect(document.body.textContent).not.toContain("Recent project");
  expect(document.querySelector('button[aria-label="More"]')).toBeNull();

  m.navigation = navigation;
  await app.update(<App />);
  await click(button("More"));
  expect(document.querySelector('a[href="/home/library"]')).not.toBeNull();

  m.data = shellProps();
  m.pending = false;
  await app.update(<App />);
  expect(document.body.textContent).toContain("Recent project");

  m.data = undefined;
  m.error = new Error("Activity unavailable");
  await app.update(<App />);
  expect(document.querySelector(".ws-sidebar")).not.toBeNull();
  expect(document.body.textContent).toContain("Synthetic page content");

  m.bootstrapError = new Error("Access denied");
  await app.update(<App />);
  expect(document.querySelector(".ws-sidebar")).toBeNull();
  expect(document.body.textContent).toContain("Access denied");
});
it.each(["/home/archive", "/home/trash"])(
  "renders the list action result on %s while workspace activity loads",
  async (path) => {
    reset();
    m.pending = true;
    m.data = undefined;
    await import("../../components/projects");
    await mount(<App />, path);
    await vi.waitFor(() =>
      expect(document.querySelector("main")?.textContent).toContain(
        `Fixture in ${path.endsWith("archive") ? "archive" : "trash"}`,
      ),
    );
  },
);
it("report M5-T2-F-04 and 455-456: opens personal settings while workspace permissions load", async () => {
  reset();
  m.bootstrap = undefined;
  const app = await mount(<App />, "/settings/preferences");
  expect(
    document.querySelector('button[aria-label="Search settings"]'),
  ).not.toBeNull();
  expect(document.querySelector("[data-domain-content]")).not.toBeNull();
  expect(document.body.textContent).not.toContain("Organization");
  m.pending = false;
  m.bootstrapError = new Error("Access denied");
  await app.update(<App />);
  expect(document.body.textContent).toContain("Access denied");
  expect(document.querySelector("[data-domain-content]")).toBeNull();
});
it("report M5-T2-F-04: keeps permission-dependent settings hidden while access loads", async () => {
  reset();
  m.bootstrap = undefined;
  await mount(<App />, "/settings/organization");
  expect(
    document.querySelector('button[aria-label="Search settings"]'),
  ).not.toBeNull();
  expect(document.querySelector("[data-domain-content]")).toBeNull();
  expect(document.body.textContent).toContain("Loading settings");
});
it.each(["workspace", "user"])(
  "does not render cached activity belonging to a different %s",
  async (kind) => {
    reset();
    const old = shellProps();
    const bootstrap = {
      ...old,
      features: { ...old.features, isAdmin: false },
      ...(kind === "workspace"
        ? { workspace: { ...old.workspace, id: "new-space" } }
        : { user: { ...old.user, id: "new-user", email: "new@example.test" } }),
    };
    m.bootstrap = bootstrap;
    await mount(<App />, "/home/data");
    expect(m.observedWorkspace).toBe(bootstrap.workspace.id);
    expect(m.observedAdmin).toBe(false);
    expect(m.observedAuthenticated).toBe(true);
    expect(document.body.textContent).not.toContain("Recent project");
    expect(m.mutations).not.toContain("ensure-sample-workspace");
  },
);
it("removes authorized context when bootstrap is denied even with cached details", async () => {
  reset();
  m.bootstrapError = new Error("Access denied");
  await mount(<App />, "/home/data");
  expect(m.observedWorkspace).toBeUndefined();
  expect(m.observedAuthenticated).toBeUndefined();
  expect(m.observedAdmin).toBeUndefined();
});
it("report 1794899464.159559 switches to a selected workspace", async () => {
  reset();
  m.switchOrg.mockClear();
  await mount(<App />, "/home");
  await click(
    button(
      "Test workspace",
      document.querySelector(".ws-sidebar") as HTMLElement,
    ),
  );
  const other =
    document.querySelectorAll<HTMLButtonElement>(".ws-workspace-row")[1];
  if (!other) throw new Error("Missing second workspace");
  expect(other.disabled).toBe(false);
  await click(other);
  expect(m.switchOrg).toHaveBeenCalledWith("space-b");
});
it("report 1794899464.159559 opens Projects from the sidebar", async () => {
  reset();
  await mount(<App />, "/home");
  const projects = document.querySelector<HTMLAnchorElement>(
    '.ws-sidebar a[href="/home/all"]',
  );
  if (!projects) throw new Error("Missing Projects link");
  await click(projects);
  expect(route).toBe("/home/all");
});
it("report 1794899464.159559 keeps the current page when switching fails", async () => {
  reset();
  m.switchOrg.mockRejectedValueOnce(new Error("Workspace unavailable"));
  m.toastError.mockClear();
  await mount(<App />, "/home/all");
  await click(
    button(
      "Test workspace",
      document.querySelector(".ws-sidebar") as HTMLElement,
    ),
  );
  const other =
    document.querySelectorAll<HTMLButtonElement>(".ws-workspace-row")[1];
  if (!other) throw new Error("Missing second workspace");
  await click(other);
  expect(route).toBe("/home/all");
  expect(m.toastError).toHaveBeenCalledWith("Workspace unavailable");
});
// oracle-change(templates/analytics-2/app/components/shell/WorkspaceShell.modk-in-field.spec.tsx): editable-field shortcut coverage moved here with the application-level listener.
it.each(["input", "textarea", "select", "contenteditable"])(
  "opens application search from %s while slash remains editable",
  async (tag) => {
    reset();
    await mount(<App />, "/home");
    const field = document.createElement(
      tag === "contenteditable" ? "div" : tag,
    );
    if (tag === "contenteditable")
      field.setAttribute("contenteditable", "true");
    document.body.append(field);
    const slash = await key(field, "/");
    expect(slash.defaultPrevented).toBe(false);
    expect(
      document.querySelector('[aria-label="Workspace search"]'),
    ).toBeNull();
    const chord = await key(
      field,
      "k",
      tag === "contenteditable" ? { ctrlKey: true } : { metaKey: true },
    );
    expect(chord.defaultPrevented).toBe(true);
    expect(
      document.querySelector('[aria-label="Workspace search"]'),
    ).not.toBeNull();
    field.remove();
  },
);
it.each([
  ["k", { metaKey: true }],
  ["K", { ctrlKey: true }],
  ["/", {}],
] as const)(
  "opens application search for shortcut %s",
  async (shortcut, options) => {
    reset();
    await mount(<App />, "/home");
    const event = await key(window, shortcut, options);
    expect(event.defaultPrevented).toBe(true);
    expect(
      document.querySelector('[aria-label="Workspace search"]'),
    ).not.toBeNull();
  },
);
it("leaves an already handled application search chord alone", async () => {
  reset();
  await mount(<App />, "/home");
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  event.preventDefault();
  await act(async () => window.dispatchEvent(event));
  expect(document.querySelector('[aria-label="Workspace search"]')).toBeNull();
});
it("ignores repeated search chords", async () => {
  reset();
  await mount(<App />, "/home");
  const event = await key(window, "k", { metaKey: true, repeat: true });
  expect(event.defaultPrevented).toBe(false);
  expect(document.querySelector('[aria-label="Workspace search"]')).toBeNull();
});
it("ignores modified slash and unrelated application shortcuts", async () => {
  reset();
  await mount(<App />, "/home");
  for (const [shortcut, options] of [
    ["/", { altKey: true }],
    ["/", { metaKey: true }],
    ["/", { ctrlKey: true }],
    ["[", {}],
    ["\\", { metaKey: true }],
  ] as const) {
    const event = await key(window, shortcut, options);
    expect(event.defaultPrevented).toBe(false);
    expect(
      document.querySelector('[aria-label="Workspace search"]'),
    ).toBeNull();
  }
});
it.each(["/home", "/project/project-a/latest"])(
  "opens workspace search from an editable field on %s with mod-k",
  async (path) => {
    reset();
    await mount(<App />, path);
    const field = document.createElement("input");
    document.body.append(field);
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(
      document.querySelector('[aria-label="Workspace search"]'),
    ).not.toBeNull();
    field.remove();
  },
);
it("opens Settings search from an editable field on Settings with mod-k", async () => {
  reset();
  await mount(<App />, "/settings/profile");
  const field = document.createElement("input");
  document.body.append(field);
  await key(field, "k", { metaKey: true });
  expect(document.querySelector('[aria-label="Workspace search"]')).toBeNull();
  expect(
    document.querySelector('[role="dialog"][aria-labelledby]')?.textContent,
  ).toContain("Search settings");
  field.remove();
});
it("leaves slash in editable fields and editing views, and opens search from Home", async () => {
  reset();
  const app = await mount(<App />, "/home");
  const field = document.createElement("input");
  document.body.append(field);
  await key(field, "/");
  expect(document.querySelector('[aria-label="Workspace search"]')).toBeNull();
  await key(window, "/");
  expect(
    document.querySelector('[aria-label="Workspace search"]'),
  ).not.toBeNull();
  field.remove();
  await app.update(null);
  reset();
  await mount(<App />, "/project/project-a/latest");
  await key(window, "/");
  expect(document.querySelector('[aria-label="Workspace search"]')).toBeNull();
});
it.each(["/home", "/settings/profile"])(
  "captures query loading/unavailable/ready %s and Retry",
  async (path) => {
    reset();
    m.pending = true;
    m.bootstrap = undefined;
    const app = await mount(<App />, path);
    capture(
      `frame-${path.includes("settings") ? "settings" : "home"}-loading`,
      ["shell.frame", "shell.loading"],
      { path, query: "pending" },
    );
    expect(document.querySelector(".ws-sidebar")).toBeNull();
    m.pending = false;
    m.data = undefined;
    m.bootstrapError = new Error("Synthetic identity read failure");
    await app.update(<App />);
    capture(
      `frame-${path.includes("settings") ? "settings" : "home"}-unavailable`,
      ["shell.frame", "shell.loading"],
      { path, query: "error" },
    );
    await click(button("Retry"));
    expect(m.refetch).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "/home",
  "/settings/profile",
  "/context-studio/overview",
  "/project/project-a/latest",
  "/explore/project-a",
  "/app/project-a/latest",
  "/login",
  "/onboarding",
  "/bigquery-oauth-success",
  "/auth/space-a/azure",
  "/app-icon/space-a",
])("freezes route-frame %s without sidebar leaks", async (path) => {
  reset();
  const uuid = vi
    .spyOn(crypto, "randomUUID")
    .mockReturnValue("11111111-1111-4111-8111-111111111111");
  try {
    const route = resolveRoute(path);
    await mount(<App />, path);
    if (route.frame === "published-app") {
      await settle();
      expect(
        document.querySelector("[data-published-app='true'] h1")?.textContent,
      ).toBe("Synthetic page content");
    }
    capture(
      `frame-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`,
      [
        "shell.frame",
        ...(path === "/home" ? workspaceRows : []),
        ...(route.frame === "settings"
          ? settingsRows.filter((r) => r !== "sidebar.settings.access-security")
          : []),
        ...(route.frame === "context-studio" ? contextRows : []),
      ],
      {
        path,
        frame: route.frame,
        query: "ready",
        content:
          route.frame === "published-app"
            ? "published project fixture"
            : "domain sentinel",
      },
    );
    if (route.frame !== "home")
      expect(document.querySelector(".ws-sidebar")).toBeNull();
    if (
      ["authentication", "onboarding", "link", "callback"].includes(route.frame)
    )
      expect(m.queryOptions).toContainEqual(
        expect.objectContaining({ enabled: false }),
      );
    if (["server", "asset", "redirect"].includes(route.frame))
      expect(document.body.querySelector("[data-domain-content]")).toBeNull();
  } finally {
    uuid.mockRestore();
  }
});
it.each([false, true])(
  "captures settings role and every active destination admin=%s",
  async (admin) => {
    reset();
    for (const tab of [
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
    ]) {
      const app = await mount(
        <SettingsShell activeTab={tab} canManageWorkspace={admin}>
          <div data-domain-content="" />
        </SettingsShell>,
        `/settings/${tab}`,
      );
      const present = settingsRows.filter(
        (id) =>
          id === "sidebar.settings" ||
          id === "shell.settings.header" ||
          id === "shell.settings.main" ||
          id === "sidebar.settings.account" ||
          (admin && id !== "sidebar.settings.access-security"),
      );
      capture(`settings-${admin ? "admin" : "member"}-${tab}`, present, {
        host: "SettingsShell",
        admin,
        activeTab: tab,
        pageRegistration: "real",
      });
      await app.update(null);
    }
  },
);
it("filters empty settings groups using page registration", async () => {
  reset();
  m.missingPages = [
    "users",
    "groups",
    "directory-sync",
    "sso",
    "general",
    "organization",
    "asset-statuses",
    "asset-categories",
    "data-sources",
    "styling",
    "agent",
    "trusted-mode",
    "context-studio",
    "audit-logs",
    "project-security",
  ];
  await mount(
    <SettingsShell activeTab="profile" canManageWorkspace>
      <div />
    </SettingsShell>,
    "/settings/profile",
  );
  capture(
    "settings-filtered-groups",
    [
      "sidebar.settings",
      "sidebar.settings.account",
      "sidebar.settings.projects",
      "shell.settings.header",
      "shell.settings.main",
    ],
    { host: "SettingsShell", missingPages: m.missingPages },
  );
  expect(document.querySelectorAll(".settings-nav-title").length).toBe(2);
  expect(
    [...document.querySelectorAll(".settings-nav-title")].map(
      (title) => title.textContent,
    ),
  ).toEqual(["Account", "Projects"]);
});

it("keeps Settings content below its navigation and Home reachable on a phone", async () => {
  reset({ width: 390 });
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport(viewport: { width: number }): void };
  };
  happyDOM.setViewport({ width: 390 });
  const style = document.createElement("style");
  style.textContent = settingsStyles;
  document.head.append(style);
  try {
    const { host } = await mount(
      <SettingsShell activeTab="profile" canManageWorkspace={false}>
        <div />
      </SettingsShell>,
      "/settings/profile",
    );
    const split = host.querySelector(".settings-split");
    const nav = host.querySelector(".settings-nav");
    const back = host.querySelector<HTMLAnchorElement>(
      '.settings-topbar a[href="/home"]',
    );
    assert(split && nav && back);
    const scroll = host.querySelector(".settings-scroll");
    assert(scroll);
    expect(getComputedStyle(split).flexDirection).toBe("column");
    expect(getComputedStyle(nav).width).toBe("100%");
    expect(getComputedStyle(nav).borderRightWidth).toBe("0px");
    expect(getComputedStyle(scroll).minWidth).toBe("0");
    expect(getComputedStyle(scroll).paddingLeft).toBe("16px");
    expect(getComputedStyle(scroll).overflow).toBe("visible");
    await click(back);
    expect(route).toBe("/home");
  } finally {
    style.remove();
    happyDOM.setViewport({ width: 1280 });
  }
});

it("opens Context Studio with a collapsed phone rail and a route back Home", async () => {
  reset({ width: 390 });
  const path = "/context-studio/setup";
  const { host } = await mount(
    <ContextStudioPage route={resolveRoute(path)} />,
    path,
  );
  const nav = host.querySelector(".context-area-rail");
  const toggle = nav?.querySelector<HTMLButtonElement>("button[aria-expanded]");
  const home = nav?.querySelector<HTMLAnchorElement>('a[href="/home"]');
  assert(nav && toggle && home);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  const connections = nav.querySelector<HTMLAnchorElement>(
    'a[href="/context-studio/connections"]',
  );
  assert(connections);
  expect(connections.closest("[hidden]")).not.toBeNull();
  await click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(connections.closest("[hidden]")).toBeNull();
  await click(connections);
  expect(route).toBe("/context-studio/connections");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await click(home);
  expect(route).toBe("/home");
});
it.each([
  "overview",
  "suggestions",
  "evals",
  "endorsements",
  "guides",
  "models",
  "repositories",
  "knowledge",
  "apps",
])("captures context %s and nested active state", async (view) => {
  reset();
  const path = `/context-studio/${view}`;
  const route = resolveRoute(path);
  const app = await mount(<ContextStudioPage route={route} />, path);
  capture(`context-${view}`, contextRows, {
    view,
    path,
    viewFallback: ["knowledge", "apps"].includes(view) ? "guides" : view,
  });
  expect(
    [...document.querySelectorAll(".context-rail-link")].map((link) =>
      link.getAttribute("href"),
    ),
  ).toEqual([
    "/context-studio/setup",
    "/context-studio/connections",
    "/home/data",
    "/settings/trusted-mode",
    "/settings",
  ]);
  for (const href of ["/context-studio/setup", "/home/data", "/settings"]) {
    const link = document.querySelector<HTMLAnchorElement>(
      `.context-area-rail a.context-rail-link[href="${href}"]`,
    );
    expect(link).not.toBeNull();
    expect(link?.textContent?.trim()).toBeTruthy();
    expect(link?.getAttribute("aria-disabled")).not.toBe("true");
    expect(link?.tabIndex).toBe(0);
  }
  expect(
    document.querySelector('.context-rail-link[href="/context-studio/apps"]'),
  ).toBeNull();
  await app.update(null);
});
it("captures context nested path with independent selected view", async () => {
  reset();
  await mount(
    <ContextStudioPage
      route={resolveRoute("/context-studio/models/model-a/view")}
    />,
    "/context-studio/models/model-a/view",
  );
  expect(
    document
      .querySelector(".context-studio-title + p.context-studio-description")
      ?.textContent?.trim(),
  ).toBeTruthy();
  capture("context-nested-models", contextRows, {
    path: "/context-studio/models/model-a/view",
  });
  expect(document.querySelector('[aria-current="page"]')).toBeNull();
  expect(document.querySelector('a[href="/context-studio/models"]')).toBeNull();
});
it("records owner write failure Retry/Dismiss, provisional project recovery and import through the real host", async () => {
  reset();
  const uuid = vi
    .spyOn(crypto, "randomUUID")
    .mockReturnValue("11111111-1111-4111-8111-111111111111");
  try {
    m.showOwnerActions = true;
    await mount(<App />);
    m.failThread = true;
    await click(button("Create thread through owner"));
    capture("thread-write-error", [...workspaceRows, "shell.write-error"], {
      action: "create-thread",
      result: "error",
    });
    expect(m.mutations.filter((n) => n === "create-thread")).toHaveLength(1);
    await click(button("Retry"));
    expect(m.mutations.filter((n) => n === "create-thread")).toHaveLength(2);
    await click(button("Dismiss"));
    expect(document.querySelector("[data-workspace-write-error]")).toBeNull();
    m.failProject = true;
    await click(button("Project"));
    capture("project-create-failed", ["shell.frame"], {
      phase: "createFailed",
      reconciliation: "failed",
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      messages.notebookCreation.createFailed,
    );
    expect(m.calls).toEqual(["create-project", "get-project-creation"]);
    await click(button("Retry"));
    expect(m.calls).toEqual([
      "create-project",
      "get-project-creation",
      "get-project-creation",
    ]);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      messages.notebookCreation.createFailed,
    );
    await click(button("Back to projects"));
    expect(route).toBe("/home/all");
    await click(button("Create new"));
    await click(button("Upload project"));
    capture("import-project-empty", ["shell.create.import-project"], {
      file: null,
      pending: false,
    });
    expect(button("Import").disabled).toBe(true);
  } finally {
    uuid.mockRestore();
  }
});
it("captures the admin access group and member visible controls explicitly", async () => {
  reset();
  const app = await mount(
    <SettingsShell activeTab="sso" canManageWorkspace>
      <div />
    </SettingsShell>,
    "/settings/sso",
  );
  capture("settings-admin-access-group", settingsRows, {
    host: "SettingsShell",
    admin: true,
    activeTab: "sso",
  });
  expect(document.body.textContent).toContain("Access & Security");
  await app.update(
    <SettingsShell activeTab="skills" canManageWorkspace={false}>
      <div />
    </SettingsShell>,
  );
  capture("settings-member-visible", settingsRows, {
    host: "SettingsShell",
    admin: false,
    activeTab: "skills",
  });
  const access = [...document.querySelectorAll(".settings-nav-group")].find(
    (group) => group.querySelector("h2")?.textContent === "Access & Security",
  );
  assert(access);
  expect(
    [...access.querySelectorAll("a")].map((link) => link.getAttribute("href")),
  ).toEqual(["/settings/users", "/settings/groups"]);
});
it("captures Context Connections through the real lazy destination", async () => {
  reset();
  const route = resolveRoute("/context-studio/connections");
  await mount(
    <ContextStudioPage route={route} />,
    "/context-studio/connections",
    () =>
      capture("context-connections-first-render", contextRows, {
        view: "connections",
        phase: "ready",
        lazy: true,
      }),
  );
  await settle();
  capture("context-connections-settled", contextRows, {
    view: "connections",
    phase: "settled",
    lazy: true,
  });
  expect(
    document.querySelector('[aria-current="page"]')?.getAttribute("href"),
  ).toBe("/context-studio/connections");
});
it("keeps the context entry absent when its registered setup page is unavailable", async () => {
  reset();
  m.missingPages = ["setup"];
  await mount(<App />);
  capture("context-page-unavailable", [...workspaceRows], {
    contextFeature: true,
    manager: true,
    setupPageRegistered: false,
  });
  expect(document.querySelector('a[href="/context-studio/setup"]')).toBeNull();
});

it("keeps workspace navigation available while a direct thread route loads", async () => {
  reset();
  m.pending = true;
  m.data = undefined;
  let releaseChunk = () => {};
  m.threadPageChunk = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  try {
    const app = await mount(
      <Routes>
        <Route element={<WorkspaceApplication />}>
          <Route path="*" element={<ApplicationRoute />} />
        </Route>
      </Routes>,
      "/thread/thread-1",
    );
    const home = app.host.querySelector<HTMLAnchorElement>(
      'aside[aria-label="Workspace"] a[href="/home"]',
    );
    assert(home, "Workspace Home link missing");
    expect(app.host.querySelector("main [aria-busy=true]")).not.toBeNull();
    expect(app.host.textContent).not.toContain("Loading…");

    await act(async () => {
      releaseChunk();
      await import("../../components/workspace/ThreadPage");
    });
    expect(app.host.querySelector("main article")?.textContent).toBe(
      "thread-1",
    );
    await click(home);
    expect(route).toBe("/home");
    expect(app.host.contains(home)).toBe(true);
  } finally {
    releaseChunk();
  }
});

it("opens application search from the notebook with Cmd+K", async () => {
  reset();
  await mount(<App />, "/project/project-a/latest");
  const shortcut = await key(window, "k", { metaKey: true });
  expect(shortcut.defaultPrevented).toBe(true);
  expect(
    document.querySelector('[aria-label="Workspace search"]'),
  ).not.toBeNull();
});

it.each(["/home", "/project/project-a/latest"])(
  "row 816 opens and executes the command palette on %s",
  async (path) => {
    reset();
    m.bootstrap = {
      ...(m.bootstrap as object),
      capabilities: [{ controlId: "create-project", status: "allowed" }],
    };
    await mount(<App />, path);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    const event = await key(window, "p", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Command palette");
    const projects = [
      ...dialog!.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((entry) => entry.textContent === "Go to: Projects");
    assert(projects);
    await click(projects);
    expect(route).toBe("/home/all");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    field.remove();
  },
);

it.each(["/home", "/project/project-a/latest"])(
  "row 816 opens collection creation globally on %s",
  async (path) => {
    reset();
    m.bootstrap = {
      ...(m.bootstrap as object),
      capabilities: [{ controlId: "create-project", status: "allowed" }],
    };
    await mount(<App />, path);
    const event = await key(window, "L", {
      altKey: true,
      shiftKey: true,
      code: "KeyL",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(route).toBe("/home/collections?dialog=create-collection");
  },
);

it.each(["/home", "/project/project-a/latest"])(
  "row 420 (KEYS-08) opens Upload project dialog globally on %s",
  async (path) => {
    reset();
    m.bootstrap = {
      ...(m.bootstrap as object),
      capabilities: [{ controlId: "create-project", status: "allowed" }],
    };
    await mount(<App />, path);
    const event = await key(window, "U", {
      altKey: true,
      shiftKey: true,
      code: "KeyU",
    });
    expect(event.defaultPrevented).toBe(true);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Upload project");
    expect(dialog?.textContent).toContain("Import");
  },
);

it("row 816 opens new component creation and leaves modified search chords alone", async () => {
  reset();
  m.bootstrap = {
    ...(m.bootstrap as object),
    capabilities: [{ controlId: "create-project", status: "allowed" }],
  };
  await mount(<App />, "/home");
  for (const options of [
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, altKey: true },
  ]) {
    const event = await key(window, "k", options);
    expect(event.defaultPrevented).toBe(false);
    expect(
      document.querySelector('[aria-label="Workspace search"]'),
    ).toBeNull();
  }
  const gate = vi
    .spyOn(secondaryFeatures, "secondaryFeaturesEnabled")
    .mockReturnValue(true);
  const event = await key(window, "C", {
    altKey: true,
    shiftKey: true,
    code: "KeyC",
  });
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "New component",
  );
  gate.mockRestore();
});

it("row 816 keeps quick creation behind permissions and the component feature gate", async () => {
  reset();
  m.bootstrap = { ...(m.bootstrap as object), capabilities: [] };
  await mount(<App />, "/home");
  for (const letter of ["n", "c", "l", "u"]) {
    const event = await key(window, letter, { altKey: true, shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(m.calls).toEqual([]);
});

it("row 816 preserves typing and prevents stacking command dialogs", async () => {
  reset();
  m.bootstrap = {
    ...(m.bootstrap as object),
    capabilities: [{ controlId: "create-project", status: "allowed" }],
  };
  await mount(<App />, "/home");
  const field = document.createElement("input");
  document.body.append(field);
  for (const [letter, modifiers] of [
    ["p", { ctrlKey: true }],
    ["l", { altKey: true, shiftKey: true }],
  ] as const) {
    const event = await key(field, letter, modifiers);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }
  await key(window, "p", { ctrlKey: true });
  const dialogs = document.querySelectorAll('[role="dialog"]');
  expect(dialogs).toHaveLength(1);
  await key(window, "l", { altKey: true, shiftKey: true });
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(route).toBe("/home");
  field.remove();
});
