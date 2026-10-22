import { describe, expect, it } from "vitest";

import type { ResultField } from "../contract.js";
import { resultFieldFor, validateAiFields } from "./ai-fields.js";

const schema: Record<string, ResultField> = {
  clear: { type: "boolean" },
  reason: { type: "string" },
  score: { type: "number" },
  risk: { type: "enum", enum: ["low", "high"] },
  tags: { type: "array" },
  question: { type: "string", optional: true },
};

const valid = {
  clear: true,
  reason: "reproducible",
  score: 0.5,
  risk: "low",
  tags: ["a"],
};

describe("validateAiFields", () => {
  it("returns only the declared fields, and null for an optional one left out", () => {
    const result = validateAiFields({ ...valid, stray: "ignored" }, schema);
    expect(result).toEqual({
      ok: true,
      fields: { ...valid, question: null },
    });
  });

  it("keeps an optional field the model did give", () => {
    expect(
      validateAiFields({ ...valid, question: "Which browser?" }, schema),
    ).toMatchObject({
      ok: true,
      fields: { question: "Which browser?" },
    });
  });

  it.each([
    [
      "a missing required field",
      { ...valid, reason: undefined },
      /"reason" is missing/,
    ],
    ["a null required field", { ...valid, clear: null }, /"clear" is missing/],
    ["a boolean given as text", { ...valid, clear: "true" }, /true or false/],
    [
      "blank text for a required string",
      { ...valid, reason: "  " },
      /non-empty text/,
    ],
    ["a number given as text", { ...valid, score: "0.5" }, /a number/],
    ["an infinite number", { ...valid, score: Infinity }, /a number/],
    [
      "a value outside the enum",
      { ...valid, risk: "medium" },
      /one of low, high/,
    ],
    ["a list given as an object", { ...valid, tags: {} }, /a list/],
  ])("rejects %s", (_name, answer, message) => {
    const result = validateAiFields(answer, schema);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(message);
  });

  it.each([null, "prose", 3, ["a"]])(
    "rejects an answer that is %j, not an object",
    (answer) => {
      expect(validateAiFields(answer, schema).ok).toBe(false);
    },
  );
});

describe("resultFieldFor", () => {
  it("maps operation field types to answer fields and refuses json", () => {
    expect(
      resultFieldFor({ name: "a", type: "text", label: "Message" }),
    ).toEqual({
      type: "string",
      description: "Message",
    });
    expect(resultFieldFor({ name: "a", type: "number" })).toEqual({
      type: "number",
    });
    expect(resultFieldFor({ name: "a", type: "boolean" })).toEqual({
      type: "boolean",
    });
    expect(resultFieldFor({ name: "a", type: "enum", enum: ["x"] })).toEqual({
      type: "enum",
      enum: ["x"],
    });
    expect(resultFieldFor({ name: "a", type: "json" })).toBeNull();
  });
});
