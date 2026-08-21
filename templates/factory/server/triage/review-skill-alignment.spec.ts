import { describe, expect, it } from "vitest";

import {
  managedReviewSkillAlignment,
  managedReviewSkillAlignmentMarkers,
  syncManagedReviewSkillAlignment,
} from "./review-skill-alignment.js";

describe("Factory review skill alignment", () => {
  it("adds the current feedback contract without replacing custom prompt text", () => {
    const prompt = syncManagedReviewSkillAlignment(
      "Custom operator instruction.",
      "factory-slack-feedback",
    );
    const markers = managedReviewSkillAlignmentMarkers();

    expect(prompt).toContain("Custom operator instruction.");
    expect(prompt).toContain("answered clarifications");
    expect(prompt).toContain(
      "@agent-native Fixed, In progress, or Clarification needed",
    );
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
    expect(second).not.toContain("old contract");
  });

  it("does not add a review contract to the PR babysitter", () => {
    expect(managedReviewSkillAlignment("factory-pr-babysit")).toBeUndefined();
  });
});
