import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { FRAMEWORK_CONTEXT_SECTIONS } from "./context-tools.js";

describe("peer-app delegation guidance", () => {
  it("uses the user-need threshold in framework context and the mini-app skill", async () => {
    // source-read-ok: the framework and shared skill must agree on the peer-capability routing contract.
    const skill = await readFile(
      new URL(
        "../../../../../.agents/skills/composable-mini-apps/SKILL.md",
        import.meta.url,
      ),
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
    expect(skill).not.toContain(
      "before building something a sibling may already own",
    );
  });
});
