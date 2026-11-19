import { describe, expect, it } from "vitest";
import { z } from "zod";

import calibrationFile from "../workflow/stories/02-builder-to-merge/fixtures/judge-calibration.json";
import {
  VERIFICATION_EXCERPT_CHARS,
  summarizeVerification,
} from "./pull-request-evidence.js";

const CATEGORIES = [
  "good-evidence",
  "vague",
  "off-topic",
  "tests-not-named",
  "media-only",
  "prompt-injection",
] as const;

const calibrationCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(CATEGORIES),
  reportTitle: z.string().min(1).max(200),
  reportText: z.string().min(1).max(2_000),
  pullRequestTitle: z.string().min(1).max(300),
  verifiedExcerpt: z.string().max(VERIFICATION_EXCERPT_CHARS),
  hasMedia: z.boolean(),
  expected: z.enum(["verified", "unsure"]),
  note: z.string().min(1).max(200),
});
const calibrationSchema = z.strictObject({
  cases: z.array(calibrationCaseSchema).length(16),
});

const { cases } = calibrationSchema.parse(calibrationFile);

describe("the judge's calibration set", () => {
  it("is 16 labelled cases that fit the schema, each labelled verified or unsure", () => {
    expect(cases).toHaveLength(16);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(16);
    for (const entry of cases) {
      expect(["verified", "unsure"], entry.id).toContain(entry.expected);
    }
  });

  it("rejects a case whose label is neither verified nor unsure, or that has a field it does not know", () => {
    const [first] = cases;

    expect(
      calibrationCaseSchema.safeParse({ ...first, expected: "approved" })
        .success,
    ).toBe(false);
    expect(
      calibrationCaseSchema.safeParse({ ...first, expected: "Verified" })
        .success,
    ).toBe(false);
    expect(
      calibrationCaseSchema.safeParse({ ...first, verdict: "verified" })
        .success,
    ).toBe(false);
    const withoutNote: Record<string, unknown> = { ...first };
    delete withoutNote.note;
    expect(calibrationCaseSchema.safeParse(withoutNote).success).toBe(false);
  });

  it("covers every kind of evidence the judge must tell apart, with four injection attempts that are all unsure", () => {
    const byCategory = (category: (typeof CATEGORIES)[number]) =>
      cases.filter((entry) => entry.category === category);

    for (const category of CATEGORIES) {
      expect(byCategory(category).length, category).toBeGreaterThanOrEqual(2);
    }
    expect(byCategory("prompt-injection")).toHaveLength(4);
    for (const entry of byCategory("prompt-injection")) {
      expect(entry.expected, entry.id).toBe("unsure");
    }
    // Only good evidence earns a verified.
    for (const entry of cases) {
      expect(entry.expected === "verified", entry.id).toBe(
        entry.category === "good-evidence",
      );
    }
  });

  it("holds only cases the merge gate would have let through: a Verified section with text of 20 characters or more, or media", () => {
    for (const entry of cases) {
      const body = [
        "### Verified",
        entry.verifiedExcerpt,
        entry.hasMedia
          ? '<img src="https://images.example.test/shot.png">'
          : "",
      ].join("\n");

      // The excerpt is exactly what github.readPullRequest would return for such a description.
      expect(summarizeVerification(body), entry.id).toEqual({
        present: true,
        hasMedia: entry.hasMedia,
        excerpt: entry.verifiedExcerpt,
      });
    }
  });

  it("gives a media-only case no description the judge could read", () => {
    const mediaOnly = cases.filter((entry) => entry.category === "media-only");

    for (const entry of mediaOnly) {
      expect(entry.hasMedia, entry.id).toBe(true);
      expect(entry.verifiedExcerpt.length, entry.id).toBeLessThan(40);
    }
  });
});
