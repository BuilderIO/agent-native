import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FRAMEWORK_CONTEXT_SECTIONS } from "./context-tools.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

describe("peer-app delegation guidance", () => {
  it("uses the user-need threshold in framework context and the mini-app skill", async () => {
    const skill = await readFile(
      path.join(repoRoot, ".agents/skills/composable-mini-apps/SKILL.md"),
      "utf8",
    );

    expect(FRAMEWORK_CONTEXT_SECTIONS["call-agent"]).toContain(
      "The requested outcome depends on data or a capability only another deployed app can provide",
    );
    expect(FRAMEWORK_CONTEXT_SECTIONS["call-agent"]).toContain(
      "only when the user asks for its brand library or an asset/capability only Assets can provide",
    );
    expect(FRAMEWORK_CONTEXT_SECTIONS["call-agent"]).toContain(
      "Ordinary image generation stays in the current app.",
    );
    expect(skill).toContain(
      "requested outcome depends on peer-exclusive data or capability",
    );
    expect(skill).toContain("whether a known peer can provide it");
    expect(skill).toContain(
      "with its full input shown by `describe-workspace-apps`",
    );
    expect(skill).toContain(
      "never switch to a guessed direct call after a\n  message or direct call fails",
    );
    expect(FRAMEWORK_CONTEXT_SECTIONS["call-agent"]).toContain(
      "never switch to a direct action to work around a slow or failed message",
    );
    expect(skill).not.toContain(
      "before building something a sibling may already own",
    );
  });

  it("keeps every routing skill on the tool-first, full-input rule", async () => {
    for (const name of ["composable-mini-apps", "a2a-protocol"]) {
      const skill = await readFile(
        path.join(repoRoot, `.agents/skills/${name}/SKILL.md`),
        "utf8",
      );
      expect(skill, name).toContain("describe-workspace-apps");
      expect(skill, name).not.toContain(
        "Natural-language delegation is the default",
      );
      expect(skill, name).not.toContain(
        "Send a natural-language objective by default",
      );
      expect(skill, name).not.toContain("not an agent-performance shortcut");
    }
  });
});
