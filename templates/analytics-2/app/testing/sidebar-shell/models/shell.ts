import type {
  AppShellSubPart,
  NavigationEntry,
  ShellModel,
  ShellRegion,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { useState } from "react";

import type { WorkspaceWriteError } from "../../../components/workspace/types";
import { resolveRoute } from "../../../routes/routing/registry";
import { railModel, type RailFixture } from "./rails";
import {
  useWorkspaceModel,
  workspaceFixtures,
  type WorkspaceFixture,
} from "./workspace";

function region(
  id: string,
  subPart: AppShellSubPart,
  owner: ShellRegion["content"] = { owner: "model", key: id },
): ShellRegion {
  return {
    id,
    part: "app-shell",
    subPart,
    containerId: "shell",
    order: 0,
    content: owner,
  };
}
function action(
  id: string,
  containerId: string,
  label: string,
  effectId: string,
): NavigationEntry {
  return {
    id,
    part: "app-shell",
    subPart: "app-shell.nav",
    containerId,
    order: 0,
    kind: "action",
    label,
    effect: { kind: "action", effectId },
  };
}
const main = () =>
  region("shell.main", "app-shell.main", {
    owner: "page",
    key: "current-route",
  });

export function railShellModel(fixture: RailFixture): ShellModel {
  const model = railModel(fixture);
  return {
    ...model,
    regions: [
      {
        ...main(),
        id:
          fixture.kind === "settings" ? "shell.settings.main" : "shell.context",
      },
      ...(fixture.kind === "settings"
        ? [
            {
              ...region("shell.settings.header", "app-shell.topbar"),
              actions: [
                {
                  ...action(
                    "shell.settings.back",
                    "settings-back",
                    "Settings",
                    "",
                  ),
                  kind: "destination" as const,
                  effect: { kind: "navigate" as const, to: "/home" },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export interface HomeShellFixture extends WorkspaceFixture {
  mobileMenu?: boolean;
  writeError?: WorkspaceWriteError;
  retry?: () => void;
}

export function useHomeShellModel(fixture: HomeShellFixture): ShellModel {
  const base = useWorkspaceModel(fixture);
  const [mobileOpened, setMobileOpened] = useState<Record<string, boolean>>({
    workspace: fixture.mobileMenu ?? false,
  });
  const [mobileSearch, setMobileSearch] = useState("");
  const [bannerVisible, setBannerVisible] = useState(true);
  const header = base.navigation.entries.find(
    (entry) => entry.containerId === "sidebar-header",
  );
  const workspace = header?.children?.find(
    (entry) => entry.containerId === "header-workspace",
  );
  if (!workspace) throw new Error("Missing workspace fixture source");
  function mobileEntry(entry: NavigationEntry): NavigationEntry {
    const effect = entry.effect;
    return {
      ...entry,
      ...(effect?.kind === "open"
        ? {
            effect: {
              ...effect,
              open: {
                value: mobileOpened[effect.surfaceId] ?? false,
                set(value: boolean) {
                  setMobileOpened((previous) => ({
                    ...previous,
                    [effect.surfaceId]: value,
                    ...(!value && effect.surfaceId === "workspace"
                      ? { preferences: false }
                      : {}),
                  }));
                },
              },
            },
          }
        : effect?.kind === "action" &&
            effect.effectId === "close-workspace-menu"
          ? {
              effect: { ...effect, effectId: "close-mobile-workspace-menu" },
            }
          : {}),
      ...(entry.search
        ? {
            search: {
              ...entry.search,
              binding: { value: mobileSearch, set: setMobileSearch },
            },
          }
        : {}),
      ...(entry.children ? { children: entry.children.map(mobileEntry) } : {}),
      ...(entry.trailingActions
        ? { trailingActions: entry.trailingActions.map(mobileEntry) }
        : {}),
    };
  }
  const mobileWorkspace = {
    ...mobileEntry(workspace),
    containerId: "mobile-workspace",
  };
  const error = fixture.writeError;
  return {
    ...base,
    regions: [
      main(),
      {
        ...region("shell.header.mobile", "app-shell.topbar"),
        actions: [
          {
            ...action("shell.nav.open", "mobile-opener", "", "open-drawer"),
            accessibleLabel: "Open navigation",
          },
          mobileWorkspace,
          {
            ...action(
              "shell.search.mobile",
              "mobile-search",
              "",
              "open-search",
            ),
            accessibleLabel: "Search",
            tooltip: "Search",
          },
        ],
      },
      {
        ...region("shell.nav.dismiss", "app-shell.aside"),
        visible:
          (fixture.width ?? 1280) <= 1050 &&
          base.navigation.presentation.mobileOpen.value,
        actions: [
          {
            ...action(
              "shell.nav.dismiss",
              "drawer-dismiss",
              "",
              "close-drawer",
            ),
            accessibleLabel: "Close navigation",
          },
        ],
      },
      ...(error
        ? [
            {
              ...region("shell.write-error", "app-shell.banner"),
              visible: bannerVisible,
              title: "Could not start thread: ",
              actions: [
                action(
                  "shell.write-error.retry",
                  "write-retry",
                  "Retry",
                  "failed-write",
                ),
                action(
                  "shell.write-error.dismiss",
                  "write-dismiss",
                  "Dismiss",
                  "dismiss-write-error",
                ),
              ],
            },
          ]
        : []),
    ],
    effects: [
      ...base.effects,
      {
        kind: "action",
        id: "open-drawer",
        actionName: "open-navigation",
        run: () => base.navigation.presentation.mobileOpen.set?.(true),
      },
      {
        kind: "action",
        id: "close-mobile-workspace-menu",
        actionName: "close-mobile-workspace-menu",
        run: () => setMobileOpened({ workspace: false, preferences: false }),
      },
      ...(error
        ? [
            {
              kind: "action" as const,
              id: "failed-write",
              actionName: error.action,
              error: error.message,
              run: () => fixture.retry?.(),
            },
            {
              kind: "action" as const,
              id: "dismiss-write-error",
              actionName: "dismiss-write-error",
              run: () => setBannerVisible(false),
            },
          ]
        : []),
    ],
  };
}

export const homeShellFixtures: HomeShellFixture[] = [
  ...workspaceFixtures,
  { name: "frame-home", path: "/home" },
  {
    name: "thread-write-error",
    path: "/home",
    writeError: {
      action: "create-thread",
      message: "Synthetic thread failure",
    },
  },
];

export const frameFixtures = [
  ...["home", "settings"].flatMap((kind) =>
    ["loading", "unavailable"].map((state) => ({
      name: `frame-${kind}-${state}`,
      path: kind === "home" ? "/home" : "/settings/profile",
      kind,
      state,
    })),
  ),
  ...[
    "/project/project-a/latest",
    "/explore/project-a",
    "/login",
    "/onboarding",
    "/bigquery-oauth-success",
    "/auth/space-a/azure",
    "/app-icon/space-a",
  ].map((path) => ({
    name: `frame-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`,
    path,
    kind: resolveRoute(path).frame,
    state: "ready",
  })),
];

export function frameModel(
  fixture: (typeof frameFixtures)[number],
  retry: () => void = () => {},
): ShellModel {
  const loading = fixture.state !== "ready";
  const empty = ["asset", "redirect", "server"].includes(fixture.kind);
  const title = fixture.kind === "settings" ? "Settings" : "Workspace";
  return {
    frame: {
      key: fixture.kind,
      routeRuleId: "resolved-route-frame",
    },
    navigation: {
      entries: [],
      sections: [],
      presentation: {
        collapsed: { value: false },
        mobileOpen: { value: false },
        peekOpen: false,
        profile: "none",
        themeFamily: "original",
        visibility: "hidden",
        width: 0,
      },
    },
    regions: loading
      ? [
          {
            ...region("shell.loading", "app-shell.skeleton"),
            ...(fixture.state === "loading"
              ? {}
              : { title: `${title} unavailable` }),
            state:
              fixture.state === "loading"
                ? {
                    status: "loading",
                    label: `Loading ${title.toLowerCase()}…`,
                  }
                : {
                    status: "error",
                    message: "Synthetic identity read failure",
                    reloadEffectId: "reload-shell",
                    retryLabel: "Retry",
                  },
          },
        ]
      : empty
        ? []
        : [main()],
    shortcuts: [],
    preferences: [],
    effects: [
      {
        kind: "action",
        id: "reload-shell",
        actionName: "get-workspace-shell",
        run: retry,
      },
    ],
  };
}
