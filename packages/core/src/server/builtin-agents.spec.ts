import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BUILTIN_AGENT_IDS } from "../shared/first-party-agents.js";
import {
  parseBuiltinAgentsConfig,
  readBuiltinAgentsConfig,
  resetBuiltinAgentsConfigForTests,
  workspaceBuiltinAgentsJson,
} from "./builtin-agents.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "builtin-agents-"));
  tempDirs.push(dir);
  return dir;
}

function writePackageJson(dir: string, pkg: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AGENT_NATIVE_BUILTIN_AGENTS_JSON", "");
  resetBuiltinAgentsConfigForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetBuiltinAgentsConfigForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseBuiltinAgentsConfig", () => {
  it('defaults to mode "all" with the framework default set', () => {
    const { config, warnings } = parseBuiltinAgentsConfig(undefined);

    expect(config).toEqual({
      mode: "all",
      include: [...DEFAULT_BUILTIN_AGENT_IDS],
    });
    expect(warnings).toEqual([]);
    expect(config.include).toContain("mail");
    expect(config.include).not.toContain("recruiting");
  });

  it('offers nothing in mode "none"', () => {
    expect(parseBuiltinAgentsConfig({ mode: "none" }).config).toEqual({
      mode: "none",
      include: [],
    });
  });

  it('offers only included ids in mode "selected"', () => {
    const { config, warnings } = parseBuiltinAgentsConfig({
      mode: "selected",
      include: ["Mail", "calendar"],
    });

    expect(config).toEqual({
      mode: "selected",
      include: ["mail", "calendar"],
    });
    expect(warnings).toEqual([]);
  });

  it("warns on and drops unknown ids instead of throwing", () => {
    const { config, warnings } = parseBuiltinAgentsConfig({
      mode: "selected",
      include: ["mail", "not-a-template"],
    });

    expect(config.include).toEqual(["mail"]);
    expect(warnings).toEqual([
      'builtinAgents.include names unknown built-in agent "not-a-template"',
    ]);
  });

  it("normalizes legacy aliases to catalog ids", () => {
    expect(
      parseBuiltinAgentsConfig({ mode: "selected", include: ["images"] }).config
        .include,
    ).toEqual(["assets"]);
  });

  it("warns and uses the default for an invalid mode", () => {
    const { config, warnings } = parseBuiltinAgentsConfig({ mode: "some" });
    expect(config.mode).toBe("all");
    expect(warnings[0]).toMatch(/builtinAgents\.mode/);
  });

  it("requires include in selected mode", () => {
    const { config, warnings } = parseBuiltinAgentsConfig({
      mode: "selected",
    });
    expect(config.include).toEqual([]);
    expect(warnings[0]).toMatch(/include is required/);
  });
});

describe("readBuiltinAgentsConfig", () => {
  it("prefers the serialized env value passed to child apps", () => {
    vi.stubEnv(
      "AGENT_NATIVE_BUILTIN_AGENTS_JSON",
      JSON.stringify({ mode: "none" }),
    );
    expect(readBuiltinAgentsConfig().mode).toBe("none");
  });

  it("reads the workspace root package.json from a nested app", () => {
    const root = tempDir();
    writePackageJson(root, {
      "agent-native": {
        workspaceCore: "@acme/shared",
        builtinAgents: { mode: "selected", include: ["mail"] },
      },
    });
    const appDir = path.join(root, "apps", "crm");
    writePackageJson(appDir, { name: "crm" });
    vi.spyOn(process, "cwd").mockReturnValue(appDir);

    expect(readBuiltinAgentsConfig()).toEqual({
      mode: "selected",
      include: ["mail"],
    });
  });

  it("reads a standalone app's own package.json", () => {
    const appDir = tempDir();
    writePackageJson(appDir, {
      "agent-native": { builtinAgents: { mode: "none" } },
    });
    vi.spyOn(process, "cwd").mockReturnValue(appDir);

    expect(readBuiltinAgentsConfig().mode).toBe("none");
  });

  it("serializes the root config for child processes", () => {
    const root = tempDir();
    writePackageJson(root, {
      "agent-native": { builtinAgents: { mode: "none" } },
    });
    expect(workspaceBuiltinAgentsJson(root)).toBe('{"mode":"none"}');
    expect(workspaceBuiltinAgentsJson(tempDir())).toBeUndefined();
  });
});
