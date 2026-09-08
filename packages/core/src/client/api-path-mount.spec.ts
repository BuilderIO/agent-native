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
});
