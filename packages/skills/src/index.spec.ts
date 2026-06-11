import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installSkills, parseSkillsCliArgs } from "./index.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-pkg-"));
  tmpRoots.push(root);
  return root;
}

function writeSkill(repo: string, name: string, body = "Body"): void {
  const dir = path.join(repo, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n\n# ${name}\n\n${body}\n`,
    "utf-8",
  );
}

describe("@agent-native/skills", () => {
  it("parses the no-source BuilderIO skills install command", () => {
    const parsed = parseSkillsCliArgs([
      "add",
      "--skill",
      "quick-recap",
      "--client",
      "codex",
      "--scope",
      "project",
      "--update-instructions",
    ]);

    expect(parsed.source).toBeUndefined();
    expect(parsed).toMatchObject({
      command: "add",
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "project",
      updateInstructions: true,
    });
  });

  it("rejects public source arguments outside the BuilderIO skills collection", () => {
    expect(() => parseSkillsCliArgs(["add", "someone/else"])).toThrow(
      "installs the BuilderIO skills collection",
    );
  });

  it("parses compatibility flags used by agent-native core", () => {
    expect(
      parseSkillsCliArgs([
        "add",
        "--copy",
        "./repo",
        "--skill",
        "quick-recap",
        "-a",
        "codex",
        "-g",
        "-y",
      ]),
    ).toMatchObject({
      command: "add",
      copySource: true,
      source: "./repo",
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "user",
      yes: true,
    });
  });

  it("copies selected local skills into project client folders", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-frontier");

    const result = await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["codex", "claude-code"],
      scope: "project",
      baseDir: project,
      updateInstructions: false,
      yes: true,
    });

    expect(result.skills).toEqual(["quick-recap"]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".claude", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "efficient-frontier"),
      ),
    ).toBe(false);
  });

  it("adds an idempotent managed instruction block for quick-recap", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# Existing\n", "utf-8");

    await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      updateInstructions: true,
      yes: true,
    });
    await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      updateInstructions: true,
      yes: true,
    });

    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8");
    expect(agents.match(/BEGIN @agent-native\/skills/g)).toHaveLength(1);
    expect(agents).toContain("Quick Recap Status Block");
    expect(agents).toContain("🟢 Actual concise status sentence");
  });

  it("adds managed limit instructions for stay-within-limits", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "stay-within-limits");

    await installSkills({
      source: repo,
      skillNames: ["stay-within-limits"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      updateInstructions: true,
      yes: true,
    });

    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8");
    expect(agents).toContain("Stay Within Limits");
    expect(agents).toContain("ccusage@latest blocks --active --json");
    expect(agents).toContain("95%");
  });

  it("defaults to user scope when scope is omitted non-interactively", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    const home = path.join(project, "home");
    fs.mkdirSync(home, { recursive: true });
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const result = await installSkills({
        source: repo,
        skillNames: ["quick-recap"],
        clients: ["claude-code"],
        // scope intentionally omitted so resolveSelectedScope picks a default
        baseDir: project,
        updateInstructions: false,
        yes: true,
      });

      expect(result.scope).toBe("user");
      expect(
        fs.existsSync(
          path.join(home, ".claude", "skills", "quick-recap", "SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  it("writes the optional PR Visual Recap workflow when visual-recap is selected", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-recap");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-recap"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      withGithubAction: true,
      yes: true,
    });

    expect(result.githubActionPath).toBe(
      path.join(project, ".github", "workflows", "pr-visual-recap.yml"),
    );
    expect(fs.readFileSync(result.githubActionPath!, "utf-8")).toContain(
      "pr-visual-recap-reusable.yml@main",
    );
  });
});
