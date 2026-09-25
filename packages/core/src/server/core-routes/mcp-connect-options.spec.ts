import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../../app-config/index.js";
import { resolveCoreRoutesMcpOptions } from "./mcp-connect-options.js";

describe("resolveCoreRoutesMcpOptions", () => {
  afterEach(() => {
    resetAppConfigForTests();
    vi.restoreAllMocks();
  });

  it("mounts the connect surface by default", () => {
    expect(resolveCoreRoutesMcpOptions(undefined).connect).toBe(true);
    expect(resolveCoreRoutesMcpOptions({}).connect).toBe(true);
  });

  it("accepts either form of the disable switch", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveCoreRoutesMcpOptions({ mcp: { connect: false } }).connect,
    ).toBe(false);
    expect(
      resolveCoreRoutesMcpOptions({ disableMcpConnect: true }).connect,
    ).toBe(false);
    // The legacy key is the inverse of the new one, so agreeing values must not
    // read as a conflict.
    expect(
      resolveCoreRoutesMcpOptions({
        disableMcpConnect: true,
        mcp: { connect: false },
      }).connect,
    ).toBe(false);
  });

  it("throws when the two forms disagree rather than picking one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      resolveCoreRoutesMcpOptions({
        disableMcpConnect: true,
        mcp: { connect: true },
      }),
    ).toThrow(/disagree/);
    expect(() =>
      resolveCoreRoutesMcpOptions({
        mcpConnectServerName: "old",
        mcp: { serverName: "new" },
      }),
    ).toThrow(/disagree/);
  });

  it("resolves app identity from config, not from a per-surface option", () => {
    defineAppConfig({ app: { id: "mail", name: "Mail" } });
    const resolved = resolveCoreRoutesMcpOptions({});
    expect(resolved.appId).toBe("mail");
    expect(resolved.appName).toBe("Mail");
  });

  it("still honors the deprecated identity options over config", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    defineAppConfig({ app: { id: "mail", name: "Mail" } });
    const resolved = resolveCoreRoutesMcpOptions({
      mcpConnectAppId: "legacy",
      mcpConnectAppName: "Legacy",
    });
    expect(resolved.appId).toBe("legacy");
    expect(resolved.appName).toBe("Legacy");
  });

  it("returns an explicit serverName verbatim, without the agent-native- prefix", () => {
    // Plan's published id is the bare `plan` — see
    // `.agents/plugins/agent-native-visual-plans/.mcp.json`. An override is how
    // an app pins an id clients already have in their config; the derived
    // default would be `agent-native-plan` and would land as a second entry.
    expect(
      resolveCoreRoutesMcpOptions({ mcp: { serverName: "plan" } }).serverName,
    ).toBe("plan");
  });
});
