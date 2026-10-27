import { afterEach, describe, expect, it, vi } from "vitest";

import {
  agentNativePath,
  appApiPath,
  appBasePath,
  appMountPath,
  appMountedPath,
  appPath,
  configureClientRouterBasename,
  isWorkspaceAppPath,
  WorkspaceAppMountResolutionError,
} from "./api-path.js";

const SETTINGS = "/settings";

describe("appMountPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("imports org hooks before workspace mount metadata is available", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings" },
    });
    vi.resetModules();
    vi.doMock("./use-action.js", () => ({
      useActionMutation: vi.fn(),
      useActionQuery: vi.fn(),
    }));

    try {
      await expect(import("./org/hooks.js")).resolves.toBeDefined();
    } finally {
      vi.doUnmock("./use-action.js");
    }
  });

  it("uses the projected current mount when the workspace manifest omits it", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppPath: "/dispatch" },
    });

    expect(appBasePath()).toBe("/dispatch");
    expect(appMountPath(SETTINGS)).toBe("/dispatch");
    expect(appMountedPath("/settings/general", SETTINGS)).toBe(
      "/dispatch/settings/general",
    );
  });

  it("restores an omitted live mount from explicit app mount config", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceAppId: "dispatch",
        workspaceAppPath: "/dispatch",
        workspaceAppMountPaths: ["/content"],
      },
    });

    expect(appBasePath()).toBe("/dispatch");
  });

  it("does not treat a root app route as an omitted workspace mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/settings/model" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppPath: "/" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          settings: { id: "settings", parentId: "root", path: "settings" },
          model: { id: "model", parentId: "settings", path: "model" },
        },
      },
    });

    expect(appBasePath()).toBe("");
  });

  it("uses the server-projected root mount for legacy workspace pages", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubGlobal("window", {
      location: { pathname: "/home" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceRuntime: true,
        workspaceAppPath: "/",
      },
    });

    expect(appBasePath()).toBe("");
    expect(agentNativePath("/_agent-native/auth/session")).toBe(
      "/_agent-native/auth/session",
    );
  });

  it("does not infer an unknown prefix before a valid route", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/unknown/home" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppId: "dispatch" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
    expect(() => appMountPath("/home")).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
    expect(() => agentNativePath("/_agent-native/auth/session")).toThrow(
      WorkspaceAppMountResolutionError,
    );
  });

  it("fails when a workspace mount has no positive path metadata", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubGlobal("window", {
      location: { pathname: "/nope" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          index: { id: "index", parentId: "root", index: true },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path without explicit mount metadata.",
    );
    expect(() => appMountPath("/")).toThrow(
      "Cannot resolve workspace app mount path without explicit mount metadata.",
    );
    expect(() => appBasePath()).toThrow(WorkspaceAppMountResolutionError);
    expect(() => appMountPath("/")).toThrow(WorkspaceAppMountResolutionError);
    expect(() => appMountedPath("/settings/account", "/")).toThrow(
      WorkspaceAppMountResolutionError,
    );
    expect(() => appPath("/settings/account")).toThrow(
      WorkspaceAppMountResolutionError,
    );
    expect(() => appApiPath("/health")).toThrow(
      WorkspaceAppMountResolutionError,
    );
    expect(() => agentNativePath("/_agent-native/auth/session")).toThrow(
      WorkspaceAppMountResolutionError,
    );
  });

  it("requires an explicit root mount when the workspace URL is at root", () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "clips", path: "/clips" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppId: "root-app" },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path without explicit mount metadata.",
    );
  });

  it("preserves the server router basename when mount metadata is unresolved", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const context = { basename: undefined as string | undefined };
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __reactRouterContext: context,
    });

    expect(configureClientRouterBasename()).toBe(false);
    expect(context.basename).toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });

  it("configures the router with an explicitly declared root mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    const context = { basename: "/stale" };
    vi.stubGlobal("window", {
      location: { pathname: "/settings/model" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppPath: "/" },
      __reactRouterContext: context,
    });

    expect(configureClientRouterBasename()).toBe(true);
    expect(context.basename).toBe("");
  });

  it("configures the router with the matching current app mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    const context = { basename: undefined as string | undefined };
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppPath: "/dispatch" },
      __reactRouterContext: context,
    });

    expect(configureClientRouterBasename()).toBe(true);
    expect(context.basename).toBe("/dispatch");
  });

  it("fails when projected sibling mounts do not include the current app", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppId: "dispatch" },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
    expect(() => appPath("/settings/account")).toThrow(
      WorkspaceAppMountResolutionError,
    );
    expect(() => appApiPath("/api/health")).toThrow(
      WorkspaceAppMountResolutionError,
    );
    expect(() => agentNativePath("/_agent-native/auth/session")).toThrow(
      WorkspaceAppMountResolutionError,
    );
  });

  it("preserves an explicitly configured root workspace mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/");
    vi.stubGlobal("window", { location: { pathname: "/settings/model" } });

    expect(appBasePath()).toBe("");
  });

  it.each(["/", "/_agent-native/auth/session", "/api/health"])(
    "keeps the configured workspace mount for the reserved path %s",
    (pathname) => {
      vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
      vi.stubGlobal("window", { location: { pathname } });

      expect(appBasePath()).toBe("/dispatch");
      expect(appApiPath("/api/health")).toBe("/dispatch/api/health");
      expect(agentNativePath("/_agent-native/auth/session")).toBe(
        "/dispatch/_agent-native/auth/session",
      );
    },
  );

  it("preserves the default root router basename without mount metadata", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    const context = { basename: "/" };
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __reactRouterContext: context,
    });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(configureClientRouterBasename()).toBe(false);
    expect(context.basename).toBe("/");
    expect(error).toHaveBeenCalledOnce();
  });

  it("preserves a server basename when an empty path is not declared as root", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    const context = { basename: "/dispatch" };
    vi.stubGlobal("window", {
      location: { pathname: "/_agent-native/auth/session" },
      __reactRouterContext: context,
    });

    expect(appBasePath()).toBe("");
    expect(configureClientRouterBasename()).toBe(true);
    expect(context.basename).toBe("/dispatch");
  });

  it("matches the current workspace mount when the router basename defaults to root", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    const context = { basename: "/" };
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppMountPaths: ["/dispatch"] },
      __reactRouterContext: context,
    });

    expect(appBasePath()).toBe("/dispatch");
    expect(configureClientRouterBasename()).toBe(true);
    expect(context.basename).toBe("/dispatch");
  });

  it("keeps an explicit root mount above matching sibling mounts", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "settings", path: "/settings" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/settings/model" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceAppPath: "/",
        workspaceAppMountPaths: ["/settings"],
      },
    });

    expect(appBasePath()).toBe("");
    expect(isWorkspaceAppPath("/settings/model")).toBe(true);
    expect(appMountedPath("/settings/model", "/")).toBe("/settings/model");
  });

  it("does not infer a mount from an unmatched URL and a root index route", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/nope" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          index: { id: "index", parentId: "root", index: true },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
  });

  it("keeps a root wildcard route from becoming an omitted workspace mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/settings/team" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          settings: { id: "settings", parentId: "root", path: "settings/*" },
          team: { id: "team", parentId: "root", path: "team" },
        },
      },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
  });

  it("uses the router basename for a mounted app with a root catch-all route", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/missing" },
      __reactRouterContext: { basename: "/dispatch" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          catchall: { id: "catchall", parentId: "root", path: "*" },
        },
      },
    });

    expect(appBasePath()).toBe("/dispatch");
  });

  it("does not infer a nested mount from identity when the full path hits a catch-all", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/missing" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppId: "dispatch" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          catchall: { id: "catchall", parentId: "root", path: "*" },
        },
      },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
  });

  it("uses the router basename when a root catch-all masks a real route", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppId: "dispatch" },
      __reactRouterContext: { basename: "/dispatch" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          catchall: { id: "catchall", parentId: "root", path: "*" },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(appBasePath()).toBe("/dispatch");
  });

  it("uses the explicit app path when a root splat masks a static local route", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceAppId: "dispatch",
        workspaceAppPath: "/dispatch",
      },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          catchall: { id: "catchall", parentId: "root", path: "*" },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(appBasePath()).toBe("/dispatch");
  });

  it("uses a declared mount path when its app id differs from its path", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "clips", path: "/clips" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/recordings/home" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceAppId: "clips",
        workspaceAppMountPaths: ["/recordings", "/content"],
      },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(appBasePath()).toBe("/recordings");
  });

  it("uses explicit app mount config when a dynamic route also matches the full path", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: {
        workspaceAppId: "dispatch",
        workspaceAppPath: "/dispatch",
      },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          dynamic: {
            id: "dynamic",
            parentId: "root",
            path: ":workspace/:page",
          },
          home: { id: "home", parentId: "root", path: "home" },
        },
      },
    });

    expect(appBasePath()).toBe("/dispatch");
  });

  it.each(["/dispatch", "/dispatch/"])(
    "uses explicit app mount config when a root parameter route masks %s",
    (pathname) => {
      vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv(
        "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
        JSON.stringify([{ id: "content", path: "/content" }]),
      );
      vi.stubGlobal("window", {
        location: { pathname },
        __AGENT_NATIVE_CONFIG__: {
          workspaceAppId: "dispatch",
          workspaceAppPath: "/dispatch",
        },
        __reactRouterManifest: {
          routes: {
            root: { id: "root", path: "/" },
            index: { id: "index", parentId: "root", index: true },
            appId: { id: "appId", parentId: "root", path: ":appId" },
            home: { id: "home", parentId: "root", path: "home" },
          },
        },
      });

      expect(appBasePath()).toBe("/dispatch");
    },
  );

  it("does not infer an identity-matching mount from a root catch-all and parameter route", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppId: "dispatch" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          catchall: { id: "catchall", parentId: "root", path: "*" },
          appId: { id: "appId", parentId: "root", path: ":appId" },
        },
      },
    });

    expect(() => appBasePath()).toThrow(
      "Cannot resolve workspace app mount path because the current URL matches no projected mount.",
    );
  });

  it("keeps a root route inside its live workspace mount when omitted by the manifest", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/" },
      __AGENT_NATIVE_CONFIG__: { workspaceAppPath: "/dispatch" },
    });

    expect(appMountPath("/")).toBe("/dispatch");
    expect(appMountedPath("/settings/keys", "/")).toBe(
      "/dispatch/settings/keys",
    );
  });

  it("resolves the mount from a deep route without runtime flags", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: "/dispatch/settings/integrations/secrets/settings/token",
      },
    });

    expect(appMountPath(SETTINGS)).toBe("/dispatch");
  });

  it("keeps root-mounted apps at the origin", () => {
    vi.stubGlobal("window", { location: { pathname: "/settings/general" } });

    expect(appMountPath(SETTINGS)).toBe("");
    expect(appMountedPath("/settings/account", SETTINGS)).toBe(
      "/settings/account",
    );
  });

  it("handles a mount spelled like the local route", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/settings");
    vi.stubGlobal("window", { location: { pathname: "/settings/settings" } });

    expect(appMountedPath("/settings/account", SETTINGS)).toBe(
      "/settings/settings/account",
    );
    expect(appMountedPath("/settings/settings/account", SETTINGS)).toBe(
      "/settings/settings/account",
    );
  });

  it("does not accept a partial route segment", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings-archive" },
    });

    expect(appMountPath(SETTINGS)).toBe("");
  });

  it("does not accept a route marker inside the mount segment", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/foo-settings/integrations" },
    });

    expect(appMountPath(SETTINGS)).toBe("");
  });

  it("keeps the longest known nested mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "nested", path: "/foo/settings" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/foo/settings/settings/account" },
    });

    expect(appMountPath(SETTINGS)).toBe("/foo/settings");
    expect(appMountedPath("/settings/profile", SETTINGS)).toBe(
      "/foo/settings/settings/profile",
    );
  });
});
