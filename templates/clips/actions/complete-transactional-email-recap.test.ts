import { describe, expect, it } from "vitest";

import {
  MAX_RECAP_MODULE_LENGTH,
  validateRecapCopy,
  validateRecapModule,
} from "./complete-transactional-email-recap.js";

const validCopy = {
  heroLine: "9 people watched your clip. 4 agents read it.",
  agentBreakdown: "Claude 3 · ChatGPT 1",
  completionNote: "71% average completion · most stopped at 4:12",
  nextClipSuggestion: "walk through the rollback path you mentioned.",
};

describe("validateRecapModule", () => {
  it("collapses whitespace and keeps the text", () => {
    expect(validateRecapModule("heroLine", "  9 people\n watched.  ")).toBe(
      "9 people watched.",
    );
  });

  it("rejects empty, overlong, and HTML-bearing copy by module name", () => {
    expect(() => validateRecapModule("heroLine", "   ")).toThrow(
      /Hero line must not be empty/,
    );
    expect(() =>
      validateRecapModule(
        "agentBreakdown",
        "x".repeat(MAX_RECAP_MODULE_LENGTH + 1),
      ),
    ).toThrow(/Agent breakdown must be at most/);
    expect(() =>
      validateRecapModule("nextClipSuggestion", "<script>bad()</script>"),
    ).toThrow(/Next clip suggestion must be plain text/);
  });
});

describe("validateRecapCopy", () => {
  it("returns all four normalized modules", () => {
    expect(validateRecapCopy(validCopy)).toEqual(validCopy);
  });

  it("fails the whole copy when any one module is unusable", () => {
    expect(() =>
      validateRecapCopy({ ...validCopy, completionNote: "" }),
    ).toThrow(/Completion note must not be empty/);
  });
});
