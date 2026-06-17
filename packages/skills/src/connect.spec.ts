import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpDescriptor, registerMcpServer } from "./connect.js";

const tmpRoots: string[] = [];
let savedHome: string | undefined;
let savedCodexHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  savedCodexHome = process.env.CODEX_HOME;
});

afterEach(() => {
  // Restore the real home dir so no test pollutes the developer's machine.
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = savedCodexHome;
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-connect-test-"));
  tmpRoots.push(root);
  return root;
}

/** Point both $HOME and $CODEX_HOME at temp dirs so writes are hermetic. */
function isolateHome() {
  const home = tmpDir();
  const codexHome = path.join(home, ".codex");
  process.env.HOME = home;
  process.env.CODEX_HOME = codexHome;
  return { home, codexHome };
}

/** A fetch mock that returns scripted JSON responses keyed by URL substring. */
function mockFetch(
  handlers: { match: string; status?: number; json: unknown }[],
): typeof fetch {
  const remaining = [...handlers];
  return (async (url: string) => {
    const idx = remaining.findIndex((h) => url.includes(h.match));
    if (idx === -1) {
      throw new Error(`Unexpected fetch to ${url}`);
    }
    const [handler] = remaining.splice(idx, 1);
    return {
      status: handler.status ?? 200,
      ok: (handler.status ?? 200) < 400,
      json: async () => handler.json,
    } as Response;
  }) as unknown as typeof fetch;
}

const noSleep = async () => {};

describe("registerMcpServer", () => {
  it("writes URL-only OAuth entries for serverName + aliases, no Authorization", async () => {
    const { home } = isolateHome();
    const baseDir = tmpDir();
    const descriptor: McpDescriptor = {
      serverName: "agent-native-plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      aliases: ["agent-native-plans"],
      authMode: "oauth",
      hostedUrl: "https://plan.agent-native.com",
    };

    const result = await registerMcpServer({
      descriptor,
      clients: ["claude-code"],
      scope: "user",
      baseDir,
      interactive: true,
    });

    // claude-code @ user scope → ~/.claude.json
    const claudeJson = JSON.parse(
      fs.readFileSync(path.join(home, ".claude.json"), "utf-8"),
    );
    const main = claudeJson.mcpServers["agent-native-plan"];
    const alias = claudeJson.mcpServers["agent-native-plans"];
    expect(main).toMatchObject({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
    expect(main.headers).toBeUndefined();
    expect(alias).toMatchObject({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
    expect(alias.headers).toBeUndefined();

    expect(result.authenticated).toBe(false);
    expect(result.guidance.join("\n")).toMatch(/restart Claude Code/i);
    expect(result.guidance.join("\n")).toMatch(/\/mcp/);
    expect(result.guidance.join("\n")).toMatch(/Authenticate/i);
  });

  it("writes URL-only OAuth entries for Cursor, OpenCode, and GitHub Copilot / VS Code", async () => {
    isolateHome();
    const baseDir = tmpDir();
    const descriptor: McpDescriptor = {
      serverName: "plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      authMode: "oauth",
      hostedUrl: "https://plan.agent-native.com",
    };

    const result = await registerMcpServer({
      descriptor,
      clients: ["cursor", "opencode", "github-copilot"],
      scope: "project",
      baseDir,
      interactive: true,
    });

    const cursorConfig = JSON.parse(
      fs.readFileSync(path.join(baseDir, ".cursor", "mcp.json"), "utf-8"),
    );
    expect(cursorConfig.mcpServers.plan).toEqual({
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });

    const opencodeConfig = JSON.parse(
      fs.readFileSync(path.join(baseDir, "opencode.json"), "utf-8"),
    );
    expect(opencodeConfig.mcp.plan).toEqual({
      type: "remote",
      url: "https://plan.agent-native.com/_agent-native/mcp",
      enabled: true,
    });

    const copilotConfig = JSON.parse(
      fs.readFileSync(path.join(baseDir, ".vscode", "mcp.json"), "utf-8"),
    );
    expect(copilotConfig.servers.plan).toEqual({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });

    expect(result.authenticated).toBe(false);
    expect(result.guidance.join("\n")).toMatch(/Cursor/);
    expect(result.guidance.join("\n")).toMatch(/OpenCode/);
    expect(result.guidance.join("\n")).toMatch(/GitHub Copilot/);
  });

  it("writes a codex bearer entry after an approved device-flow poll", async () => {
    const { codexHome } = isolateHome();
    const baseDir = tmpDir();
    const descriptor: McpDescriptor = {
      serverName: "plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      authMode: "device",
      hostedUrl: "https://plan.agent-native.com",
    };

    const fetchImpl = mockFetch([
      {
        match: "/device/start",
        json: {
          device_code: "dev-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://plan.agent-native.com/connect",
          verification_uri_complete:
            "https://plan.agent-native.com/connect?code=ABCD-EFGH",
          interval: 1,
          expires_in: 600,
        },
      },
      {
        match: "/device/poll",
        json: {
          status: "approved",
          token: "minted-bearer-token",
          mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
          serverName: "plan",
        },
      },
    ]);

    const result = await registerMcpServer({
      descriptor,
      clients: ["codex"],
      scope: "user",
      baseDir,
      interactive: true,
      deps: { fetchImpl, sleep: noSleep, now: () => 0 },
    });

    const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    expect(toml).toContain('[mcp_servers."plan"]');
    expect(toml).toContain(
      'url = "https://plan.agent-native.com/_agent-native/mcp"',
    );
    expect(toml).toContain("Bearer minted-bearer-token");
    expect(result.authenticated).toBe(true);
  });

  it("writes Codex and Cowork bearer entries from one approved device flow", async () => {
    const { codexHome, home } = isolateHome();
    const baseDir = tmpDir();
    const descriptor: McpDescriptor = {
      serverName: "plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      authMode: "device",
      hostedUrl: "https://plan.agent-native.com",
    };

    const fetchImpl = mockFetch([
      {
        match: "/device/start",
        json: {
          device_code: "dev-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://plan.agent-native.com/connect",
          verification_uri_complete:
            "https://plan.agent-native.com/connect?code=ABCD-EFGH",
          interval: 1,
          expires_in: 600,
        },
      },
      {
        match: "/device/poll",
        json: {
          status: "approved",
          token: "minted-bearer-token",
          mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
          serverName: "plan",
        },
      },
    ]);

    const result = await registerMcpServer({
      descriptor,
      clients: ["codex", "cowork"],
      scope: "user",
      baseDir,
      interactive: true,
      deps: { fetchImpl, sleep: noSleep, now: () => 0 },
    });

    const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    expect(toml).toContain('[mcp_servers."plan"]');
    expect(toml).toContain("Bearer minted-bearer-token");

    const coworkConfig = JSON.parse(
      fs.readFileSync(path.join(home, ".cowork", "mcp.json"), "utf-8"),
    );
    expect(coworkConfig.mcpServers.plan.headers.Authorization).toBe(
      "Bearer minted-bearer-token",
    );
    expect(result.written.map((entry) => entry.client).sort()).toEqual([
      "codex",
      "cowork",
    ]);
    expect(result.authenticated).toBe(true);
  });

  it("uses a structured not_found poll body even when the HTTP status is 404", async () => {
    isolateHome();
    const baseDir = tmpDir();
    const logs: string[] = [];
    const descriptor: McpDescriptor = {
      serverName: "plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      authMode: "device",
      hostedUrl: "https://plan.agent-native.com",
    };

    const fetchImpl = mockFetch([
      {
        match: "/device/start",
        json: {
          device_code: "dev-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://plan.agent-native.com/connect",
          verification_uri_complete:
            "https://plan.agent-native.com/connect?code=ABCD-EFGH",
          interval: 1,
          expires_in: 600,
        },
      },
      {
        match: "/device/poll",
        status: 404,
        json: { status: "not_found", message: "unknown code" },
      },
    ]);

    const result = await registerMcpServer({
      descriptor,
      clients: ["codex"],
      scope: "user",
      baseDir,
      interactive: true,
      log: (message) => logs.push(message),
      deps: { fetchImpl, sleep: noSleep, now: () => 0 },
    });

    expect(result.written).toHaveLength(0);
    expect(logs.join("\n")).toContain("unknown code");
    expect(logs.join("\n")).not.toContain("HTTP 404");
  });

  it("stops device polling at the configured timeout without oversleeping", async () => {
    isolateHome();
    const baseDir = tmpDir();
    const descriptor: McpDescriptor = {
      serverName: "plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      authMode: "device",
      hostedUrl: "https://plan.agent-native.com",
    };
    let nowMs = 0;
    const sleeps: number[] = [];
    const logs: string[] = [];
    const fetchImpl = mockFetch([
      {
        match: "/device/start",
        json: {
          device_code: "dev-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://plan.agent-native.com/connect",
          verification_uri_complete:
            "https://plan.agent-native.com/connect?code=ABCD-EFGH",
          interval: 5,
          expires_in: 600,
        },
      },
      {
        match: "/device/poll",
        json: { status: "pending" },
      },
    ]);

    const result = await registerMcpServer({
      descriptor,
      clients: ["codex"],
      scope: "user",
      baseDir,
      interactive: true,
      log: (message) => logs.push(message),
      deviceFlowTimeoutMs: 1_000,
      deps: {
        fetchImpl,
        now: () => nowMs,
        sleep: async (ms) => {
          sleeps.push(ms);
          nowMs += ms;
        },
      },
    });

    expect(sleeps).toEqual([1_000]);
    expect(result.written).toHaveLength(0);
    expect(result.authenticated).toBe(false);
    expect(logs.join("\n")).toContain(
      "Stopped waiting after 1s so installation can finish.",
    );
    expect(result.guidance.join("\n")).toContain(
      "authentication did not complete; existing MCP config was left unchanged",
    );
  });

  it("writes URL-only entries for authMode 'none' with no auth", async () => {
    const { home } = isolateHome();
    const baseDir = tmpDir();
    const descriptor: McpDescriptor = {
      serverName: "agent-native-context-xray",
      mcpUrl: "https://xray.agent-native.com/_agent-native/mcp",
      authMode: "none",
      hostedUrl: "https://xray.agent-native.com",
    };

    // Pass a fetch that throws — proves authMode "none" never hits the network.
    const fetchImpl = (async () => {
      throw new Error("network must not be called for authMode none");
    }) as unknown as typeof fetch;

    const result = await registerMcpServer({
      descriptor,
      clients: ["claude-code", "codex"],
      scope: "user",
      baseDir,
      interactive: true,
      deps: { fetchImpl },
    });

    const claudeJson = JSON.parse(
      fs.readFileSync(path.join(home, ".claude.json"), "utf-8"),
    );
    const entry = claudeJson.mcpServers["agent-native-context-xray"];
    expect(entry).toMatchObject({
      type: "http",
      url: "https://xray.agent-native.com/_agent-native/mcp",
    });
    expect(entry.headers).toBeUndefined();

    const toml = fs.readFileSync(
      path.join(process.env.CODEX_HOME as string, "config.toml"),
      "utf-8",
    );
    expect(toml).toContain('[mcp_servers."agent-native-context-xray"]');
    expect(toml).not.toContain("Bearer");

    expect(result.authenticated).toBe(false);
  });

  it("non-interactive device client leaves config untouched + returns the connect command", async () => {
    const { codexHome } = isolateHome();
    const baseDir = tmpDir();
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer existing-token" }',
        "",
      ].join("\n"),
      "utf-8",
    );
    const descriptor: McpDescriptor = {
      serverName: "plan",
      mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      authMode: "device",
      hostedUrl: "https://plan.agent-native.com",
    };

    const fetchImpl = (async () => {
      throw new Error("network must not be called when non-interactive");
    }) as unknown as typeof fetch;

    const result = await registerMcpServer({
      descriptor,
      clients: ["codex"],
      scope: "user",
      baseDir,
      interactive: false,
      deps: { fetchImpl },
    });

    const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    expect(toml).toContain('[mcp_servers."plan"]');
    expect(toml).toContain("Bearer existing-token");
    expect(result.authenticated).toBe(false);
    expect(result.written).toHaveLength(0);

    const guidance = result.guidance.join("\n");
    expect(guidance).toContain(
      "Codex: skipped MCP config because this client needs a bearer token.",
    );
    expect(guidance).toContain(
      "npx @agent-native/core@latest connect https://plan.agent-native.com --client codex --scope user",
    );
  });

  it("collects errors instead of throwing when a single key write fails", async () => {
    const { home } = isolateHome();
    // Point baseDir at a file so project-scope writes would fail — but user
    // scope here writes to ~/.claude.json, so use an unwritable codex home.
    const baseDir = tmpDir();
    // Make CODEX_HOME a path whose parent is a file → mkdir fails.
    const blocker = path.join(home, "blocker");
    fs.writeFileSync(blocker, "x", "utf-8");
    process.env.CODEX_HOME = path.join(blocker, "nested");

    const descriptor: McpDescriptor = {
      serverName: "agent-native-x",
      mcpUrl: "https://x.agent-native.com/_agent-native/mcp",
      authMode: "none",
      hostedUrl: "https://x.agent-native.com",
    };

    const result = await registerMcpServer({
      descriptor,
      clients: ["claude-code", "codex"],
      scope: "user",
      baseDir,
      interactive: false,
    });

    // claude-code succeeded.
    const claudeJson = JSON.parse(
      fs.readFileSync(path.join(home, ".claude.json"), "utf-8"),
    );
    expect(claudeJson.mcpServers["agent-native-x"]).toBeDefined();
    // codex failed but did not throw — surfaced in guidance.
    expect(result.guidance.join("\n")).toMatch(/Could not write .*codex/);
    expect(result.written.some((w) => w.client === "claude-code")).toBe(true);
  });
});
