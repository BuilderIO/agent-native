import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  firstSchemaMessage,
  isLibraryDefaultMessage,
} from "./schema-message.js";

const FALLBACK = "Please fix the errors in the form before saving.";

const messageFor = (schema: z.ZodType, value: unknown): string => {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected a rejection");
  return firstSchemaMessage(parsed.error.issues, FALLBACK);
};

describe("schema messages", () => {
  it("replaces every library default a rule can produce with the fallback", () => {
    // The exact Zod 4 texts that reached the screen in five apps.
    expect(messageFor(z.string().max(100), "x".repeat(101))).toBe(FALLBACK);
    expect(messageFor(z.string().min(1), "")).toBe(FALLBACK);
    expect(messageFor(z.string().trim().min(1), "  ")).toBe(FALLBACK);
    expect(
      messageFor(z.array(z.string()).max(4), ["a", "b", "c", "d", "e"]),
    ).toBe(FALLBACK);
    expect(messageFor(z.number().int().positive(), -1)).toBe(FALLBACK);
    expect(messageFor(z.enum(["a", "b"]), "c")).toBe(FALLBACK);
    expect(messageFor(z.object({ code: z.string() }), { code: 1 })).toBe(
      FALLBACK,
    );
  });

  it("keeps a message the schema author wrote", () => {
    expect(messageFor(z.string().min(1, "Agent name is required."), "")).toBe(
      "Agent name is required.",
    );
    // A rule that merely starts with a word the guard uses is still our copy when
    // it reads as a sentence, not as a library shape.
    expect(
      messageFor(z.string().min(3, "Pick at least 3 characters"), "ab"),
    ).toBe("Pick at least 3 characters");
  });

  it("answers the fallback for no issues at all", () => {
    expect(firstSchemaMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(firstSchemaMessage([], FALLBACK)).toBe(FALLBACK);
    expect(firstSchemaMessage([{ message: "   " }], FALLBACK)).toBe(FALLBACK);
  });

  it("classifies library text without the fallback", () => {
    expect(
      isLibraryDefaultMessage(
        "Too small: expected string to have >=1 characters",
      ),
    ).toBe(true);
    expect(isLibraryDefaultMessage("Channel Name is required")).toBe(false);
    expect(isLibraryDefaultMessage("")).toBe(true);
  });
});
