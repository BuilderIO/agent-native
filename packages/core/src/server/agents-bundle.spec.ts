import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  readAgentsBundleFromFs,
  parseSkillFrontmatter,
  generateSkillsPromptBlock,
  generateDevelopmentSkillsPromptBlock,
  getRuntimeSkills,
  getDevelopmentSkills,
  normalizeSkillScope,
  __resetAgentsBundleCache,
  type AgentsBundle,
  type Skill,
  type WorkspaceAgentsSource,
} from "./agents-bundle.js";

function makeTemplate(withSkill: { name: string; description: string } | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bundle-tpl-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Template\nOnly-template");
  if (withSkill) {
    const skillDir = path.join(dir, ".agents", "skills", withSkill.name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${withSkill.name}\ndescription: ${withSkill.description}\n---\nTemplate body`,
    );
  }
  return dir;
}

function makeWorkspaceSource(opts: {
  agentsMd?: string;
  skills?: { name: string; description: string }[];
}): { dir: string; source: WorkspaceAgentsSource } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bundle-ws-"));
  let agentsMdPath: string | null = null;
  if (opts.agentsMd) {
    agentsMdPath = path.join(dir, "AGENTS.md");
    fs.writeFileSync(agentsMdPath, opts.agentsMd);
  }
  let skillsDir: string | null = null;
  if (opts.skills) {
    skillsDir = path.join(dir, "skills");
    for (const s of opts.skills) {
      const sDir = path.join(skillsDir, s.name);
      fs.mkdirSync(sDir, { recursive: true });
      fs.writeFileSync(
        path.join(sDir, "SKILL.md"),
        `---\nname: ${s.name}\ndescription: ${s.description}\n---\nWorkspace body`,
      );
    }
  }
  return {
    dir,
    source: { rootDir: dir, agentsMdPath, skillsDir },
  };
}

function skill(name: string, scope: Skill["meta"]["scope"]): Skill {
  return {
    meta: { name, description: `${name} desc`, scope },
    content: `---\nname: ${name}\n---\nbody`,
    dir: `.agents/skills/${name}`,
    extraFiles: [],
  };
}

function bundleWith(skills: Skill[]): AgentsBundle {
  return {
    agentsMd: "",
    workspaceAgentsMd: "",
    skills: Object.fromEntries(skills.map((s) => [s.meta.name, s])),
  };
}

function repoPath(...segments: string[]): string {
  const fromPackageRoot = path.resolve(process.cwd(), "..", "..", ...segments);
  if (fs.existsSync(fromPackageRoot)) return fromPackageRoot;
  return path.resolve(process.cwd(), ...segments);
}

describe("parseSkillFrontmatter", () => {
  it("parses simple inline name + description", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: foo\ndescription: hello\n---\nbody",
    );
    expect(meta.name).toBe("foo");
    expect(meta.description).toBe("hello");
  });

  it("parses an explicit scope value", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: foo\ndescription: hello\nscope: dev\n---\nbody",
    );
    expect(meta.scope).toBe("dev");
  });

  it("leaves scope undefined when absent (loader applies the default)", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: foo\ndescription: hello\n---\nbody",
    );
    expect(meta.scope).toBeUndefined();
  });

  it("normalizes an unknown scope value to both", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: foo\ndescription: hello\nscope: production\n---\nbody",
    );
    expect(meta.scope).toBe("both");
  });
});

describe("normalizeSkillScope", () => {
  it("accepts the three known values (case-insensitive)", () => {
    expect(normalizeSkillScope("runtime")).toBe("runtime");
    expect(normalizeSkillScope("DEV")).toBe("dev");
    expect(normalizeSkillScope(" Both ")).toBe("both");
  });

  it("falls back to both for empty/unknown values", () => {
    expect(normalizeSkillScope(undefined)).toBe("both");
    expect(normalizeSkillScope("")).toBe("both");
    expect(normalizeSkillScope("nonsense")).toBe("both");
  });
});

describe("skill scope loading", () => {
  beforeEach(() => __resetAgentsBundleCache());
  afterEach(() => __resetAgentsBundleCache());

  it("defaults scope to both when frontmatter omits it", () => {
    const tpl = makeTemplate({ name: "alpha", description: "A skill" });
    try {
      const bundle = readAgentsBundleFromFs(tpl);
      expect(bundle.skills.alpha!.meta.scope).toBe("both");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
    }
  });

  it("reads an explicit scope from SKILL.md frontmatter", () => {
    const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bundle-tpl-"));
    const skillDir = path.join(tpl, ".agents", "skills", "dev-only");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: dev-only\ndescription: Dev only\nscope: dev\n---\nbody",
    );
    try {
      const bundle = readAgentsBundleFromFs(tpl);
      expect(bundle.skills["dev-only"]!.meta.scope).toBe("dev");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
    }
  });
});

describe("getRuntimeSkills", () => {
  it("excludes scope: dev and includes runtime/both", () => {
    const bundle = bundleWith([
      skill("r", "runtime"),
      skill("b", "both"),
      skill("d", "dev"),
    ]);
    const names = getRuntimeSkills(bundle)
      .map((s) => s.meta.name)
      .sort();
    expect(names).toEqual(["b", "r"]);
  });
});

describe("getDevelopmentSkills", () => {
  it("excludes scope: runtime and includes dev/both", () => {
    const bundle = bundleWith([
      skill("r", "runtime"),
      skill("b", "both"),
      skill("d", "dev"),
    ]);
    const names = getDevelopmentSkills(bundle)
      .map((s) => s.meta.name)
      .sort();
    expect(names).toEqual(["b", "d"]);
  });
});

describe("generateSkillsPromptBlock scope filtering", () => {
  it("omits scope: dev skills from the prompt block", () => {
    const bundle = bundleWith([
      skill("runtime-one", "both"),
      skill("dev-one", "dev"),
    ]);
    const block = generateSkillsPromptBlock(bundle);
    expect(block).toContain("runtime-one");
    expect(block).not.toContain("dev-one");
    expect(block).toContain('docs-search --slug "skill-runtime-one"');
    expect(block).not.toContain('bash(command="cat <skill-dir>/SKILL.md")');
  });

  it("returns empty string when every skill is dev-scoped", () => {
    const bundle = bundleWith([skill("dev-one", "dev")]);
    expect(generateSkillsPromptBlock(bundle)).toBe("");
  });
});

describe("generateDevelopmentSkillsPromptBlock scope filtering", () => {
  it("omits scope: runtime skills from the coding-agent prompt block", () => {
    const bundle = bundleWith([
      skill("runtime-one", "runtime"),
      skill("dev-one", "dev"),
      skill("shared-one", "both"),
    ]);
    const block = generateDevelopmentSkillsPromptBlock(bundle);
    expect(block).toContain("dev-one");
    expect(block).toContain("shared-one");
    expect(block).not.toContain("runtime-one");
    expect(block).toContain('bash(command="cat <skill-dir>/SKILL.md")');
    expect(block).not.toContain('docs-search --slug "skill-dev-one"');
  });
});

describe("readAgentsBundleFromFs", () => {
  beforeEach(() => __resetAgentsBundleCache());
  afterEach(() => __resetAgentsBundleCache());

  it("returns template-only bundle when no workspace source is provided", () => {
    const tpl = makeTemplate({ name: "alpha", description: "A skill" });
    try {
      const bundle = readAgentsBundleFromFs(tpl);
      expect(bundle.agentsMd).toContain("Only-template");
      expect(bundle.workspaceAgentsMd).toBe("");
      expect(bundle.skills.alpha).toBeDefined();
      expect(bundle.skills.alpha!.meta.description).toBe("A skill");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
    }
  });

  it("accepts legacy .agent/skills as a codebase skills directory", () => {
    const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bundle-tpl-"));
    const skillDir = path.join(tpl, ".agent", "skills", "runtime");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: runtime\ndescription: Runtime skill\n---\nRuntime body",
    );

    try {
      const bundle = readAgentsBundleFromFs(tpl);
      expect(bundle.skills.runtime).toBeDefined();
      expect(bundle.skills.runtime!.dir).toBe(".agent/skills/runtime");
      expect(bundle.skills.runtime!.content).toContain("Runtime body");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
    }
  });

  it("keeps .agents/skills canonical when legacy .agent/skills has the same skill", () => {
    const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bundle-tpl-"));
    const canonical = path.join(tpl, ".agents", "skills", "policy");
    const legacy = path.join(tpl, ".agent", "skills", "policy");
    fs.mkdirSync(canonical, { recursive: true });
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(canonical, "SKILL.md"),
      "---\nname: policy\ndescription: Canonical\n---\nCanonical body",
    );
    fs.writeFileSync(
      path.join(legacy, "SKILL.md"),
      "---\nname: policy\ndescription: Legacy\n---\nLegacy body",
    );

    try {
      const bundle = readAgentsBundleFromFs(tpl);
      expect(bundle.skills.policy!.meta.description).toBe("Canonical");
      expect(bundle.skills.policy!.dir).toBe(".agents/skills/policy");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
    }
  });

  it("adds workspace AGENTS.md when provided", () => {
    const tpl = makeTemplate(null);
    const ws = makeWorkspaceSource({ agentsMd: "# Workspace wide" });
    try {
      const bundle = readAgentsBundleFromFs(tpl, ws.source);
      expect(bundle.workspaceAgentsMd).toContain("Workspace wide");
      expect(bundle.agentsMd).toContain("Only-template");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
      fs.rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  it("merges workspace-only skills into the bundle", () => {
    const tpl = makeTemplate(null);
    const ws = makeWorkspaceSource({
      skills: [{ name: "policy", description: "Enterprise-wide policy" }],
    });
    try {
      const bundle = readAgentsBundleFromFs(tpl, ws.source);
      expect(bundle.skills.policy).toBeDefined();
      expect(bundle.skills.policy!.meta.description).toBe(
        "Enterprise-wide policy",
      );
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
      fs.rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  it("template skill overrides workspace skill with the same name", () => {
    const tpl = makeTemplate({
      name: "policy",
      description: "TEMPLATE VERSION",
    });
    const ws = makeWorkspaceSource({
      skills: [{ name: "policy", description: "WORKSPACE VERSION" }],
    });
    try {
      const bundle = readAgentsBundleFromFs(tpl, ws.source);
      // Template wins on name collision.
      expect(bundle.skills.policy!.meta.description).toBe("TEMPLATE VERSION");
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
      fs.rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  it("includes both when they have different names", () => {
    const tpl = makeTemplate({
      name: "deck-management",
      description: "template skill",
    });
    const ws = makeWorkspaceSource({
      skills: [{ name: "policy", description: "workspace skill" }],
    });
    try {
      const bundle = readAgentsBundleFromFs(tpl, ws.source);
      expect(bundle.skills["deck-management"]).toBeDefined();
      expect(bundle.skills.policy).toBeDefined();
      expect(Object.keys(bundle.skills).sort()).toEqual([
        "deck-management",
        "policy",
      ]);
    } finally {
      fs.rmSync(tpl, { recursive: true, force: true });
      fs.rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  it("loads Design template runtime skills with usable trigger descriptions", () => {
    const bundle = readAgentsBundleFromFs(repoPath("templates", "design"));
    const runtimeSkills = getRuntimeSkills(bundle);
    const expected = [
      "design-generation",
      "design-systems",
      "export-handoff",
      "visual-edit",
    ];

    for (const name of expected) {
      const skill = runtimeSkills.find((candidate) => {
        return candidate.meta.name === name;
      });
      expect(skill, `expected runtime skill ${name}`).toBeDefined();
      expect(skill!.meta.description.trim()).toContain("Use when");
    }

    const promptBlock = generateSkillsPromptBlock(bundle);
    expect(promptBlock).toContain("Generate or refine complete interactive");
    expect(promptBlock).toContain("Export Design work");
    expect(promptBlock).toContain(
      'docs-search --slug "skill-design-generation"',
    );
    expect(promptBlock).toContain('docs-search --slug "skill-visual-edit"');
  });
});
