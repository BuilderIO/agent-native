import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import {
  getAppOriginClientConfigScript,
  resolvePublicAppOriginConfig,
} from "./app-origin-config.js";

const originalEnv = { ...process.env };
const KEYS = [
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "AGENT_NATIVE_WORKSPACE",
  "VITE_AGENT_NATIVE_WORKSPACE",
  "AGENT_NATIVE_APP_ID",
  "APP_ID",
  "AGENT_APP",
  "AGENT_NATIVE_WORKSPACE_APP_ID",
  "VITE_AGENT_NATIVE_WORKSPACE_APP_ID",
  "AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "APP_BASE_PATH",
  "VITE_APP_BASE_PATH",
];

describe("app origin client config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("projects the default public app home when no origin is configured", () => {
    expect(resolvePublicAppOriginConfig()).toEqual({ appHomePath: "/home" });
    expect(getAppOriginClientConfigScript()).toContain('"appHomePath":"/home"');
  });

  it("projects the declared origins into the shell", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.WORKSPACE_GATEWAY_URL = "https://gateway.example.com";
    process.env.WORKSPACE_OAUTH_ORIGIN = "https://oauth.example.com";

    expect(resolvePublicAppOriginConfig()).toEqual({
      appHomePath: "/home",
      appUrl: "https://app.example.com",
      workspaceGatewayUrl: "https://gateway.example.com",
      workspaceOAuthOrigin: "https://oauth.example.com",
    });
  });

  it("carries the VITE spelling through the same field", () => {
    process.env.VITE_APP_URL = "https://vite.example.com";
    process.env.VITE_WORKSPACE_GATEWAY_URL = "https://vite-gw.example.com";

    expect(resolvePublicAppOriginConfig()).toEqual({
      appHomePath: "/home",
      appUrl: "https://vite.example.com",
      workspaceGatewayUrl: "https://vite-gw.example.com",
    });
  });

  it("projects workspace runtime state for browser-only consumers", () => {
    process.env.AGENT_NATIVE_WORKSPACE = "true";

    expect(resolvePublicAppOriginConfig()).toEqual({
      appHomePath: "/home",
      workspaceRuntime: true,
    });
  });

  it("projects workspace mount paths for early runtime path reconciliation", () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify([
      { id: "dispatch", path: "/dispatch" },
      { id: "diagrams", path: "/diagrams/" },
    ]);

    expect(resolvePublicAppOriginConfig()).toEqual({
      appHomePath: "/home",
      workspaceRuntime: true,
      workspaceAppMountPaths: ["/dispatch", "/diagrams"],
    });
  });

  it("keeps an idless non-root mount as a sibling without selecting it as current", () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify([
      { path: "/dispatch" },
    ]);

    expect(resolvePublicAppOriginConfig()).toMatchObject({
      workspaceRuntime: true,
      workspaceAppMountPaths: ["/dispatch"],
    });
    expect(resolvePublicAppOriginConfig()).not.toHaveProperty(
      "workspaceAppPath",
    );
  });

  it("does not select an idless root mount as the current workspace app", () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify([
      { path: "/" },
    ]);

    expect(resolvePublicAppOriginConfig()).toMatchObject({
      workspaceRuntime: true,
    });
    expect(resolvePublicAppOriginConfig()).not.toHaveProperty(
      "workspaceAppPath",
    );
  });

  it("projects the configured current mount when the manifest only lists siblings", () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify([
      { id: "diagrams", path: "/diagrams" },
    ]);
    process.env.APP_BASE_PATH = "/dispatch/";
    defineAppConfig({ app: { workspaceId: "dispatch" } });

    expect(resolvePublicAppOriginConfig()).toMatchObject({
      workspaceAppId: "dispatch",
      workspaceAppPath: "/dispatch",
      workspaceAppMountPaths: ["/diagrams"],
      workspaceRuntime: true,
    });
  });

  it("projects an explicit root mount from the workspace manifest", () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify([
      { id: "root-app", path: "/" },
      { id: "diagrams", path: "/diagrams" },
    ]);
    defineAppConfig({ app: { workspaceId: "root-app" } });

    expect(resolvePublicAppOriginConfig()).toMatchObject({
      workspaceAppId: "root-app",
      workspaceAppPath: "/",
      workspaceAppMountPaths: ["/diagrams"],
      workspaceRuntime: true,
    });
  });

  it("projects an explicit root app base path", () => {
    process.env.AGENT_NATIVE_WORKSPACE = "true";
    process.env.APP_BASE_PATH = "/";

    expect(resolvePublicAppOriginConfig()).toMatchObject({
      workspaceAppPath: "/",
      workspaceRuntime: true,
    });
  });

  it("prefers the canonical spelling over its mirror", () => {
    process.env.APP_URL = "https://canonical.example.com";
    process.env.VITE_APP_URL = "https://mirror.example.com";

    expect(resolvePublicAppOriginConfig()?.appUrl).toBe(
      "https://canonical.example.com",
    );
  });

  it("projects a configured private app home for client session fallbacks", () => {
    defineAppConfig({ app: { homePath: "/inbox" } });

    expect(resolvePublicAppOriginConfig()?.appHomePath).toBe("/inbox");
    expect(getAppOriginClientConfigScript()).toContain(
      '"appHomePath":"/inbox"',
    );
  });

  it("uses the first matching workspace id when projecting its mount path", () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify([
      { id: "workspace-calendar", path: "/recordings" },
      { id: "workspace-calendar", path: "/clips" },
    ]);
    defineAppConfig({
      app: { id: "calendar", workspaceId: "workspace-calendar" },
    });

    expect(resolvePublicAppOriginConfig()).toEqual({
      appId: "calendar",
      workspaceAppId: "workspace-calendar",
      workspaceAppPath: "/recordings",
      appHomePath: "/home",
      workspaceRuntime: true,
      workspaceAppMountPaths: ["/recordings", "/clips"],
    });
    expect(getAppOriginClientConfigScript()).toContain(
      '"appId":"calendar","workspaceAppId":"workspace-calendar"',
    );
    expect(getAppOriginClientConfigScript()).toContain(
      '"workspaceAppPath":"/recordings"',
    );
  });

  it("emits a shell script that merges rather than replaces", () => {
    process.env.APP_URL = "https://app.example.com";
    const script = getAppOriginClientConfigScript();

    expect(script).toContain("data-agent-native-app-origin-config");
    expect(script).toContain(
      "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    );
    expect(script).toContain('"appUrl":"https://app.example.com"');
  });

  it("HTML-escapes the public config payload", () => {
    process.env.APP_URL = "https://app.example.com/?value=</script>&next=>";

    const script = getAppOriginClientConfigScript();

    expect(script).toContain("\\u003c/script\\u003e");
    expect(script).toContain("\\u0026next=\\u003e");
    expect(script.match(/<\/script>/g)).toEqual(["</script>"]);
  });

  it("omits absent fields instead of emitting undefined", () => {
    process.env.APP_URL = "https://app.example.com";
    const config = resolvePublicAppOriginConfig();

    expect(config).not.toHaveProperty("workspaceGatewayUrl");
    expect(JSON.stringify(config)).not.toContain("undefined");
  });
});
