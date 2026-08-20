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
    expect(codexMcpConfigArgs(null, environment)).toEqual([
      "-c",
      'mcp_servers.fullHttp.url="https://full.example/mcp"',
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
    expect(codexMcpConfigArgs(null, environment)).toEqual([
      "-c",
      'mcp_servers.innerHttp.url="https://inner.example/mcp"',
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

  it("delivers the authenticated desktop server to both code-agent paths", () => {
    const token = "x".repeat(43);
    const environment = {
      MCP_SERVERS: JSON.stringify({
        servers: {
          workspace: {
            type: "http",
            url: "https://workspace.example/mcp",
          },
        },
      }),
      AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST: "workspace",
      AGENT_NATIVE_DESKTOP_CHILD: "1",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL: "http://127.0.0.1:43123/mcp",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN: token,
    } as NodeJS.ProcessEnv;

    const merged = mergeCodeAgentMcpConfig({ servers: {} }, environment);
    expect(restrictCodeAgentMcpConfig(merged, environment)?.servers).toEqual({
      workspace: {
        type: "http",
        url: "https://workspace.example/mcp",
      },
      "agent-native-desktop-computer": {
        type: "http",
        url: "http://127.0.0.1:43123/mcp",
        headers: { Authorization: `Bearer ${token}` },
        description:
          "Authenticated computer control for this Agent Native desktop task",
      },
    });
    expect(codexMcpConfigArgs(null, environment)).toContain(
      `mcp_servers.agent-native-desktop-computer.http_headers={"Authorization"="Bearer ${token}"}`,
    );
  });

  it("resolves a desktop server collision consistently", () => {
    const environment = {
      MCP_SERVERS: JSON.stringify({
        servers: {
          "agent-native-desktop-computer": {
            type: "http",
            url: "https://user.example/mcp",
          },
        },
      }),
      AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST:
        "agent-native-desktop-computer",
      AGENT_NATIVE_DESKTOP_CHILD: "1",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL: "http://127.0.0.1:43123/mcp",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN: "x".repeat(43),
    } as NodeJS.ProcessEnv;

    const merged = mergeCodeAgentMcpConfig({ servers: {} }, environment);
    expect(
      Object.keys(restrictCodeAgentMcpConfig(merged, environment)!.servers),
    ).toEqual([
      "agent-native-desktop-computer",
      "agent-native-desktop-computer-2",
    ]);
    expect(codexMcpConfigArgs(null, environment).join("\n")).toContain(
      'mcp_servers.agent-native-desktop-computer-2.url="http://127.0.0.1:43123/mcp"',
    );
  });

  it("preserves a file-config collision across both code-agent paths", () => {
    const token = "x".repeat(43);
    const environment = {
      AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST:
        "agent-native-desktop-computer",
      AGENT_NATIVE_DESKTOP_CHILD: "1",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL: "http://127.0.0.1:43123/mcp",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN: token,
    } as NodeJS.ProcessEnv;
    const fileConfig: McpConfig = {
      source: "file:mcp.json",
      servers: {
        "agent-native-desktop-computer": {
          type: "http",
          url: "https://user.example/mcp",
        },
      },
    };

    const merged = mergeCodeAgentMcpConfig(fileConfig, environment)!;
    expect(
      Object.keys(restrictCodeAgentMcpConfig(merged, environment)!.servers),
    ).toEqual([
      "agent-native-desktop-computer",
      "agent-native-desktop-computer-2",
    ]);
    expect(codexMcpConfigArgs(fileConfig, environment).join("\n")).toContain(
      'mcp_servers.agent-native-desktop-computer-2.url="http://127.0.0.1:43123/mcp"',
    );
  });

  it("does not deliver an invalid desktop child bridge", () => {
    const environment = {
      AGENT_NATIVE_DESKTOP_CHILD: "1",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL: "https://example.com/mcp",
      AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN: "too-short",
    } as NodeJS.ProcessEnv;

    expect(mergeCodeAgentMcpConfig(null, environment)).toBeNull();
    expect(codexMcpConfigArgs(null, environment)).toEqual([]);
  });
});
