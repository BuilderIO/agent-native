import fs from "node:fs";
import path from "node:path";

const STARTER_SCREENS = {
  home: { show: { route: "/home" } },
  chat: { show: { route: "/chat" } },
  thread: {
    show: {
      route: "/chat/:threadId",
      params: {
        type: "object",
        properties: { threadId: { type: "string", minLength: 1 } },
        required: ["threadId"],
      },
    },
  },
  database: { show: { route: "/database" } },
  extensions: { show: { route: "/extensions" } },
  observability: { show: { route: "/observability" } },
  agent: { show: { route: "/settings/agent" } },
  settings: { show: { route: "/settings" } },
};

export function wireChatStarterContract(
  appDir: string,
  appId: string,
  displayName: string,
): void {
  const rootPath = path.join(appDir, "app", "root.tsx");
  if (
    !fs.existsSync(rootPath) ||
    fs.existsSync(path.join(appDir, "app.manifest.ts"))
  ) {
    return;
  }

  const root = fs.readFileSync(rootPath, "utf8");
  const syncOptions =
    /(useNavigationState\(\);\s*)(useDbSync\(\{\s*queryClient: qc,\s*ignoreSource: TAB_ID,)/;
  if (!syncOptions.test(root)) {
    throw new Error(
      "The chat starter is missing its shared database sync hook.",
    );
  }

  const manifest = {
    id: appId,
    displayName,
    aliases: [],
    routing: {
      domainSummary: `${displayName} workspace for chat threads and agent-assisted work`,
      canonicalIntents: ["open home", "start a chat", "open a chat thread"],
      entityNouns: ["chat thread"],
      negativeDisambiguators: [],
    },
    screens: { defaultLandingScreen: "home", definitions: STARTER_SCREENS },
    entities: { thread: { show: "thread" } },
    suggestableCapabilities: [],
    guide:
      "Open saved threads by ID. Leave the current view in place for background work.",
  };
  fs.writeFileSync(
    path.join(appDir, "app.manifest.ts"),
    `export default {
  ...${JSON.stringify(manifest, null, 2)},
  viewPolicy: { background: "keep", query: "reveal", create: "reveal", navigate: "open" } as const,
};
`,
  );
  const actionsDir = path.join(appDir, "actions");
  fs.writeFileSync(path.join(actionsDir, "view-screen.ts"), VIEW_SCREEN);
  fs.writeFileSync(path.join(actionsDir, "navigate.ts"), NAVIGATE);
  const originalActionTests = ["view-screen.spec.ts", "navigate.spec.ts"];
  for (const name of originalActionTests) {
    fs.rmSync(path.join(actionsDir, name), { force: true });
  }

  fs.writeFileSync(
    rootPath,
    root.replace(
      syncOptions,
      `$1const { pathname } = useLocation();
  const isPrivateChatRoute = (path: string) => path === HOME_PATH || isChatPathname(path);
  $2
    realtime: isPrivateChatRoute(pathname)
      ? { reason: "Keep chat threads and navigation current across tabs." }
      : undefined,`,
    ),
  );
}

const VIEW_SCREEN = `import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";
import manifest from "../app.manifest.js";

export default defineAction({
  description: "Read the current tab's route, active thread, selection, and dirty editor context.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  mcpTool: "search",
  run: async () => {
    const [navigation, selection, editor] = await Promise.all([
      readAppStateForCurrentTab("navigation"),
      readAppStateForCurrentTab("selection"),
      readAppStateForCurrentTab("editor"),
    ]);
    const threadId = navigation?.threadId;
    const focusedEntity = typeof threadId === "string" ? { type: "thread", id: threadId } : null;
    const selectionIds = Array.isArray(selection?.ids)
      ? selection.ids.filter((id): id is string => typeof id === "string").slice(0, 50)
      : [];
    return {
      route: typeof navigation?.path === "string" ? navigation.path : "",
      view: typeof navigation?.view === "string" ? navigation.view : "unknown",
      title: manifest.displayName,
      activeFilters: {},
      selection: selectionIds,
      visibleItems: focusedEntity ? [focusedEntity] : [],
      ...(editor ? { liveDraft: { dirty: editor.dirty === true } } : {}),
      ...(typeof editor?.userEditedSince === "number" || typeof editor?.userEditedSince === "string"
        ? { userEditedSince: editor.userEditedSince }
        : {}),
      navigation,
    };
  },
});
`;

const NAVIGATE = `import { fail } from "@agent-native/core/action";
import { createNavigateAction } from "@agent-native/core/command-navigation";
import manifest from "../app.manifest.js";

const screens = manifest.screens.definitions;
const fixedRoutes = Object.values(screens)
  .map(({ show }) => show.route)
  .filter((route) => !route.includes(":"));

const navigate = createNavigateAction({
  description: 'Queue a declared app screen or an app-local route. Supply intent: "open" for an explicit request to show a destination. Read view-screen to confirm the destination.',
  normalize: ({ path, view, threadId }) => {
    const thread = typeof threadId === "string" ? threadId.trim() : "";
    let route = path;
    if (!route && (view === "thread" || view === "chat") && thread) {
      route = screens.thread.show.route.replace(":threadId", encodeURIComponent(thread));
    }
    if (!route && view && Object.hasOwn(screens, view) && view !== "thread") {
      route = screens[view as keyof typeof screens].show.route;
    }
    if (
      !route ||
      (!fixedRoutes.includes(route) &&
        route !== "/" &&
        !(/^\\/chat\\/(?!\\.{1,2}$)(?:[A-Za-z0-9_.!~*'()-]|%[A-Fa-f0-9]{2})+$/.test(route) &&
          new URL(route, "https://app.invalid").pathname === route))
    ) {
      fail("Choose a declared screen or an app-local chat thread route.", {
        errorCode: "invalid_navigation_target",
        statusCode: 400,
      });
    }
    return { path: route };
  },
  describeResult: ({ path }) => "Queued navigation to " + String(path) + ". Use view-screen to confirm it opened.",
});

export default { ...navigate, mcpTool: "search" as const };
`;
