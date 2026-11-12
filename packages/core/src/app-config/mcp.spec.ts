import { describe, expect, it } from "vitest";

import { describeConfigFields } from "./describe.js";
import { readEnvConfigLayer } from "./env-layer.js";
import { mcpConfig } from "./mcp.js";

describe("MCP app config", () => {
  it("keeps the script catalog, script writes and loopback dev access off by default", () => {
    expect(mcpConfig.parse({})).toEqual({
      allowDevOpen: false,
      scriptTools: false,
      scriptWrites: false,
      scriptWriteRowBudget: 200,
      scriptWriteRecoveryMs: 20 * 60_000,
    });
  });

  it("reads script writes and their limits from the environment", () => {
    expect(
      readEnvConfigLayer(mcpConfig, {
        AGENT_NATIVE_MCP_SCRIPT_WRITES: "true",
        AGENT_NATIVE_MCP_SCRIPT_WRITE_ROW_BUDGET: "50",
        AGENT_NATIVE_MCP_SCRIPT_WRITE_RECOVERY_MS: "900000",
      }),
    ).toEqual({
      scriptWrites: true,
      scriptWriteRowBudget: 50,
      scriptWriteRecoveryMs: 900_000,
    });
  });

  it("refuses a row budget or recovery window that could not hold", () => {
    for (const fields of [
      { scriptWriteRowBudget: 0 },
      { scriptWriteRowBudget: 10_001 },
      { scriptWriteRowBudget: 1.5 },
      { scriptWriteRecoveryMs: 59_999 },
    ]) {
      expect(mcpConfig.safeParse(fields).success, JSON.stringify(fields)).toBe(
        false,
      );
    }
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
