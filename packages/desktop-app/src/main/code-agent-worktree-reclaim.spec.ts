import { describe, expect, it } from "vitest";

import {
  isPermanentCodeAgentWorktreeReclaimError,
  nextCodeAgentWorktreeReclaimAttempt,
} from "./code-agent-worktree-reclaim.js";

describe("Code Agent worktree reclaim", () => {
  it("recognizes missing Git references as permanently unreclaimable", () => {
    expect(
      isPermanentCodeAgentWorktreeReclaimError(
        new Error(
          "fatal: ambiguous argument 'base..agent-native/run': unknown revision",
        ),
      ),
    ).toBe(true);
    expect(
      isPermanentCodeAgentWorktreeReclaimError(
        new Error("Could not inspect commits in the Code Agent worktree."),
      ),
    ).toBe(false);
  });

  it("backs off retries and caps the delay", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");

    expect(nextCodeAgentWorktreeReclaimAttempt(now, undefined)).toEqual({
      attempts: 1,
      nextAttemptAt: "2026-08-29T12:05:00.000Z",
    });
    expect(nextCodeAgentWorktreeReclaimAttempt(now, 1)).toEqual({
      attempts: 2,
      nextAttemptAt: "2026-08-29T12:10:00.000Z",
    });
    expect(nextCodeAgentWorktreeReclaimAttempt(now, 99)).toEqual({
      attempts: 100,
      nextAttemptAt: "2026-08-30T12:00:00.000Z",
    });
  });
});
