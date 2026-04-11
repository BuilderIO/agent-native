import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readAgentsBundleFromFs,
  parseSkillFrontmatter,
  __resetAgentsBundleCache,
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

describe("parseSkillFrontmatter", () => {
  it("parses simple inline name + description", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: foo\ndescription: hello\n---\nbody",
    );
    expect(meta.name).toBe("foo");
    expect(meta.description).toBe("hello");
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
});
