import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BUILT_IN_APP_MCP } from "./built-in-apps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const coreCli = path.join(repoRoot, "packages", "core", "src", "cli");
const coreWriters = path.join(coreCli, "mcp-config-writers.ts");
const coreSkills = path.join(coreCli, "skills.ts");
const skillsWriters = path.join(here, "mcp-config-writers.ts");

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

describe("skills ↔ core sync", () => {
  it("MCP config writers are code-identical to core's", () => {
    const core = read(coreWriters);
    const skills = read(skillsWriters);
    expect(skills).not.toBeNull();
    if (core === null) {
      return;
    }
    expect(codeOnly(skills as string)).toBe(codeOnly(core));
  });

  it("built-in app MCP descriptors match the URLs/server names in core", () => {
    const core = read(coreSkills);
    if (core === null) return;
    for (const app of BUILT_IN_APP_MCP) {
      expect(
        core.includes(app.mcpUrl),
        `core skills.ts no longer contains mcpUrl ${app.mcpUrl} for ${app.appId}`,
      ).toBe(true);
      expect(
        core.includes(`"${app.serverName}"`),
        `core skills.ts no longer contains serverName "${app.serverName}" for ${app.appId}`,
      ).toBe(true);
      for (const alias of app.aliases ?? []) {
        expect(
          core.includes(`"${alias}"`),
          `core skills.ts no longer contains alias "${alias}" for ${app.appId}`,
        ).toBe(true);
      }
    }
  });
});
