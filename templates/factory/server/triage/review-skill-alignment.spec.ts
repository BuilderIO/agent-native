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
    expect(prompt).toContain("@agent-native Fixed, In progress, or");
    expect(prompt).toContain("Clarification needed");
    expect(prompt).toContain("reaction: eyes");
    expect(prompt).toContain("MUST pass");
    expect(prompt).toContain("already has eyes 👀");
    expect(prompt).not.toContain("robot_face");
    expect(prompt).not.toContain("Do not pass reaction eyes");
    expect(prompt).toContain("alreadyClaimed: true");
    expect(prompt).toContain("clearBug` may be");
    expect(prompt).not.toContain("with `clearBug: false`, omit reaction");
    expect(prompt).not.toContain("that action adds 👀");
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
