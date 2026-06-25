import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSkills } from "./index.js";

const tmpRoots: string[] = [];
let prevHome: string | undefined;
let prevCodexHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevCodexHome = process.env.CODEX_HOME;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevCodexHome;
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-mcp-"));
  tmpRoots.push(root);
  return root;
}

function writeSkill(repo: string, name: string): void {
  const dir = path.join(repo, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

describe("installSkills MCP registration", () => {
  it("registers the plan MCP server (+ alias) for visual-plan, URL-only on claude-code", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan"],
      clients: ["claude-code"],
      scope: "project",
      baseDir: project,
      yes: true,
      isInteractive: () => false,
    });

    // result surfaces the registered server
    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0].serverName).toBe("plan");
    expect(result.mcpServers[0].mcpUrl).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );

    const config = JSON.parse(
      fs.readFileSync(path.join(project, ".mcp.json"), "utf-8"),
    );
    expect(config.mcpServers.plan).toEqual({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
    // alias registered too, pointing at the same URL, URL-only (no headers)
    expect(config.mcpServers["agent-native-plans"]).toEqual({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
  });

  it("shares one plan server when installing visual-plan AND visual-recap", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan");
    writeSkill(repo, "visual-recap");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan", "visual-recap"],
      clients: ["claude-code"],
      scope: "project",
      baseDir: project,
      yes: true,
      isInteractive: () => false,
    });

    // both skills installed, but only ONE plan MCP registration
    expect(result.skills.sort()).toEqual(["visual-plan", "visual-recap"]);
    expect(result.mcpServers.map((s) => s.serverName)).toEqual(["plan"]);
  });

  it("--no-mcp (mcp: false) installs files but registers no MCP server", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan"],
      clients: ["claude-code"],
      scope: "project",
      baseDir: project,
      yes: true,
      mcp: false,
      isInteractive: () => false,
    });

    expect(result.mcpServers).toHaveLength(0);
    expect(fs.existsSync(path.join(project, ".mcp.json"))).toBe(false);
    // files still copied
    expect(
      fs.existsSync(
        path.join(project, ".claude", "skills", "visual-plan", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("registers no MCP server for a plain (non-app) skill", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");

    const result = await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["claude-code"],
      scope: "project",
      baseDir: project,
      yes: true,
      isInteractive: () => false,
    });

    expect(result.mcpServers).toHaveLength(0);
    expect(fs.existsSync(path.join(project, ".mcp.json"))).toBe(false);
  });

  it("does not write URL-only codex config non-interactively", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    const codexHome = tmpDir();
    process.env.CODEX_HOME = codexHome;
    writeSkill(repo, "visual-plan");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      yes: true,
      isInteractive: () => false,
    });

    expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
    expect(result.mcpServers[0]?.files).toEqual([]);
    expect(result.mcpServers[0]?.guidance.join("\n")).toContain(
      "npx @agent-native/core@latest connect https://plan.agent-native.com --client codex --scope project",
    );
  });

  it("--no-connect skips device auth for codex even in interactive installs", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    const codexHome = tmpDir();
    process.env.CODEX_HOME = codexHome;
    writeSkill(repo, "visual-plan");
    vi.stubGlobal("fetch", async () => {
      throw new Error("device auth should not start when connect is false");
    });

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      yes: true,
      connect: false,
      updateInstructions: false,
      isInteractive: () => true,
    });

    expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
    expect(result.mcpServers[0]?.files).toEqual([]);
    expect(result.mcpServers[0]?.guidance.join("\n")).toContain(
      "skipped MCP config because this client needs a bearer token",
    );
  });
});
