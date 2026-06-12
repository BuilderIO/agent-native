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

  it("non-interactive device client writes URL-only + returns the fallback command", async () => {
    const { codexHome } = isolateHome();
    const baseDir = tmpDir();
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
    expect(toml).not.toContain("Bearer");
    expect(result.authenticated).toBe(false);

    const guidance = result.guidance.join("\n");
    expect(guidance).toContain(
      "npx @agent-native/core@latest connect https://plan.agent-native.com --token <token>",
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
