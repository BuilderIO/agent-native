import { afterEach, describe, expect, it, vi } from "vitest";

import { appBasePath, appMountPath, appMountedPath } from "./api-path.js";

const SETTINGS = "/settings";

describe("appMountPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the mount the surface is served from when the manifest omits it", () => {
    // The settings side-nav writes the URL with history.pushState, so an
    // unconfirmed mount used to collapse "/dispatch/settings" to "/settings".
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

  it("keeps the mount when nothing marks the runtime as a workspace", () => {
    vi.stubGlobal("window", { location: { pathname: "/dispatch/settings" } });

    expect(appBasePath()).toBe("");
    expect(appMountPath(SETTINGS)).toBe("/dispatch");
  });

  it("resolves the mount from a deep app-local route", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings/agent/automations" },
    });

    expect(appMountPath(SETTINGS)).toBe("/dispatch");
  });

  it("returns no mount for an app served from the origin root", () => {
    vi.stubGlobal("window", { location: { pathname: "/settings/general" } });

    expect(appMountPath(SETTINGS)).toBe("");
    expect(appMountedPath("/settings/account", SETTINGS)).toBe(
      "/settings/account",
    );
  });

  it("prefers a confirmed base path over the pathname", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings/agent" },
    });

    expect(appMountPath(SETTINGS)).toBe("/dispatch");
    expect(appMountedPath("/settings/agent", SETTINGS)).toBe(
      "/dispatch/settings/agent",
    );
  });

  it("does not treat a partial segment match as a mount boundary", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings-archive" },
    });

    expect(appMountPath(SETTINGS)).toBe("");
  });

  it("falls back to the base path when the route is absent from the pathname", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubGlobal("window", { location: { pathname: "/dispatch/home" } });

    expect(appMountPath(SETTINGS)).toBe("/dispatch");
  });

  it("never promotes an app-local route into a mount of its own", () => {
    // Guards the Builder connect-popup regression: the app is mounted at
    // "/dispatch" while the browser sits on a stale app-local "/settings", so
    // "/settings" must not become the mount.
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "dispatch", path: "/dispatch" }]),
    );
    vi.stubGlobal("window", { location: { pathname: "/settings" } });

    expect(appMountPath(SETTINGS)).toBe("");
  });

  it("uses the trailing mount when a mount and the route share a name", () => {
    vi.stubGlobal("window", { location: { pathname: "/settings/settings" } });

    expect(appMountPath(SETTINGS)).toBe("/settings");
  });

  it("does not double-prefix an already mounted path", () => {
    vi.stubGlobal("window", { location: { pathname: "/dispatch/settings" } });

    expect(appMountedPath("/dispatch/settings/general", SETTINGS)).toBe(
      "/dispatch/settings/general",
    );
  });

  it("leaves relative paths alone", () => {
    vi.stubGlobal("window", { location: { pathname: "/dispatch/settings" } });

    expect(appMountedPath("settings/general", SETTINGS)).toBe(
      "settings/general",
    );
  });
});
