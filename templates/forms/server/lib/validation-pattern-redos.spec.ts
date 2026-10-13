import { MAX_USER_REGEX_LENGTH } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import type { FormField } from "../../shared/types.js";
import { publicValidation } from "./public-form-ssr.js";
import { validateSubmissionField } from "./submission-validation.js";
import { assertValidFields } from "./validate-fields.js";

const REPORTED_PATTERN = "^([A-Za-z]+\\s?)+$";

const SAFE_TWO_WORDS = "^\\S+(\\s+\\S+)+$";

const HOSTILE_VALUE = "Jonathan Alexander Montgomery Wellington Smith Junior!";

function fullNameField(pattern: string): FormField {
  return {
    id: "full-name",
    type: "text",
    label: "Full Name",
    required: true,
    validation: { pattern },
  } as FormField;
}

function withinBudget<T>(budgetMs: number, body: () => T): T {
  const started = Date.now();
  const result = body();
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(budgetMs);
  return result;
}

describe("agent-authored validation patterns", () => {
  it("refuses to store the pattern that froze the editor tab", () => {
    withinBudget(1000, () => {
      expect(() =>
        assertValidFields([fullNameField(REPORTED_PATTERN)]),
      ).toThrow(/can hang the browser and the server/i);
    });
  });

  it("names a safe alternative so the agent can fix its own rule", () => {
    let message = "";
    try {
      assertValidFields([fullNameField(REPORTED_PATTERN)]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("at least two words");
    expect(message).toContain("\\S+(\\s+\\S+)+");
  });

  it("still accepts the correct two-word rule and enforces it", () => {
    const field = fullNameField(SAFE_TWO_WORDS);
    expect(() => assertValidFields([field])).not.toThrow();
    expect(validateSubmissionField(field, "Ada Lovelace")).toBeNull();
    expect(validateSubmissionField(field, "Ada")).toBe("Full Name is invalid");
  });

  it("still accepts an ordinary pattern with no repetition ambiguity", () => {
    const field = fullNameField("^[A-Za-z ]{3,64}$");
    expect(() => assertValidFields([field])).not.toThrow();
    expect(validateSubmissionField(field, "Ada Lovelace")).toBeNull();
  });

  it("rejects a syntactically broken pattern with its own message", () => {
    expect(() => assertValidFields([fullNameField("^[a-")])).toThrow(
      /must be a valid regular expression/i,
    );
  });

  it("does not hang the submit handler on a form saved before the gate", () => {
    const error = withinBudget(1000, () =>
      validateSubmissionField(fullNameField(REPORTED_PATTERN), HOSTILE_VALUE),
    );
    expect(error).toMatch(/cannot be checked safely/i);
  });

  it("never reports an unrunnable rule as a passing one", () => {
    const error = validateSubmissionField(
      fullNameField(REPORTED_PATTERN),
      "Ada Lovelace",
    );
    expect(error).not.toBeNull();
  });

  it("does not ship the poisoned pattern to the public form runtime", () => {
    const shipped = withinBudget(1000, () =>
      publicValidation({ pattern: REPORTED_PATTERN }),
    );
    expect(shipped?.pattern).toBeUndefined();
    expect(shipped?.unsafePattern).toBe(true);
  });

  it("ships a safe pattern to the public form runtime unchanged", () => {
    const shipped = publicValidation({ pattern: SAFE_TWO_WORDS });
    expect(shipped?.pattern).toBe(SAFE_TWO_WORDS);
    expect(shipped?.unsafePattern).toBeUndefined();
  });

  it("lets a legacy form reach the field-level reason on submit", () => {
    expect(() =>
      assertValidFields([fullNameField(REPORTED_PATTERN)], {
        patternSafety: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertValidFields([fullNameField("^(unclosed")], {
        patternSafety: false,
      }),
    ).toThrow(/valid regular expression/i);
  });

  it("keeps syntactically valid overlong legacy patterns editable", () => {
    const overlong = "a".repeat(MAX_USER_REGEX_LENGTH + 1);
    expect(() =>
      assertValidFields([fullNameField(overlong)], { patternSafety: false }),
    ).not.toThrow();
    expect(() =>
      assertValidFields([fullNameField(`(${overlong}`)], {
        patternSafety: false,
      }),
    ).toThrow(/valid regular expression/i);
  });

  it("does not fail an optional untouched field over the owner's bad rule", () => {
    const optional = { ...fullNameField(REPORTED_PATTERN), required: false };
    expect(validateSubmissionField(optional, "")).toBeNull();
    expect(validateSubmissionField(optional, undefined)).toBeNull();
  });
});
