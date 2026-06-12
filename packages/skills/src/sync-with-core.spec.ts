/**
 * Drift guard: the standalone `@agent-native/skills` installer and
 * `@agent-native/core` must agree on (a) how MCP config is written to disk and
 * (b) which hosted MCP server each built-in app's skills connect to. The two
 * packages keep their own copies (skills ships standalone and can't depend on
 * the heavyweight core), so this test fails CI if the copies diverge.
 *
 * It reads core's source as TEXT (no cross-package import — core may be
 * unbuilt when this runs). When core's source isn't present (e.g. the package
 * is consumed outside the monorepo), the guards skip rather than fail.
 */
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

/** Strip block + whole-line comments and collapse whitespace, leaving code. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments / JSDoc
    .replace(/^\s*\/\/.*$/gm, "") // whole-line // comments
    .replace(/[ \t]+$/gm, "") // trailing whitespace
    .replace(/\n{2,}/g, "\n") // collapse blank lines
    .trim();
}

describe("skills ↔ core sync", () => {
  it("MCP config writers are code-identical to core's", () => {
    const core = read(coreWriters);
    const skills = read(skillsWriters);
    expect(skills).not.toBeNull();
    if (core === null) {
      // Outside the monorepo — nothing to compare against.
      return;
    }
    expect(codeOnly(skills as string)).toBe(codeOnly(core));
  });

  it("built-in app MCP descriptors match the URLs/server names in core", () => {
    const core = read(coreSkills);
    if (core === null) return; // outside the monorepo
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
