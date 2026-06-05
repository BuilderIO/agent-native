import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addAgentNativeSkill, parseSkillsArgs, runSkills } from "./skills.js";

const tmpRoots: string[] = [];
const PLANS_SKILL_NAMES = [
  "visual-plan",
  "visual-questions",
  "ui-plan",
  "visualize-plan",
];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-"));
  tmpRoots.push(root);
  return root;
}

function workspaceRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root.");
}

describe("agent-native skills", () => {
  it("defaults to the one-command Assets install path", () => {
    expect(parseSkillsArgs(["add", "assets"])).toMatchObject({
      command: "add",
      target: "assets",
      client: "codex",
      clientExplicit: false,
      instructions: true,
      mcp: true,
    });
  });

  it("tracks when --client is explicit", () => {
    expect(
      parseSkillsArgs(["add", "assets", "--client", "claude-code"]),
    ).toMatchObject({
      client: "claude-code",
      clientExplicit: true,
    });
  });

  it("accepts image-generation aliases for the built-in Assets skill", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "agent-native-images",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.id).toBe("assets");
    expect(result.skillNames).toEqual(["assets"]);
    expect(commands[0].args).toEqual(
      expect.arrayContaining(["--skill", "assets", "-a", "codex", "-y"]),
    );
  });

  it("accepts design-exploration aliases for the built-in Design skill", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "agent-native-design-exploration",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.id).toBe("design");
    expect(result.skillNames).toEqual(["design-exploration"]);
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "--skill",
        "design-exploration",
        "-a",
        "codex",
        "-y",
      ]),
    );
    expect(result.mcpUrl).toBe(
      "https://design.agent-native.com/_agent-native/mcp",
    );
  });

  it("accepts shorthand aliases for the built-in Plans skill", async () => {
    const root = tmpDir();
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;
    const commands: { cmd: string; args: string[] }[] = [];
    let materializedVisualPlan = "";

    process.env.CODEX_HOME = codexHome;
    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "plannotate",
          "--client",
          "codex",
          "--scope",
          "project",
        ]),
        {
          baseDir: root,
          runCommand: async (cmd, args) => {
            commands.push({ cmd, args });
            if (cmd === "npx" && args.includes("skills@latest")) {
              const source = args[3];
              if (source) {
                materializedVisualPlan = fs.readFileSync(
                  path.join(source, "skills", "visual-plan", "SKILL.md"),
                  "utf-8",
                );
              }
            }
            return 0;
          },
        },
      );

      expect(result.id).toBe("visual-plans");
      expect(result.skillNames).toEqual(PLANS_SKILL_NAMES);
      expect(commands[0].args).toEqual(
        expect.arrayContaining([
          "--skill",
          "visual-plan",
          "--skill",
          "visual-questions",
          "--skill",
          "ui-plan",
          "--skill",
          "visualize-plan",
          "-a",
          "codex",
          "-y",
        ]),
      );
      expect(result.mcpUrl).toBe(
        "https://plan.agent-native.com/_agent-native/mcp",
      );
      expect(
        fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8"),
      ).toContain('url = "https://plan.agent-native.com/_agent-native/mcp"');
      expect(materializedVisualPlan).toContain("structured `content`");
      expect(materializedVisualPlan).toContain("contentPatches");
      expect(materializedVisualPlan).not.toContain("data-plan-tabs");
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("accepts visualize-plan as a Plans companion alias", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "visualize-plan",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.id).toBe("visual-plans");
    expect(result.skillNames).toEqual(PLANS_SKILL_NAMES);
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "--skill",
        "visual-plan",
        "--skill",
        "visual-questions",
        "--skill",
        "ui-plan",
        "--skill",
        "visualize-plan",
      ]),
    );
    expect(result.mcpUrl).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );
  });

  it("accepts ui-plan as a Plans UI-first alias", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "ui-plan",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.id).toBe("visual-plans");
    expect(result.skillNames).toEqual(PLANS_SKILL_NAMES);
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "--skill",
        "visual-plan",
        "--skill",
        "visual-questions",
        "--skill",
        "ui-plan",
        "--skill",
        "visualize-plan",
      ]),
    );
    expect(result.mcpUrl).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );
  });

  it("accepts visual-questions as a Plans intake alias", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "visual-questions",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.id).toBe("visual-plans");
    expect(result.skillNames).toEqual(PLANS_SKILL_NAMES);
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "--skill",
        "visual-plan",
        "--skill",
        "visual-questions",
        "--skill",
        "ui-plan",
        "--skill",
        "visualize-plan",
      ]),
    );
    expect(result.mcpUrl).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );
  });

  it("keeps exported Plans skill copies aligned with template skills", () => {
    const root = workspaceRoot();
    const pairs = [
      ["visual-plan", "visual-plans"],
      ["visual-questions", "visual-questions"],
      ["ui-plan", "ui-plan"],
      ["visualize-plan", "visualize-plan"],
    ];

    for (const [templateName, exportedName] of pairs) {
      const templateSkill = fs.readFileSync(
        path.join(
          root,
          "templates",
          "plan",
          ".agents",
          "skills",
          templateName,
          "SKILL.md",
        ),
        "utf-8",
      );
      const exportedSkill = fs.readFileSync(
        path.join(root, "skills", exportedName, "SKILL.md"),
        "utf-8",
      );
      expect(exportedSkill).toBe(templateSkill);
    }
  });

  it("installs project-scoped local Context X-Ray artifacts without global agent instructions", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "context-xray",
          "--client",
          "all",
          "--scope",
          "project",
          "--yes",
        ]),
        { baseDir: root },
      );

      expect(result).toMatchObject({
        id: "context-xray",
        local: true,
        mcpUrl: "",
        mcpClients: [],
        skillNames: ["context-xray"],
      });
      expect(
        fs.existsSync(
          path.join(home, ".agent-native", "context-xray", "context-xray"),
        ),
      ).toBe(true);
      expect(
        fs.readFileSync(
          path.join(root, ".agents", "skills", "context-xray", "SKILL.md"),
          "utf-8",
        ),
      ).toContain("name: context-xray");
      expect(
        fs.readFileSync(
          path.join(root, ".agents", "commands", "context-xray.md"),
          "utf-8",
        ),
      ).toContain("Context X-Ray");
      expect(
        fs.existsSync(
          path.join(codexHome, "skills", "context-xray", "SKILL.md"),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(home, ".claude", "commands", "context-xray.md"),
        ),
      ).toBe(false);
      expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
      expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("keeps user-scoped local Context X-Ray instructions global", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;

    try {
      await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "context-xray",
          "--client",
          "all",
          "--scope",
          "user",
          "--yes",
        ]),
        { baseDir: root },
      );

      expect(
        fs.readFileSync(
          path.join(codexHome, "skills", "context-xray", "SKILL.md"),
          "utf-8",
        ),
      ).toContain("name: context-xray");
      expect(
        fs.readFileSync(
          path.join(home, ".claude", "commands", "context-xray.md"),
          "utf-8",
        ),
      ).toContain("~/.agent-native/context-xray/context-xray --open");
      expect(
        fs.existsSync(
          path.join(root, ".agents", "skills", "context-xray", "SKILL.md"),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(root, ".agents", "commands", "context-xray.md"),
        ),
      ).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("filters generated Context X-Ray Codex analysis to the requested project", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    const project = path.join(root, "project");
    const otherProject = path.join(root, "other-project");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(otherProject, { recursive: true });
    fs.mkdirSync(path.join(codexHome, "sessions", "2026", "06", "02"), {
      recursive: true,
    });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "context-xray",
          "--client",
          "codex",
          "--scope",
          "user",
          "--yes",
        ]),
        { baseDir: root },
      );
      const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "02");
      const projectSessionFile = path.join(sessionsDir, "project.jsonl");
      fs.writeFileSync(
        projectSessionFile,
        `${JSON.stringify({
          type: "session_meta",
          payload: {
            id: "11111111-1111-4111-8111-111111111111",
            cwd: project,
            timestamp: "2026-06-02T12:00:00.000Z",
          },
        })}\n${JSON.stringify({
          type: "response_item",
          payload: { role: "assistant", content: "project session" },
          timestamp: "2026-06-02T12:01:00.000Z",
        })}\n`,
      );
      const baseTime = Date.now() / 1000;
      fs.utimesSync(projectSessionFile, baseTime - 1000, baseTime - 1000);
      for (let i = 0; i < 90; i += 1) {
        const otherSessionFile = path.join(sessionsDir, `other-${i}.jsonl`);
        fs.writeFileSync(
          otherSessionFile,
          `${JSON.stringify({
            type: "session_meta",
            payload: {
              id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
              cwd: otherProject,
              timestamp: "2026-06-02T13:00:00.000Z",
            },
          })}\n${JSON.stringify({
            type: "response_item",
            payload: { role: "assistant", content: `other session ${i}` },
            timestamp: "2026-06-02T13:01:00.000Z",
          })}\n`,
        );
        fs.utimesSync(otherSessionFile, baseTime + i, baseTime + i);
      }
      const outFile = path.join(root, "context-xray.json");
      const run = spawnSync(
        process.execPath,
        [
          result.scriptPath!,
          "--source",
          "codex",
          "--project",
          project,
          "--format",
          "json",
          "--out",
          outFile,
          "--since",
          "30d",
        ],
        {
          env: {
            ...process.env,
            HOME: home,
            CODEX_HOME: codexHome,
            CLAUDE_CODE_SESSION_ID: "",
          },
          encoding: "utf-8",
        },
      );

      expect(run.status).toBe(0);
      const report = JSON.parse(fs.readFileSync(outFile, "utf-8"));
      expect(report.sessions).toHaveLength(1);
      expect(report.sessions[0].cwd).toBe(project);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("dry-runs the Context X-Ray one-command install", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs(["add", "xray", "--client", "codex", "--dry-run"]),
      { baseDir: root },
    );

    expect(result).toMatchObject({
      id: "context-xray",
      local: true,
      commands: [
        "agent-native skills add xray --client codex --scope user --yes",
      ],
    });
    expect(fs.existsSync(path.join(root, ".agents"))).toBe(false);
  });

  it("installs built-in Assets instructions and MCP config", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.skillNames).toEqual(["assets"]);
    expect(commands).toHaveLength(1);
    expect(commands[0].cmd).toBe("npx");
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "skills@latest",
        "add",
        "--copy",
        "--skill",
        "assets",
        "-a",
        "claude-code",
        "-y",
      ]),
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"))
        .mcpServers["agent-native-assets"].url,
    ).toBe("https://assets.agent-native.com/_agent-native/mcp");
  });

  it("prompts for target clients in interactive installs when --client is omitted", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const stdout: string[] = [];
    const commands: { cmd: string; args: string[]; stdio?: string }[] = [];
    const promptClients = vi.fn(async () => [
      "codex" as const,
      "claude-code" as const,
    ]);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    try {
      await runSkills(["add", "assets"], {
        baseDir: root,
        isInteractive: () => true,
        promptClients,
        runCommand: async (cmd, args, options) => {
          commands.push({ cmd, args, stdio: options?.stdio });
          return 0;
        },
      });

      expect(promptClients).toHaveBeenCalledTimes(1);
      expect(commands[0]).toMatchObject({ cmd: "npx", stdio: "silent" });
      expect(commands[0].args).toEqual(
        expect.arrayContaining(["-a", "codex", "-a", "claude-code"]),
      );
      expect(
        fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8"),
      ).toContain("agent-native-assets");
      expect(
        JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf-8"))
          .mcpServers["agent-native-assets"].url,
      ).toBe("https://assets.agent-native.com/_agent-native/mcp");
      expect(stdout.join("")).toContain("MCP config: codex, claude-code.");
      expect(stdout.join("")).toContain("rerun with --client <client>");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("skips the client prompt when --client is explicit", async () => {
    const root = tmpDir();
    const promptClients = vi.fn(async () => ["codex" as const]);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(
      ["add", "assets", "--client", "claude-code", "--scope", "project"],
      {
        baseDir: root,
        isInteractive: () => true,
        promptClients,
        runCommand: async () => 0,
      },
    );

    expect(promptClients).not.toHaveBeenCalled();
  });

  it("prompts for skills when interactive add has no target", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const commands: { args: string[] }[] = [];
    const promptSkills = vi.fn(async () => ["assets", "design-exploration"]);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runSkills(["add"], {
        baseDir: root,
        isInteractive: () => true,
        promptClients: async () => ["codex"],
        promptSkills,
        runCommand: async (_cmd, args) => {
          commands.push({ args });
          return 0;
        },
      });

      expect(promptSkills).toHaveBeenCalledTimes(1);
      expect(commands).toHaveLength(2);
      expect(commands[0].args).toEqual(
        expect.arrayContaining(["--skill", "assets"]),
      );
      expect(commands[1].args).toEqual(
        expect.arrayContaining(["--skill", "design-exploration"]),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("supports dry-run without writing local agent config", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs(["add", "assets", "--scope", "project", "--dry-run"]),
      { baseDir: root },
    );

    expect(result.commands).toEqual([
      "agent-native skills add assets --client codex --scope project --yes",
    ]);
    expect(result.commands.join("\n")).not.toContain(os.tmpdir());
    expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("registers the skill against a --mcp-url override (bare origin gets the mcp path)", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--mcp-url",
        "https://archer.ngrok-free.dev",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    expect(result.mcpUrl).toBe(
      "https://archer.ngrok-free.dev/_agent-native/mcp",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"))
        .mcpServers["agent-native-assets"].url,
    ).toBe("https://archer.ngrok-free.dev/_agent-native/mcp");
  });

  it("accepts a full --mcp-url and surfaces it in dry-run", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "design-exploration",
        "--scope",
        "project",
        "--mcp-url",
        "http://localhost:8092/_agent-native/mcp",
        "--dry-run",
      ]),
      { baseDir: root },
    );

    expect(result.mcpUrl).toBe("http://localhost:8092/_agent-native/mcp");
    expect(result.commands[0]).toContain(
      "--mcp-url http://localhost:8092/_agent-native/mcp",
    );
  });

  it("rejects an invalid --mcp-url", async () => {
    await expect(
      addAgentNativeSkill(
        parseSkillsArgs(["add", "assets", "--mcp-url", "not-a-url"]),
        { baseDir: tmpDir(), runCommand: async () => 0 },
      ),
    ).rejects.toThrow(/must be a valid URL/);
  });

  it("writes Codex MCP config under CODEX_HOME when set", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    try {
      await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "assets",
          "--client",
          "codex",
          "--scope",
          "user",
          "--mcp-only",
          "--yes",
        ]),
        { baseDir: root },
      );

      const codexConfig = path.join(codexHome, "config.toml");
      expect(fs.readFileSync(codexConfig, "utf-8")).toContain(
        'url = "https://assets.agent-native.com/_agent-native/mcp"',
      );
      expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("preserves app base paths in --mcp-url overrides", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--mcp-url",
        "https://self-hosted.example.com/mail",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    expect(result.mcpUrl).toBe(
      "https://self-hosted.example.com/mail/_agent-native/mcp",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"))
        .mcpServers["agent-native-assets"].url,
    ).toBe("https://self-hosted.example.com/mail/_agent-native/mcp");
  });

  it("keeps --json output machine-readable for MCP-only installs", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      await runSkills(
        [
          "add",
          "assets",
          "--client",
          "codex",
          "--scope",
          "user",
          "--mcp-only",
          "--yes",
          "--json",
        ],
        { baseDir: root },
      );

      const result = JSON.parse(stdout.join(""));
      expect(result.id).toBe("assets");
      expect(result.mcpUrl).toBe(
        "https://assets.agent-native.com/_agent-native/mcp",
      );
      expect(stderr.join("")).toBe("");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("keeps full --json installs clean and aligns user scope for skills", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const commands: { cmd: string; args: string[]; stdio?: string }[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      await runSkills(
        [
          "add",
          "images",
          "--client",
          "codex",
          "--scope",
          "user",
          "--yes",
          "--json",
        ],
        {
          baseDir: root,
          runCommand: async (cmd, args, options) => {
            commands.push({ cmd, args, stdio: options?.stdio });
            return 0;
          },
        },
      );

      const result = JSON.parse(stdout.join(""));
      expect(result.id).toBe("assets");
      expect(commands[0]).toMatchObject({
        cmd: "npx",
        stdio: "silent",
      });
      expect(commands[0].args).toEqual(expect.arrayContaining(["-g"]));
      expect(commands[0].args).toEqual(
        expect.arrayContaining(["--skill", "assets", "-a", "codex"]),
      );
      expect(stderr.join("")).toBe("");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
