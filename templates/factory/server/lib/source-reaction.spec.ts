import { describe, expect, it } from "vitest";

import {
  githubIssueReaction,
  parseOptionalReaction,
} from "./source-reaction.js";

describe("source-reaction", () => {
  it("treats blank reaction as omit", () => {
    expect(parseOptionalReaction(undefined)).toBeNull();
    expect(parseOptionalReaction("")).toBeNull();
    expect(parseOptionalReaction("  :  ")).toBeNull();
  });

  it("normalizes Slack emoji names", () => {
    expect(parseOptionalReaction(":robot_face:")).toBe("robot_face");
    expect(parseOptionalReaction("Eyes")).toBe("eyes");
  });

  it("rejects names Slack and GitHub cannot take", () => {
    expect(() => parseOptionalReaction("robot face")).toThrow(/emoji name/);
    expect(() => parseOptionalReaction("👀")).toThrow(/emoji name/);
  });

  it("maps only GitHub's reaction set", () => {
    expect(githubIssueReaction("eyes")).toBe("eyes");
    expect(githubIssueReaction("+1")).toBe("+1");
    expect(githubIssueReaction("robot_face")).toBeNull();
    expect(githubIssueReaction(null)).toBeNull();
  });
});
