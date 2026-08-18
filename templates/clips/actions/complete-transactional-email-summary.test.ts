import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimant: "claimant@example.test",
  completeClaimedAi: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mocks.claimant,
}));
vi.mock("../server/lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    completeClaimedAi: (...args: unknown[]) => mocks.completeClaimedAi(...args),
  },
}));

import action, {
  MAX_TRANSACTIONAL_EMAIL_SUMMARY_LENGTH,
  validateTransactionalEmailSummary,
} from "./complete-transactional-email-summary";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimant = "claimant@example.test";
  mocks.completeClaimedAi.mockResolvedValue({
    logicalKey: "two-clips:recipient@example.test",
    state: "ready",
    generatedSummary: "First Sender and Second Sender shared product updates.",
  });
});

describe("complete-transactional-email-summary", () => {
  it("normalizes whitespace and completes only as the current claimant", async () => {
    await expect(
      action.run({
        jobId: "two-clips:recipient@example.test",
        summary: " First Sender and Second Sender  shared product updates. ",
      }),
    ).resolves.toMatchObject({ state: "ready" });
    expect(mocks.completeClaimedAi).toHaveBeenCalledWith(
      "two-clips:recipient@example.test",
      "claimant@example.test",
      "First Sender and Second Sender shared product updates.",
    );
  });

  it("fails when the store rejects a claimant mismatch", async () => {
    mocks.completeClaimedAi.mockResolvedValue(null);
    await expect(
      action.run({ jobId: "job-1", summary: "One valid sentence." }),
    ).rejects.toThrow("claim is unavailable");
  });

  it("requires one nonempty plain-text sentence of at most 320 characters", () => {
    expect(() => validateTransactionalEmailSummary("   ")).toThrow("nonempty");
    expect(() => validateTransactionalEmailSummary("First. Second.")).toThrow(
      "exactly one",
    );
    expect(() =>
      validateTransactionalEmailSummary("<b>One sentence.</b>"),
    ).toThrow("plain text");
    expect(() =>
      validateTransactionalEmailSummary(
        `${"A".repeat(MAX_TRANSACTIONAL_EMAIL_SUMMARY_LENGTH)}.`,
      ),
    ).toThrow("at most 320");
    expect(validateTransactionalEmailSummary("One valid sentence.")).toBe(
      "One valid sentence.",
    );
  });
});
