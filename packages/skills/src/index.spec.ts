import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runSkills as runCoreSkills } from "@agent-native/core/cli/skills";

import { installSkills, parseSkillsCliArgs, runSkillsCli } from "./index.js";

vi.mock("@agent-native/core/cli/skills", () => ({
  runSkills: vi.fn(async () => {}),
}));

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
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

  it("installs every plain source skill directly when no skill is explicit", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-fable");
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--client",
          "codex",
          "--scope",
          "project",
          "--yes",
          "--json",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(runCoreSkills).not.toHaveBeenCalled();
    const result = JSON.parse(stdout.join(""));
    expect(result.skills).toEqual(["efficient-fable", "quick-recap"]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "efficient-fable", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("lists plain source skills directly instead of delegating to core", async () => {
    const repo = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-fable");
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;

    try {
      await runSkillsCli(["list", "--copy", repo, "--json"], {
        isInteractive: () => false,
      });
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(runCoreSkills).not.toHaveBeenCalled();
    const skills = JSON.parse(stdout.join(""));
    expect(skills.map((skill: { name: string }) => skill.name)).toEqual([
      "efficient-fable",
      "quick-recap",
    ]);
  });

  it("defaults to all supported clients when clients are omitted", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");

    const result = await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      scope: "project",
      baseDir: project,
      updateInstructions: false,
      yes: true,
    });

    expect(result.clients).toEqual(["codex", "claude-code"]);
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
