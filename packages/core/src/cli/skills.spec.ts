import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { addAgentNativeSkill, parseSkillsArgs } from "./skills.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

    expect(result.commands.join("\n")).toContain("npx --yes skills@latest add");
    expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
  });
});
