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

  it("uses live Content state and sparse patches for corrections", () => {
    expect(skill).toMatch(
      /treat Slack history as identity and\s+intent context, not as the current record state/,
    );
    expect(skill).toMatch(
      /A title captured when the row\s+was created is a historical title/,
    );
    expect(skill).toMatch(
      /read the canonical row from Content immediately before\s+building the update/,
    );
    expect(skill).toMatch(
      /Content is authoritative for every field the correction\s+does not explicitly change/,
    );
    expect(skill).toContain("Build corrections as sparse patches");
    expect(skill).toMatch(
      /"Keep," "preserve,"\s+"leave as is," and "unchanged" are constraints, not new values/,
    );
    expect(skill).toMatch(/omit those\s+fields from the mutation/);
    expect(skill).toMatch(
      /Never reconstruct a full-row update from the original Slack request/,
    );
  });

  it("distinguishes omitted fields from explicit clears and verifies the result", () => {
    expect(skill).toContain("Omission and clearing are different operations");
    expect(skill).toMatch(/An omitted field keeps its\s+live Content value/);
    expect(skill).toMatch(
      /Clear a field only when the user explicitly asks to\s+remove, unset, or clear it/,
    );
    expect(skill).toMatch(
      /requested fields changed, and omitted fields retained their pre-mutation live\s+values/,
    );
    expect(skill).toMatch(
      /report the conflict rather\s+than silently overwriting them/,
    );
  });
});
