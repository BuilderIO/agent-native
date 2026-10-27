import { describe, expect, it } from "vitest";

import {
  managedReviewSkillAlignmentMarkers,
  syncManagedReviewSkillAlignment,
} from "./review-skill-alignment.js";

describe("Factory review skill alignment", () => {
  it("adds the current review contract without replacing custom prompt text", () => {
    const prompt = syncManagedReviewSkillAlignment(
      "Custom operator instruction.",
      "factory-pr-governance",
    );
    const markers = managedReviewSkillAlignmentMarkers();

    expect(prompt).toContain("Custom operator instruction.");
    expect(prompt).toContain("ultra-scary gate");
    expect(prompt.indexOf(markers.start)).toBeGreaterThan(-1);
    expect(prompt.indexOf(markers.end)).toBeGreaterThan(
      prompt.indexOf(markers.start),
    );
  });

  it("replaces only the managed block when a skill contract changes", () => {
    const first = syncManagedReviewSkillAlignment(
      "Keep this prompt.",
      "factory-pr-governance",
    );
    const second = syncManagedReviewSkillAlignment(
      `${first.replace("current review-prs contract", "old contract")}\nCustom suffix.`,
      "factory-pr-governance",
    );

    expect(second).toContain("Keep this prompt.");
    expect(second).toContain("Custom suffix.");
    expect(second).toContain("Alice (`3mdistal`)");
    expect(second).toContain("Shomix (shomix, GitHub user ID 100691266)");
    expect(second).toMatch(
      /Match both the login\s+and immutable GitHub author ID/,
    );
    expect(second).toMatch(/across app and\s+framework areas/);
    expect(second).toContain("independent human review");
    expect(second).toContain("MCP iframe sandboxing, CSP, HTML sanitization");
    expect(second).not.toContain("old contract");
  });
});
