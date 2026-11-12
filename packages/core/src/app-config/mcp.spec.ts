import { describe, expect, it } from "vitest";

import { describeConfigFields } from "./describe.js";
import { readEnvConfigLayer } from "./env-layer.js";
import { mcpConfig } from "./mcp.js";

describe("MCP app config", () => {
  it("keeps the script catalog and loopback dev access off by default", () => {
    expect(mcpConfig.parse({})).toEqual({
      allowDevOpen: false,
      scriptTools: false,
    });
  });

  it("turns the script catalog on only from its environment variable", () => {
    expect(
      readEnvConfigLayer(mcpConfig, { AGENT_NATIVE_MCP_SCRIPT_TOOLS: "true" }),
    ).toEqual({ scriptTools: true });
    expect(
      readEnvConfigLayer(mcpConfig, { AGENT_NATIVE_MCP_SCRIPT_TOOLS: "0" }),
    ).toEqual({ scriptTools: false });
    expect(readEnvConfigLayer(mcpConfig, {})).toEqual({});
  });

  it("documents how a connection opts into the script catalog", () => {
    const field = describeConfigFields(mcpConfig).find(
      ({ path }) => path === "scriptTools",
    );
    expect(field).toMatchObject({
      env: ["AGENT_NATIVE_MCP_SCRIPT_TOOLS"],
      type: "boolean",
      defaultValue: false,
    });
    expect(field?.doc).toContain("`?catalog=script`");
    expect(field?.doc).toContain("`x-agent-native-mcp-catalog: script`");
  });
});
