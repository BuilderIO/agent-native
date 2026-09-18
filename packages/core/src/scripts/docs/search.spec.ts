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

import docsSearchScript from "./search.js";

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

    // readSkillsDir (exercised through readAgentsBundleFromFs) is the
    // load-bearing piece under test: it must read the reference sub-file's
    // *content*, not just its name, into `Skill.files`.
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
});
