import { afterEach, describe, expect, it, vi } from "vitest";

import { appBasePath, appMountPath, appMountedPath } from "./api-path.js";

const SETTINGS = "/settings";

describe("appMountPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the live mount when the workspace manifest omits it", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", { location: { pathname: "/dispatch/settings" } });

    expect(appBasePath()).toBe("");
    expect(appMountPath(SETTINGS)).toBe("/dispatch");
    expect(appMountedPath("/settings/general", SETTINGS)).toBe(
      "/dispatch/settings/general",
    );
  });

  it("restores an omitted live mount from the app route manifest", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/home" },
      __reactRouterManifest: {
        routes: {
          root: { id: "root", path: "/" },
          home: { id: "home", parentId: "root", path: "home" },
        },
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

    expect(appBasePath()).toBe("");
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

    expect(appBasePath()).toBe("");
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

  it("keeps a root route inside its live workspace mount when omitted by the manifest", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    vi.stubGlobal("window", { location: { pathname: "/dispatch/" } });

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
