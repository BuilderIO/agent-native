import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BUILTIN_AGENT_IDS } from "../shared/first-party-agents.js";
import {
  BuiltinAgentsNotOfferedError,
  parseBuiltinAgentsConfig,
  parseBuiltinAgentsEnabledSettings,
  readBuiltinAgentsConfig,
  resetBuiltinAgentsConfigForTests,
  resolveEnabledBuiltinAgentIds,
  workspaceBuiltinAgentsJson,
  writeBuiltinAgentsEnabledSettings,
} from "./builtin-agents.js";

const settingsMocks = vi.hoisted(() => ({
  putOrgSetting: vi.fn(),
  putUserSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("../settings/index.js", () => settingsMocks);

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
      defaultEnabled: [...DEFAULT_BUILTIN_AGENT_IDS],
    });
    expect(warnings).toEqual([]);
    expect(config.include).toContain("mail");
    expect(config.include).not.toContain("recruiting");
  });

  it('offers nothing in mode "none"', () => {
    expect(parseBuiltinAgentsConfig({ mode: "none" }).config).toEqual({
      mode: "none",
      include: [],
      defaultEnabled: [],
    });
  });

  it('offers only included ids in mode "selected"', () => {
    const { config, warnings } = parseBuiltinAgentsConfig({
      mode: "selected",
      include: ["Mail", "calendar"],
      defaultEnabled: ["mail"],
    });

    expect(config).toEqual({
      mode: "selected",
      include: ["mail", "calendar"],
      defaultEnabled: ["mail"],
    });
    expect(warnings).toEqual([]);
  });

  it("falls back to every included id when defaultEnabled is absent", () => {
    expect(
      parseBuiltinAgentsConfig({ mode: "selected", include: ["mail"] }).config
        .defaultEnabled,
    ).toEqual(["mail"]);
  });

  it("lets mode all narrow the default-enabled set", () => {
    const { config } = parseBuiltinAgentsConfig({
      mode: "all",
      defaultEnabled: ["mail"],
    });
    expect(config.include).toEqual([...DEFAULT_BUILTIN_AGENT_IDS]);
    expect(config.defaultEnabled).toEqual(["mail"]);
  });

  it("warns on and drops unknown ids instead of throwing", () => {
    const { config, warnings } = parseBuiltinAgentsConfig({
      mode: "selected",
      include: ["mail", "not-a-template"],
      defaultEnabled: ["calendar"],
    });

    expect(config.include).toEqual(["mail"]);
    expect(config.defaultEnabled).toEqual([]);
    expect(warnings).toEqual([
      'builtinAgents.include names unknown built-in agent "not-a-template"',
      'builtinAgents.defaultEnabled names "calendar", which is not offered by include',
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
      defaultEnabled: ["mail"],
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

describe("enabled built-in settings", () => {
  const config = {
    mode: "selected" as const,
    include: ["mail", "calendar"],
    defaultEnabled: ["mail"],
  };

  it("uses defaultEnabled before any admin change", () => {
    expect(resolveEnabledBuiltinAgentIds(config, null)).toEqual(["mail"]);
  });

  it("intersects the admin's choice with the builder's include", () => {
    expect(
      resolveEnabledBuiltinAgentIds(config, {
        enabledIds: ["calendar", "slides"],
        offeredIds: ["mail", "calendar"],
      }),
    ).toEqual(["calendar"]);
  });

  it("applies defaultEnabled to built-ins offered after the admin saved", () => {
    expect(
      resolveEnabledBuiltinAgentIds(
        { ...config, include: ["mail", "calendar", "slides"] },
        { enabledIds: [], offeredIds: ["mail", "calendar"] },
      ),
    ).toEqual([]);
    expect(
      resolveEnabledBuiltinAgentIds(
        {
          ...config,
          include: ["mail", "calendar", "slides"],
          defaultEnabled: ["slides"],
        },
        { enabledIds: [], offeredIds: ["mail", "calendar"] },
      ),
    ).toEqual(["slides"]);
  });

  it("treats an unreadable stored value as an error, not as unset", () => {
    expect(parseBuiltinAgentsEnabledSettings(null)).toBeNull();
    expect(() =>
      parseBuiltinAgentsEnabledSettings({ enabledIds: "mail" }),
    ).toThrow(/enabledIds/);
  });

  it("rejects ids the builder does not offer", async () => {
    await expect(
      writeBuiltinAgentsEnabledSettings({
        scope: { kind: "org", id: "org-1" },
        enabledIds: ["mail", "slides"],
        actor: "admin@example.test",
        config,
      }),
    ).rejects.toBeInstanceOf(BuiltinAgentsNotOfferedError);
    expect(settingsMocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("stores enabled and offered ids per org", async () => {
    const saved = await writeBuiltinAgentsEnabledSettings({
      scope: { kind: "org", id: "org-1" },
      enabledIds: ["Calendar"],
      actor: "admin@example.test",
      config,
    });

    expect(saved).toMatchObject({
      enabledIds: ["calendar"],
      offeredIds: ["mail", "calendar"],
      updatedBy: "admin@example.test",
    });
    expect(settingsMocks.putOrgSetting).toHaveBeenCalledWith(
      "org-1",
      "builtin-agents-enabled",
      saved,
    );
  });
});
