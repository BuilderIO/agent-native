import { describe, expect, it } from "vitest";

import action from "./attach-call-evidence.js";

const baseEvidence = {
  recordId: "record-1",
  artifactId: "clip-1",
  sourceUrl: "https://clips.example.test/call/1",
};

describe("attach-call-evidence firewall", () => {
  it("accepts bounded human-readable evidence", () => {
    expect(
      action.schema.safeParse({
        ...baseEvidence,
        quote: "The buyer asked for a proposal before Friday.",
        summary: "Proposal timing is the next commercial step.",
      }).success,
    ).toBe(true);
  });

  it("rejects data URLs, base64-shaped input, and transcript payload markers", () => {
    for (const value of [
      "data:text/plain;base64,SGVsbG8=",
      "A".repeat(260) + "====",
      "Transcript: 00:00 Speaker A: this must not be stored",
    ]) {
      expect(
        action.schema.safeParse({ ...baseEvidence, quote: value }).success,
      ).toBe(false);
      expect(
        action.schema.safeParse({ ...baseEvidence, summary: value }).success,
      ).toBe(false);
    }
  });
});
