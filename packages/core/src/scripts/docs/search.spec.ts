import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readAgentsBundleFromFs,
  skillSubfileDocsSlug,
  type AgentsBundle,
} from "../../server/agents-bundle.js";
import { captureCliOutput } from "../../server/cli-capture.js";

const mocks = vi.hoisted(() => ({
  loadAgentsBundle: vi.fn<() => Promise<AgentsBundle>>(),
  getUserLabs: vi.fn(),
}));

vi.mock("../../labs/store.js", () => ({
  getUserLabs: (...args: unknown[]) => mocks.getUserLabs(...args),
}));

vi.mock("../../server/agents-bundle.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/agents-bundle.js")
  >("../../server/agents-bundle.js");
  return {
    ...actual,
    loadAgentsBundle: (...args: unknown[]) =>
      mocks.loadAgentsBundle(...(args as [])),
  };
});

import docsSearchScript, { loadAllDocs } from "./search.js";

function runDocsSearch(args: string[]): Promise<string> {
  return captureCliOutput(() => docsSearchScript(args));
}

describe("docs-search: skill reference sub-files are reachable end-to-end", () => {
  let tplDir: string;

  beforeEach(() => {
    tplDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-search-refs-"));
    const skillDir = path.join(tplDir, ".agents", "skills", "recap-tools");
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: recap-tools",
        "description: Tools for building recaps",
        "scope: runtime",
        "---",
        "# Recap Tools\n\nSee the canvas reference for details.",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(skillDir, "references", "canvas.md"),
      "CANVAS_REFERENCE_TOKEN: this is the reference sub-file body.",
    );

    const bundle = readAgentsBundleFromFs(tplDir);
    mocks.loadAgentsBundle.mockResolvedValue(bundle);
  });

  afterEach(() => {
    fs.rmSync(tplDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("populates Skill.files with the reference sub-file content", () => {
    const bundle = readAgentsBundleFromFs(tplDir);
    const skill = bundle.skills["recap-tools"];
    expect(skill).toBeDefined();
    expect(skill!.extraFiles).toEqual(["references/canvas.md"]);
    expect(skill!.files["references/canvas.md"]).toContain(
      "CANVAS_REFERENCE_TOKEN",
    );
  });

  it("resolves the sub-file by its docs-search slug", async () => {
    const slug = skillSubfileDocsSlug("recap-tools", "references/canvas.md");
    expect(slug).toBe("skill-recap-tools--references-canvas");

    const output = await runDocsSearch(["--slug", slug]);
    expect(output).toContain("CANVAS_REFERENCE_TOKEN");
    expect(output).toContain("recap-tools");
  });

  it("matches the sub-file by --query on its body content", async () => {
    const output = await runDocsSearch(["--query", "CANVAS_REFERENCE_TOKEN"]);
    expect(output).toContain("skill-recap-tools--references-canvas");
  });

  it("lists the sub-file doc alongside the skill's main doc", async () => {
    const output = await runDocsSearch(["--list"]);
    const listing = JSON.parse(output) as { slug: string }[];
    const slugs = listing.map((d) => d.slug);
    expect(slugs).toContain("skill-recap-tools");
    expect(slugs).toContain("skill-recap-tools--references-canvas");
  });

  it("hides Lab-gated skills from docs-search for disabled users", async () => {
    const gatedSkillDir = path.join(
      tplDir,
      ".agents",
      "skills",
      "creative-context",
    );
    fs.mkdirSync(gatedSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(gatedSkillDir, "SKILL.md"),
      [
        "---",
        "name: creative-context",
        "description: Reuse Creative Context packs",
        "scope: both",
        "requires-lab: content.creative-context",
        "---",
        "CREATIVE_CONTEXT_SKILL_BODY",
      ].join("\n"),
    );
    mocks.loadAgentsBundle.mockResolvedValue(readAgentsBundleFromFs(tplDir));
    mocks.getUserLabs.mockImplementation(async (email: string) =>
      email === "enabled@example.test"
        ? { "content.creative-context": true }
        : { "content.creative-context": false },
    );

    const disabledDocs = await loadAllDocs("disabled@example.test");
    const enabledDocs = await loadAllDocs("enabled@example.test");

    expect(disabledDocs.map((doc) => doc.slug)).not.toContain(
      "skill-creative-context",
    );
    expect(enabledDocs.map((doc) => doc.slug)).toContain(
      "skill-creative-context",
    );
    expect(mocks.getUserLabs.mock.calls.map(([email]) => email)).toEqual([
      "disabled@example.test",
      "enabled@example.test",
    ]);
  });

  it("surfaces unreadable Labs state instead of treating it as disabled", async () => {
    const gatedSkillDir = path.join(
      tplDir,
      ".agents",
      "skills",
      "creative-context",
    );
    fs.mkdirSync(gatedSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(gatedSkillDir, "SKILL.md"),
      "---\nname: creative-context\nrequires-lab: content.creative-context\n---\nbody",
    );
    mocks.loadAgentsBundle.mockResolvedValue(readAgentsBundleFromFs(tplDir));
    mocks.getUserLabs.mockRejectedValue(new Error("Labs settings unavailable"));

    await expect(loadAllDocs("user@example.test")).rejects.toThrow(
      "Labs settings unavailable",
    );
  });
});
