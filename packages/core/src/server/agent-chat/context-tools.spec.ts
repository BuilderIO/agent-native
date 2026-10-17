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
      "unless the current app has its own generation action that already delegates there",
    );
    expect(skill).toContain(
      "requested outcome depends on peer-exclusive data or capability",
    );
    expect(skill).toContain("whether a known peer can provide it");
    expect(skill).not.toContain(
      "before building something a sibling may already own",
    );
  });
});
