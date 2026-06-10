import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addAgentNativeSkill,
  AGENT_NATIVE_SKILL_METADATA_FILE,
  parseSkillsArgs,
  runSkills,
} from "./skills.js";

const tmpRoots: string[] = [];
const PLANS_SKILL_NAMES = ["visual-plan", "visual-recap"];

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

  it("authenticates by default and opts out with --no-connect", () => {
    expect(parseSkillsArgs(["add", "assets"]).connect).toBe(true);
    expect(parseSkillsArgs(["add", "assets", "--no-connect"]).connect).toBe(
      false,
    );
    expect(parseSkillsArgs(["add", "assets", "--skip-connect"]).connect).toBe(
      false,
    );
  });

  it("parses the PR Visual Recap GitHub Action flag and alias", () => {
    expect(
      parseSkillsArgs(["add", "visual-plan", "--with-github-action"]),
    ).toMatchObject({ withGithubAction: true });
    expect(
      parseSkillsArgs(["add", "visual-plan", "--with-github-actions"]),
    ).toMatchObject({ withGithubAction: true });
  });

  it("parses managed instruction update flags for plain skill repos", () => {
    expect(
      parseSkillsArgs([
        "add",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--update-instructions",
      ]),
    ).toMatchObject({
      plainSkillNames: ["quick-recap"],
      updateInstructions: true,
    });
    expect(
      parseSkillsArgs(["add", "BuilderIO/skills", "--no-update-instructions"]),
    ).toMatchObject({ updateInstructions: false });
  });

  it("parses status/update without prompting for add defaults", () => {
    expect(parseSkillsArgs(["status", "visual-plan"])).toMatchObject({
      command: "status",
      target: "visual-plan",
      scopeExplicit: false,
    });
    expect(
      parseSkillsArgs(["update", "visual-plan", "--scope", "project"]),
    ).toMatchObject({
      command: "update",
      target: "visual-plan",
      scope: "project",
      scopeExplicit: true,
    });
  });

  it("skips the auth flow when --no-connect is passed", async () => {
    const root = tmpDir();
    const runConnect = vi.fn(async () => {});

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--no-connect",
      ]),
      {
        baseDir: root,
        isInteractive: () => true,
        runConnect,
        runCommand: async () => 0,
      },
    );

    expect(runConnect).not.toHaveBeenCalled();
    expect(result.connected).toBe(false);
  });

  it("prints the connect command instead of auth in a non-interactive shell", async () => {
    const root = tmpDir();
    const runConnect = vi.fn(async () => {});

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
        isInteractive: () => false,
        runConnect,
        runCommand: async () => 0,
      },
    );

    expect(runConnect).not.toHaveBeenCalled();
    expect(result.connected).toBe(false);
    expect(result.connectCommand).toBe(
      "agent-native connect https://assets.agent-native.com --client claude-code --scope project",
    );
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
    let materializedMetadata = "";

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
            if (cmd === "npx" && args.includes("@agent-native/skills@latest")) {
              const source = args[3];
              if (source) {
                materializedVisualPlan = fs.readFileSync(
                  path.join(source, "skills", "visual-plan", "SKILL.md"),
                  "utf-8",
                );
                materializedMetadata = fs.readFileSync(
                  path.join(
                    source,
                    "skills",
                    "visual-plan",
                    "agent-native-skill.json",
                  ),
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
          "@agent-native/skills@latest",
          "--skill",
          "visual-plan",
          "--skill",
          "visual-recap",
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
      expect(materializedVisualPlan).toContain("pass it as `planText`");
      expect(materializedVisualPlan).toContain("contentPatches");
      expect(materializedVisualPlan).not.toContain("data-plan-tabs");
      expect(JSON.parse(materializedMetadata)).toMatchObject({
        source: "agent-native",
        appSkillId: "visual-plans",
        skillName: "visual-plan",
      });
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("reports and refreshes stale project skill folders", async () => {
    const root = tmpDir();
    const skillDir = path.join(root, ".agents", "skills", "visual-recap");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: visual-recap\n---\n\nstale body\n",
      "utf-8",
    );
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      ["status", "visual-recap", "--scope", "project", "--json"],
      { baseDir: root },
    );
    const status = JSON.parse(stdout.splice(0).join(""));
    expect(status.found).toBe(1);
    expect(status.stale).toBe(1);
    expect(status.skills[0]).toMatchObject({
      skillName: "visual-recap",
      status: "stale",
      managed: false,
    });

    await runSkills(
      ["update", "visual-recap", "--scope", "project", "--json"],
      { baseDir: root },
    );
    const updated = JSON.parse(stdout.splice(0).join(""));
    expect(updated.updated).toBe(1);
    expect(updated.skills[0]).toMatchObject({
      skillName: "visual-recap",
      status: "current",
      managed: true,
    });
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toContain(
      "create-visual-recap",
    );
    expect(
      fs.readFileSync(
        path.join(skillDir, "references", "wireframe.md"),
        "utf-8",
      ),
    ).toContain("HTML wireframe quality");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(skillDir, "agent-native-skill.json"),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      source: "agent-native",
      appSkillId: "visual-plans",
      skillName: "visual-recap",
    });

    fs.rmSync(path.join(skillDir, "agent-native-skill.json"));
    await runSkills(
      ["update", "visual-recap", "--scope", "project", "--json"],
      { baseDir: root },
    );
    const repaired = JSON.parse(stdout.splice(0).join(""));
    expect(repaired.updated).toBe(1);
    expect(repaired.skills[0]).toMatchObject({
      skillName: "visual-recap",
      status: "current",
      managed: true,
    });
  });

  it("keeps exported Plans skill copies aligned with template skills", () => {
    const root = workspaceRoot();
    const pairs = [
      ["visual-plan", "visual-plans"],
      ["visual-recap", "visual-recap"],
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
        "@agent-native/skills@latest",
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

  it("delegates plain GitHub skill repos to @agent-native/skills", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[]; stdio?: string }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--update-instructions",
        "--with-github-action",
        "--yes",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args, options) => {
          commands.push({ cmd, args, stdio: options?.stdio });
          return 0;
        },
      },
    );

    expect(result.id).toBe("BuilderIO/skills");
    expect(result.mcpUrl).toBe("");
    expect(result.local).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ cmd: "npx", stdio: "silent" });
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "@agent-native/skills@latest",
        "add",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--update-instructions",
        "--with-github-action",
        "--yes",
      ]),
    );
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
    const runConnect = vi.fn(async () => {});
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    try {
      await runSkills(["add", "assets"], {
        baseDir: root,
        isInteractive: () => true,
        promptClients,
        runConnect,
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
      // Install also authenticates the hosted connector in one step.
      expect(runConnect).toHaveBeenCalledTimes(1);
      expect(runConnect.mock.calls[0][0]).toEqual(
        expect.arrayContaining(["https://assets.agent-native.com"]),
      );
      expect(stdout.join("")).toContain("MCP config: codex, claude-code.");
      expect(stdout.join("")).toContain("Authentication: completed.");
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
        runConnect: async () => {},
        runCommand: async () => 0,
      },
    );

    expect(promptClients).not.toHaveBeenCalled();
  });

  it("offers the PR Visual Recap workflow during interactive Plans installs", async () => {
    const root = tmpDir();
    const stdout: string[] = [];
    const promptGithubAction = vi.fn(async () => true);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      [
        "add",
        "visual-plan",
        "--client",
        "codex",
        "--scope",
        "project",
        "--no-connect",
      ],
      {
        baseDir: root,
        isInteractive: () => true,
        promptGithubAction,
        runCommand: async () => 0,
      },
    );

    expect(promptGithubAction).toHaveBeenCalledTimes(1);
    const workflow = path.join(
      root,
      ".github",
      "workflows",
      "pr-visual-recap.yml",
    );
    expect(fs.existsSync(workflow)).toBe(true);
    expect(fs.readFileSync(workflow, "utf-8")).toContain("PR Visual Recap");
    expect(stdout.join("")).toContain("PR Visual Recap workflow: wrote");
    expect(stdout.join("")).toContain(
      "npx @agent-native/core@latest recap setup",
    );
  });

  it("prints a later command when the optional recap workflow prompt is declined", async () => {
    const root = tmpDir();
    const stdout: string[] = [];
    const promptGithubAction = vi.fn(async () => false);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      [
        "add",
        "visual-plan",
        "--client",
        "codex",
        "--scope",
        "project",
        "--no-connect",
      ],
      {
        baseDir: root,
        isInteractive: () => true,
        promptGithubAction,
        runCommand: async () => 0,
      },
    );

    expect(promptGithubAction).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(root, ".github"))).toBe(false);
    expect(stdout.join("")).toContain(
      "npx @agent-native/core@latest skills add visual-plan --with-github-action",
    );
  });

  it("skips the optional recap workflow prompt when the flag is explicit", async () => {
    const root = tmpDir();
    const promptGithubAction = vi.fn(async () => false);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(
      [
        "add",
        "visual-plan",
        "--client",
        "codex",
        "--scope",
        "project",
        "--no-connect",
        "--with-github-action",
      ],
      {
        baseDir: root,
        isInteractive: () => true,
        promptGithubAction,
        runCommand: async () => 0,
      },
    );

    expect(promptGithubAction).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(root, ".github", "workflows", "pr-visual-recap.yml"),
      ),
    ).toBe(true);
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
        runConnect: async () => {},
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

  it("dry-runs the visual recap workflow install honestly", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "visual-plan",
        "--scope",
        "project",
        "--dry-run",
        "--with-github-action",
      ]),
      { baseDir: root },
    );

    expect(result.commands).toEqual([
      "agent-native skills add visual-plan --client codex --scope project --with-github-action --yes",
    ]);
    expect(result.githubActionPath).toBe(
      path.join(".github", "workflows", "pr-visual-recap.yml"),
    );
    expect(fs.existsSync(path.join(root, ".github"))).toBe(false);
  });

  it("reports installed skill status without running the add flow", async () => {
    const root = tmpDir();
    const skillDir = path.join(root, ".agents", "skills", "visual-plan");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "old visual plan\n");
    fs.writeFileSync(
      path.join(skillDir, AGENT_NATIVE_SKILL_METADATA_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: "agent-native",
          appSkillId: "visual-plans",
          displayName: "Agent-Native Plans",
          skillName: "visual-plan",
          contentHash: "old",
          mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
          installedAt: "2026-01-01T00:00:00.000Z",
          updateCommand: "agent-native skills update visual-plan",
        },
        null,
        2,
      )}\n`,
    );
    const stdout: string[] = [];
    const runCommand = vi.fn(async () => 0);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      [
        "status",
        "visual-plan",
        "--client",
        "codex",
        "--scope",
        "project",
        "--json",
      ],
      { baseDir: root, runCommand },
    );

    expect(runCommand).not.toHaveBeenCalled();
    const json = JSON.parse(stdout.join(""));
    expect(json).toMatchObject({ command: "status", found: 1, stale: 1 });
    expect(json.skills[0]).toMatchObject({
      skillName: "visual-plan",
      status: "stale",
      managed: true,
    });
  });

  it("updates managed copied skill folders in place", async () => {
    const root = tmpDir();
    const skillDir = path.join(root, ".agents", "skills", "visual-plan");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "old visual plan\n");
    fs.writeFileSync(
      path.join(skillDir, AGENT_NATIVE_SKILL_METADATA_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: "agent-native",
          appSkillId: "visual-plans",
          displayName: "Agent-Native Plans",
          skillName: "visual-plan",
          contentHash: "old",
          mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
          installedAt: "2026-01-01T00:00:00.000Z",
          updateCommand: "agent-native skills update visual-plan",
        },
        null,
        2,
      )}\n`,
    );
    const stdout: string[] = [];
    const runCommand = vi.fn(async () => 0);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      ["update", "visual-plan", "--client", "codex", "--scope", "project"],
      { baseDir: root, runCommand },
    );

    expect(runCommand).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain("Updated 1 skill folder");
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toContain(
      "# Agent-Native Plans",
    );
    expect(
      fs.existsSync(path.join(skillDir, "references", "wireframe.md")),
    ).toBe(true);
    const metadata = JSON.parse(
      fs.readFileSync(
        path.join(skillDir, AGENT_NATIVE_SKILL_METADATA_FILE),
        "utf-8",
      ),
    );
    expect(metadata.contentHash).not.toBe("old");
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
