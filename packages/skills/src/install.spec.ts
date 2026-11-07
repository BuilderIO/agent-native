import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGED_BLOCK_START,
  discoverSkillFolders,
  installSkills,
  parseGitHubSource,
  parseSkillsCliArgs,
  targetRootsFor,
  upsertManagedBlock,
} from "./install.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-test-"));
  tmpRoots.push(root);
  return root;
}

function writeSkill(root: string, name: string, body = "Body") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`,
    "utf-8",
  );
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(path.join(dir, "references", "notes.md"), body, "utf-8");
  return dir;
}

describe("@agent-native/skills", () => {
  it("parses add defaults and instruction aliases", () => {
    expect(
      parseSkillsCliArgs([
        "add",
        "./skills",
        "--skill",
        "one,two",
        "--agent",
        "all",
        "--scope",
        "project",
        "--instructions",
        "both",
      ]),
    ).toMatchObject({
      command: "add",
      source: "./skills",
      skills: ["one", "two"],
      agents: ["codex", "claude"],
      scope: "project",
      instructionTargets: ["agents", "claude"],
    });
  });

  it("parses GitHub repo-style sources", () => {
    expect(parseGitHubSource("BuilderIO/agent-native/skills#main")).toEqual({
      cloneUrl: "https://github.com/BuilderIO/agent-native.git",
      ref: "main",
      subdir: "skills",
      display: "github:BuilderIO/agent-native/skills#main",
    });
    expect(
      parseGitHubSource(
        "https://github.com/BuilderIO/agent-native/tree/main/packages/skills",
      ),
    ).toMatchObject({
      cloneUrl: "https://github.com/BuilderIO/agent-native.git",
      ref: "main",
      subdir: "packages/skills",
    });
  });

  it("discovers skills from common containers and single skill folders", () => {
    const root = tmpDir();
    writeSkill(path.join(root, "skills"), "alpha");
    writeSkill(path.join(root, ".agents", "skills"), "beta");
    writeSkill(path.join(root, ".claude", "skills"), "gamma");

    expect(discoverSkillFolders(root).map((skill) => skill.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(discoverSkillFolders(path.join(root, "skills", "alpha"))).toEqual([
      expect.objectContaining({ name: "alpha" }),
    ]);
  });

  it("resolves Codex and Claude target roots", () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex");

    expect(
      targetRootsFor({
        agents: ["codex", "claude"],
        scope: "project",
        projectDir: root,
        env: { HOME: home, CODEX_HOME: codexHome },
      }),
    ).toEqual([
      {
        agent: "codex",
        scope: "project",
        root: path.join(root, ".agents", "skills"),
      },
      {
        agent: "claude",
        scope: "project",
        root: path.join(root, ".claude", "skills"),
      },
    ]);

    expect(
      targetRootsFor({
        agents: ["codex", "claude"],
        scope: "user",
        projectDir: root,
        env: { HOME: home, CODEX_HOME: codexHome },
      }),
    ).toEqual([
      { agent: "codex", scope: "user", root: path.join(codexHome, "skills") },
      {
        agent: "claude",
        scope: "user",
        root: path.join(home, ".claude", "skills"),
      },
    ]);
  });

  it("installs selected skills into project agent directories", async () => {
    const root = tmpDir();
    const source = path.join(root, "source");
    const project = path.join(root, "project");
    writeSkill(path.join(source, "skills"), "alpha", "Alpha body");
    writeSkill(path.join(source, "skills"), "beta", "Beta body");

    const result = await installSkills(
      parseSkillsCliArgs(
        [
          "add",
          source,
          "--skill",
          "beta",
          "--agent",
          "all",
          "--scope",
          "project",
          "--project",
          project,
          "--instructions",
          "both",
        ],
        root,
      ),
      { isInteractive: () => false },
    );

    expect(result.skills).toEqual(["beta"]);
    expect(
      fs.readFileSync(
        path.join(project, ".agents", "skills", "beta", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("Beta body");
    expect(
      fs.readFileSync(
        path.join(
          project,
          ".claude",
          "skills",
          "beta",
          "references",
          "notes.md",
        ),
        "utf-8",
      ),
    ).toBe("Beta body");
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8")).toContain(
      MANAGED_BLOCK_START,
    );
    expect(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf-8")).toContain(
      "`beta`",
    );
  });

  it("copies linked folders inside a skill as files", async () => {
    const root = tmpDir();
    const source = path.join(root, "source");
    const project = path.join(root, "project");
    const sharedReferences = path.join(source, "shared", "references");
    const skill = writeSkill(path.join(source, "skills"), "beta");
    fs.rmSync(path.join(skill, "references"), { recursive: true });
    fs.mkdirSync(sharedReferences, { recursive: true });
    fs.writeFileSync(path.join(sharedReferences, "notes.md"), "Notes", "utf-8");
    fs.symlinkSync(
      sharedReferences,
      path.join(skill, "references"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await installSkills(
      parseSkillsCliArgs(
        [
          "add",
          source,
          "--skill",
          "beta",
          "--agent",
          "codex",
          "--scope",
          "project",
          "--project",
          project,
          "--instructions",
          "none",
        ],
        root,
      ),
      { isInteractive: () => false },
    );

    const references = path.join(
      project,
      ".agents",
      "skills",
      "beta",
      "references",
    );
    expect(fs.lstatSync(references).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(references, "notes.md"), "utf-8")).toBe(
      "Notes",
    );
  });

  it("leaves out links that point outside the source or nowhere", async () => {
    const root = tmpDir();
    const source = path.join(root, "source");
    const project = path.join(root, "project");
    const outside = path.join(root, "outside");
    const gone = path.join(root, "gone");
    const skill = writeSkill(path.join(source, "skills"), "beta");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "private.txt"), "private", "utf-8");
    fs.mkdirSync(gone, { recursive: true });
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(outside, path.join(skill, "outside"), linkType);
    fs.symlinkSync(gone, path.join(skill, "gone"), linkType);
    fs.rmSync(gone, { recursive: true });

    await installSkills(
      parseSkillsCliArgs(
        [
          "add",
          source,
          "--skill",
          "beta",
          "--agent",
          "codex",
          "--scope",
          "project",
          "--project",
          project,
          "--instructions",
          "none",
        ],
        root,
      ),
      { isInteractive: () => false },
    );

    const installed = path.join(project, ".agents", "skills", "beta");
    expect(fs.existsSync(path.join(installed, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(installed, "outside"))).toBe(false);
    expect(
      fs.lstatSync(path.join(installed, "gone"), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });

  it("prompts for skills when no explicit selection is provided", async () => {
    const root = tmpDir();
    const source = path.join(root, "source");
    const project = path.join(root, "project");
    writeSkill(path.join(source, "skills"), "alpha");
    writeSkill(path.join(source, "skills"), "beta");

    const result = await installSkills(
      parseSkillsCliArgs(
        [
          "add",
          source,
          "--agent",
          "codex",
          "--scope",
          "project",
          "--project",
          project,
        ],
        root,
      ),
      {
        isInteractive: () => true,
        promptSkills: async () => ["alpha"],
      },
    );

    expect(result.skills).toEqual(["alpha"]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "alpha", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "beta", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("refuses non-interactive ambiguous installs without --all or --skill", async () => {
    const root = tmpDir();
    const source = path.join(root, "source");
    writeSkill(path.join(source, "skills"), "alpha");
    writeSkill(path.join(source, "skills"), "beta");

    await expect(
      installSkills(parseSkillsCliArgs(["add", source], root), {
        isInteractive: () => false,
      }),
    ).rejects.toThrow("Multiple skills found");
  });

  it("upserts managed instruction blocks idempotently", () => {
    const root = tmpDir();
    const file = path.join(root, "AGENTS.md");
    fs.writeFileSync(file, "# Project\n", "utf-8");

    const first = `${MANAGED_BLOCK_START}\nfirst\n<!-- END @agent-native/skills managed block -->\n`;
    const second = `${MANAGED_BLOCK_START}\nsecond\n<!-- END @agent-native/skills managed block -->\n`;

    expect(upsertManagedBlock(file, first)).toBe(true);
    expect(upsertManagedBlock(file, second)).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content.match(new RegExp(MANAGED_BLOCK_START, "g"))).toHaveLength(1);
    expect(content).toContain("second");
    expect(content).not.toContain("first");
  });

  it("collapses pre-existing duplicate managed blocks into a single one", () => {
    const root = tmpDir();
    const file = path.join(root, "AGENTS.md");
    const dup = `${MANAGED_BLOCK_START}\nfirst\n<!-- END @agent-native/skills managed block -->\n`;
    fs.writeFileSync(file, `# Project\n\n${dup}\n${dup}`, "utf-8");

    const next = `${MANAGED_BLOCK_START}\nthird\n<!-- END @agent-native/skills managed block -->\n`;
    expect(upsertManagedBlock(file, next)).toBe(true);

    const content = fs.readFileSync(file, "utf-8");
    expect(content.match(new RegExp(MANAGED_BLOCK_START, "g"))).toHaveLength(1);
    expect(content).toContain("third");
    expect(content).not.toContain("first");
    expect(content).toContain("# Project");
  });
});
