import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addAgentNativeSkill, parseSkillsArgs, runSkills } from "./skills.js";

const tmpRoots: string[] = [];

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

describe("agent-native skills", () => {
  it("defaults to the one-command Assets install path", () => {
    expect(parseSkillsArgs(["add", "assets"])).toMatchObject({
      command: "add",
      target: "assets",
      client: "codex",
      instructions: true,
      mcp: true,
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
        stdio: "stderr",
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
