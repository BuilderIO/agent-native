import { afterEach, describe, expect, it, vi } from "vitest";

import { CORE_SETTINGS_PAGES } from "./core-pages.js";
import {
  resolveSettingsRoute,
  settingsPagePath,
  settingsPathSegments,
} from "./routing.js";

function resolve(pathname: string, hash = "") {
  return resolveSettingsRoute({ pathname, hash }, CORE_SETTINGS_PAGES);
}

describe("settings shell routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves new page ids and their sub-pages", () => {
    expect(resolve("/settings/profile")).toEqual({
      page: "profile",
      sub: null,
    });
    expect(resolve("/settings/integrations/builder")).toEqual({
      page: "integrations",
      sub: "builder",
    });
    expect(resolve("/settings/app/recordings")).toEqual({
      page: "app",
      sub: "recordings",
    });
  });

  it("leaves bare /settings unresolved so the shell opens its default", () => {
    expect(resolve("/settings")).toEqual({ page: null, sub: null });
  });

  it.each([
    ["/settings/general", "app"],
    ["/settings/account", "profile"],
    ["/settings/agent", "model"],
    ["/settings/agent/resources", "files"],
    ["/settings/agent/resources/memory", "memory"],
    ["/settings/agent/resources/instructions", "instructions"],
    ["/settings/agent/automations", "automations"],
    ["/settings/agent/agents", "sub-agents"],
    ["/settings/organization", "org"],
    ["/settings/keys", "api-keys"],
    ["/settings/secrets", "api-keys"],
    ["/settings/connections", "integrations"],
    ["/settings/workspace", "infra"],
    ["/settings/library", "creative-context"],
    ["/settings/whats-new", "whats-new"],
  ])("routes today's tab link %s to %s", (pathname, page) => {
    expect(resolve(pathname).page).toBe(page);
  });

  it("resolves a legacy hash on bare /settings", () => {
    expect(resolve("/settings", "#organization").page).toBe("org");
    expect(resolve("/settings", "#agent:resources").page).toBe("files");
  });

  it("reports an unknown id as named so the shell can redirect it", () => {
    expect(resolve("/settings/not-a-page")).toEqual({
      page: "not-a-page",
      sub: null,
    });
  });

  it("strips a workspace mount prefix", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "dispatch", path: "/dispatch" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings/model" },
    });
    expect(settingsPathSegments("/dispatch/settings/model")).toEqual(["model"]);
  });

  it("builds page paths", () => {
    expect(settingsPagePath("api-keys")).toBe("/settings/api-keys");
    expect(settingsPagePath("channels", "slack")).toBe(
      "/settings/channels/slack",
    );
    expect(settingsPagePath("app", null)).toBe("/settings/app");
  });
});
