import { afterEach, describe, expect, it, vi } from "vitest";

import { injectedAgentNativeAppId } from "./app-config.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("injectedAgentNativeAppId", () => {
  it("prefers the assigned workspace app identity", () => {
    vi.stubGlobal("__AGENT_NATIVE_WORKSPACE_APP_ID__", "workspace-calendar");
    vi.stubGlobal("__AGENT_NATIVE_APP_ID__", "package-calendar");
    vi.stubGlobal("window", {
      __AGENT_NATIVE_CONFIG__: {
        appId: "configured-calendar",
        workspaceAppId: "server-workspace-calendar",
      },
    });

    expect(injectedAgentNativeAppId()).toBe("workspace-calendar");
  });

  it("uses the server app config identity when a bundle only has a package fallback", () => {
    vi.stubGlobal("__AGENT_NATIVE_WORKSPACE_APP_ID__", "");
    vi.stubGlobal("__AGENT_NATIVE_APP_ID__", "package-calendar");
    vi.stubGlobal("window", {
      __AGENT_NATIVE_CONFIG__: { appId: "configured-calendar" },
    });

    expect(injectedAgentNativeAppId()).toBe("configured-calendar");
  });

  it("falls back to the compiled app identity when the server has no app id", () => {
    vi.stubGlobal("__AGENT_NATIVE_WORKSPACE_APP_ID__", "");
    vi.stubGlobal("__AGENT_NATIVE_APP_ID__", " Package-Calendar ");
    vi.stubGlobal("window", { __AGENT_NATIVE_CONFIG__: {} });

    expect(injectedAgentNativeAppId()).toBe("package-calendar");
  });
});
