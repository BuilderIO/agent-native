import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMcpConfig } from "./config.js";

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(p: string, body: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(body));
}

describe("loadMcpConfig", () => {
  let originalCwd: string;
  let originalEnv: string | undefined;
  let tmpRoot: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = process.env.MCP_SERVERS;
    delete process.env.MCP_SERVERS;
    tmpRoot = mkdtemp("mcp-config-");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalEnv === undefined) delete process.env.MCP_SERVERS;
    else process.env.MCP_SERVERS = originalEnv;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("returns null when nothing is configured", () => {
    const appDir = path.join(tmpRoot, "app");
    fs.mkdirSync(appDir, { recursive: true });
    expect(loadMcpConfig(appDir)).toBeNull();
  });

  it("reads app-local mcp.config.json when no workspace root exists", () => {
    const appDir = path.join(tmpRoot, "app");
    fs.mkdirSync(appDir, { recursive: true });
    writeJson(path.join(appDir, "mcp.config.json"), {
      servers: { foo: { command: "foo-bin", args: ["--serve"] } },
    });
    const cfg = loadMcpConfig(appDir);
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg!.servers)).toEqual(["foo"]);
    expect(cfg!.servers.foo.command).toBe("foo-bin");
    expect(cfg!.servers.foo.args).toEqual(["--serve"]);
  });

  it("prefers workspace-root config over app-local", () => {
    const workspaceDir = tmpRoot;
    // Mark as workspace root via package.json agent-native.workspaceCore
    writeJson(path.join(workspaceDir, "package.json"), {
      name: "ws",
      "agent-native": { workspaceCore: "@agent-native/core" },
    });
    writeJson(path.join(workspaceDir, "mcp.config.json"), {
      servers: { ws: { command: "workspace-bin" } },
    });
    const appDir = path.join(workspaceDir, "apps", "mail");
    fs.mkdirSync(appDir, { recursive: true });
    writeJson(path.join(appDir, "mcp.config.json"), {
      servers: { app: { command: "app-bin" } },
    });

    const cfg = loadMcpConfig(appDir);
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg!.servers)).toEqual(["ws"]);
    expect(cfg!.servers.ws.command).toBe("workspace-bin");
  });

  it("falls back to MCP_SERVERS env var when no file is present", () => {
    process.env.MCP_SERVERS = JSON.stringify({
      servers: { envsrv: { command: "env-bin" } },
    });
    const appDir = path.join(tmpRoot, "app");
    fs.mkdirSync(appDir, { recursive: true });
    const cfg = loadMcpConfig(appDir);
    expect(cfg).not.toBeNull();
    expect(cfg!.servers.envsrv.command).toBe("env-bin");
  });

  it("accepts the inner-map form of MCP_SERVERS", () => {
    process.env.MCP_SERVERS = JSON.stringify({
      envsrv: { command: "env-bin" },
    });
    const appDir = path.join(tmpRoot, "app");
    fs.mkdirSync(appDir, { recursive: true });
    const cfg = loadMcpConfig(appDir);
    expect(cfg).not.toBeNull();
    expect(cfg!.servers.envsrv.command).toBe("env-bin");
  });

  it("ignores server entries with no command", () => {
    const appDir = path.join(tmpRoot, "app");
    fs.mkdirSync(appDir, { recursive: true });
    writeJson(path.join(appDir, "mcp.config.json"), {
      servers: {
        good: { command: "good-bin" },
        bad: { args: ["oops"] }, // no command → dropped
      },
    });
    const cfg = loadMcpConfig(appDir);
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg!.servers)).toEqual(["good"]);
  });

  it("returns null for malformed JSON", () => {
    const appDir = path.join(tmpRoot, "app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "mcp.config.json"), "{not json");
    expect(loadMcpConfig(appDir)).toBeNull();
  });
});
