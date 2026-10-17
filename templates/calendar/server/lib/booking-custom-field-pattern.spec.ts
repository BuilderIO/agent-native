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
    withinBudget(1000, () => {
      testUserRegex(CATASTROPHIC_PATTERN, "a".repeat(400) + "!");
    });
  });

  it("reports an uncheckable rule distinctly from a failing one", () => {
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
