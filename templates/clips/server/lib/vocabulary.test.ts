import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({ getDb: () => null, schema: {} }));
vi.mock("./recordings.js", () => ({
  nanoid: () => "id",
  ownerEmailMatches: () => null,
}));

import { mergeVocabulary, vocabularyScope } from "./vocabulary.js";

function row(
  id: string,
  term: string,
  visibility: "private" | "org",
  replacement = term,
) {
  return {
    id,
    term,
    replacement,
    confidence: 1,
    usesCount: 1,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    ownerEmail: "someone@example.test",
    orgId: visibility === "org" ? "org-1" : null,
    visibility,
  };
}

describe("vocabularyScope", () => {
  it("calls org-visible rows team words and everything else personal", () => {
    expect(vocabularyScope({ visibility: "org" })).toBe("team");
    expect(vocabularyScope({ visibility: "private" })).toBe("personal");
    expect(vocabularyScope({ visibility: "public" })).toBe("personal");
  });
});

describe("mergeVocabulary", () => {
  it("lets a personal word win over a team word with the same term", () => {
    const merged = mergeVocabulary([
      row("team-1", "Zoe", "org", "Zoë"),
      row("mine-1", "zoe", "private", "Selene"),
    ]);
    expect(merged.map((entry) => [entry.id, entry.scope])).toEqual([
      ["mine-1", "personal"],
    ]);
  });

  it("keeps team words nobody overrides, and one per term", () => {
    const merged = mergeVocabulary([
      row("team-1", "Ines", "org"),
      row("team-2", "ines", "org"),
      row("team-3", "Priya", "org"),
      row("mine-1", "Agent-Native", "private"),
    ]);
    expect(merged.map((entry) => entry.id)).toEqual([
      "mine-1",
      "team-1",
      "team-3",
    ]);
    expect(merged.find((entry) => entry.id === "team-3")?.scope).toBe("team");
  });
});
