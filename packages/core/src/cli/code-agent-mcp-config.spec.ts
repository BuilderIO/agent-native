import { describe, expect, it } from "vitest";

import type { McpConfig } from "../mcp-client/config.js";
import {
  codexMcpConfigArgs,
  mergeCodeAgentMcpConfig,
  restrictCodeAgentMcpConfig,
} from "./code-agent-mcp-config.js";

describe("code-agent MCP config", () => {
  it("accepts the full MCP_SERVERS shape", () => {
    const environment = {
      MCP_SERVERS: JSON.stringify({
        servers: {
          fullHttp: {
            type: "http",
            url: "https://full.example/mcp",
          },
          fullStdio: {
            command: "full-bin",
            args: ["--serve"],
          },
        },
      }),
    } as NodeJS.ProcessEnv;

    expect(mergeCodeAgentMcpConfig({ servers: {} }, environment)).toMatchObject(
      {
        source: "env:MCP_SERVERS",
        servers: {
          fullHttp: {
            type: "http",
            url: "https://full.example/mcp",
          },
          fullStdio: {
            command: "full-bin",
            args: ["--serve"],
          },
        },
      },
    );
    expect(codexMcpConfigArgs(environment)).toEqual([
      "-c",
      'mcp_servers."fullHttp".url="https://full.example/mcp"',
    ]);
  });

  it("accepts the inner-map MCP_SERVERS shape", () => {
    const environment = {
      MCP_SERVERS: JSON.stringify({
        innerHttp: {
          type: "http",
          url: "https://inner.example/mcp",
        },
        innerStdio: {
          command: "inner-bin",
        },
      }),
    } as NodeJS.ProcessEnv;

    expect(mergeCodeAgentMcpConfig({ servers: {} }, environment)).toMatchObject(
      {
        source: "env:MCP_SERVERS",
        servers: {
          innerHttp: {
            type: "http",
            url: "https://inner.example/mcp",
          },
          innerStdio: {
            command: "inner-bin",
          },
        },
      },
    );
    expect(codexMcpConfigArgs(environment)).toEqual([
      "-c",
      'mcp_servers."innerHttp".url="https://inner.example/mcp"',
    ]);
  });

  it("keeps only the exact allowlisted desktop server ids", () => {
    const config: McpConfig = {
      source: "desktop",
      servers: {
        allowed: {
          command: "allowed-bin",
        },
        "org_org-1_zapier": {
          type: "http",
          url: "https://zapier.example/mcp",
        },
      },
    };

    expect(
      restrictCodeAgentMcpConfig(config, {
        AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST: "allowed",
      }),
    ).toEqual({
      source: "desktop",
      servers: {
        allowed: {
          command: "allowed-bin",
        },
      },
    });
  });
});
