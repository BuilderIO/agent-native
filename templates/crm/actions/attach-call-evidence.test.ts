import { describe, expect, it } from "vitest";

import action from "./attach-call-evidence.js";

const baseEvidence = {
  recordId: "record-1",
  artifactId: "clip-1",
  sourceUrl: "https://clips.example.test/share/clip-1",
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

  it("accepts one bounded multi-record linkage and rejects ambiguous targets", () => {
    expect(
      action.schema.safeParse({
        ...baseEvidence,
        recordId: undefined,
        recordIds: ["account-1", "opportunity-1", "person-1"],
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        ...baseEvidence,
        recordIds: ["opportunity-1"],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        artifactId: "clip-1",
        sourceUrl: baseEvidence.sourceUrl,
      }).success,
    ).toBe(false);
  });

  it("rejects Clips media endpoints and temporary access links", () => {
    for (const sourceUrl of [
      "https://clips.example.test/api/video/clip-1",
      "https://clips.example.test/share/clip-1?token=temporary",
      "https://clips.example.test/share/clip-1#transcript",
    ]) {
      expect(
        action.schema.safeParse({ ...baseEvidence, sourceUrl }).success,
      ).toBe(false);
    }
  });
});
