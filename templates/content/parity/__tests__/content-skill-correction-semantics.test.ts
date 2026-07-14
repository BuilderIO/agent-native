import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const skillPath = new URL(
  "../../.agents/skills/content/SKILL.md",
  import.meta.url,
);

describe("Content skill correction semantics", () => {
  const skill = readFileSync(skillPath, "utf8");

  it("preserves artifact identity and distinguishes follow-up intents", () => {
    expect(skill).toContain(
      "inspect the prior Content artifact identity first",
    );
    expect(skill).toContain("preserve the stable Content document ID");
    expect(skill).toContain("**Update**");
    expect(skill).toContain("**Add**");
    expect(skill).toContain("**Supersede**");
    expect(skill).toContain("**Create**");
    expect(skill).toContain("Do not blindly submit another row");
  });

  it("keeps requester and assignee identity distinct and resolved", () => {
    expect(skill).toMatch(/default it to the verified Slack\s+sender/);
    expect(skill).toMatch(/such as "for Apoorva" maps to `Assignee`/);
    expect(skill).toContain(
      "Naming an assignee never changes or replaces `Requester`",
    );
    expect(skill).toContain(
      "never omit, downgrade, or silently drop the person",
    );
  });
});
