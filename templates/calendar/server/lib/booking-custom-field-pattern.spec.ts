/**
 * Booking links let the organizer put a regex on a custom field, and both the
 * booker's browser and the booking handler run it. The same shape that froze
 * the Forms editor tab reaches both here.
 *
 * The handler previously capped the value at 1000 characters and the pattern at
 * 200, which reads like a ReDoS mitigation but is not one: the pattern below is
 * 17 characters and blows up at roughly 40 characters of input, far inside both
 * caps. These assertions are time-bounded so a regression hangs the test rather
 * than passing quietly.
 */
import { testUserRegex } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

const CATASTROPHIC_PATTERN = "^([A-Za-z]+\\s?)+$";
const SAFE_PATTERN = "^\\S+(\\s+\\S+)+$";
const HOSTILE_VALUE = "Jonathan Alexander Montgomery Wellington Smith Junior!";

function withinBudget<T>(budgetMs: number, body: () => T): T {
  const started = Date.now();
  const result = body();
  expect(Date.now() - started).toBeLessThan(budgetMs);
  return result;
}

describe("booking custom field patterns", () => {
  it("refuses a catastrophic pattern instead of running it", () => {
    const result = withinBudget(1000, () =>
      testUserRegex(CATASTROPHIC_PATTERN, HOSTILE_VALUE),
    );
    expect(result.status).toBe("unevaluated");
  });

  it("does not become slower as the value grows", () => {
    // The pre-fix cost doubled with every added character. Anything still
    // exponential cannot clear this budget at 400 characters.
    withinBudget(1000, () => {
      testUserRegex(CATASTROPHIC_PATTERN, "a".repeat(400) + "!");
    });
  });

  it("reports an uncheckable rule distinctly from a failing one", () => {
    // A booking must not be accepted because the rule could not be evaluated,
    // and must not be rejected with a "wrong format" message that blames the
    // booker for the organizer's pattern.
    expect(testUserRegex(CATASTROPHIC_PATTERN, "Ada Lovelace").status).toBe(
      "unevaluated",
    );
    expect(testUserRegex(SAFE_PATTERN, "Ada").status).toBe("no-match");
  });

  it("keeps ordinary organizer patterns working", () => {
    expect(testUserRegex(SAFE_PATTERN, "Ada Lovelace").status).toBe("match");
    expect(testUserRegex("^\\d{3}-\\d{4}$", "555-0100").status).toBe("match");
    expect(testUserRegex("^[A-Z]{2}\\d{4}$", "AB1234").status).toBe("match");
    expect(
      testUserRegex("^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$", "a@b.co")
        .status,
    ).toBe("match");
  });

  it("reports an invalid pattern as uncheckable rather than swallowing it", () => {
    expect(testUserRegex("^[a-", "anything").status).toBe("unevaluated");
  });
});
