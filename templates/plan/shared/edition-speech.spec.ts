import { describe, expect, it } from "vitest";

import { buildEditionSpeech, chunkEditionSpeech } from "./edition-speech.js";
import type { EditionStoryData } from "./edition.js";

function story(over: Partial<EditionStoryData> = {}): EditionStoryData {
  return {
    storyId: "s",
    headline: "Cross-screen saves recover",
    dek: "A failed save replays against the live document",
    tags: ["design-runtime"],
    lead: true,
    recaps: [],
    cohorts: [],
    ...over,
  };
}

const BASE = {
  nameplate: "The Engineering Daily",
  dateline: "Monday, September 21",
  issueLabel: "Issue 1",
  title: "agent-native/daily",
  brief: "Design's live preview grows up",
  alsoShippedLabel: "Also shipped",
};

describe("buildEditionSpeech", () => {
  it("opens with the nameplate, issue and dateline", () => {
    const out = buildEditionSpeech({ ...BASE, stories: [story()] });
    expect(out[0]).toBe(
      "The Engineering Daily. Issue 1. Monday, September 21.",
    );
    expect(out[1]).toBe("agent-native/daily. Design's live preview grows up.");
  });

  it("speaks a cohort's name and sentence, not its pull requests", () => {
    const out = buildEditionSpeech({
      ...BASE,
      stories: [
        story({
          whatShipped: "pending-edits.ts holds edits against the live document",
          cohorts: [
            {
              name: "Chrome survives hydration",
              sentence: "Reattaches after document-root replacement",
              prNumbers: [5503, 5505, 5553],
              repos: ["BuilderIO/agent-native"],
              additions: 157,
              deletions: 22,
            },
          ],
        }),
      ],
    });
    const spoken = out.join(" ");
    expect(spoken).toContain("Chrome survives hydration.");
    expect(spoken).toContain("Reattaches after document-root replacement.");
    // Numbers are for the eye, not the ear.
    expect(spoken).not.toMatch(/5503|5505|5553|157|22/);
  });

  it("reads the quick-links tail under its own heading", () => {
    const out = buildEditionSpeech({
      ...BASE,
      stories: [
        story(),
        story({
          storyId: "q1",
          lead: false,
          headline: "PDF exports keep their fonts",
          dek: "",
          tags: ["slides"],
        }),
      ],
    });
    const i = out.indexOf("Also shipped.");
    expect(i).toBeGreaterThan(-1);
    expect(out[i + 1]).toBe("slides. PDF exports keep their fonts.");
  });

  it("reads a tail story's dek, not only its headline", () => {
    const out = buildEditionSpeech({
      ...BASE,
      stories: [
        story(),
        story({
          storyId: "q1",
          lead: false,
          headline: "PDF exports keep their fonts",
          dek: "Embedded subsets travel with the file",
          tags: ["slides"],
        }),
      ],
    });
    expect(out).toContain(
      "slides. PDF exports keep their fonts. Embedded subsets travel with the file.",
    );
  });

  it("omits the heading when there is no tail", () => {
    const out = buildEditionSpeech({ ...BASE, stories: [story()] });
    expect(out).not.toContain("Also shipped.");
  });

  it("skips empty fields rather than speaking blanks", () => {
    const out = buildEditionSpeech({
      ...BASE,
      issueLabel: null,
      stories: [story({ dek: "   ", whatShipped: "", tags: [] })],
    });
    expect(out[0]).toBe("The Engineering Daily. Monday, September 21.");
    expect(out.some((s) => s.trim() === "" || s === ".")).toBe(false);
    expect(out.join(" ")).toContain("Cross-screen saves recover.");
  });
});

describe("chunkEditionSpeech", () => {
  it("keeps a short edition in one request", () => {
    expect(chunkEditionSpeech(["One.", "Two."], 4096)).toEqual([
      "One.\n\nTwo.",
    ]);
  });

  it("splits on segment boundaries rather than mid-sentence", () => {
    const chunks = chunkEditionSpeech(["aaaa", "bbbb", "cccc"], 10);
    expect(chunks).toEqual(["aaaa\n\nbbbb", "cccc"]);
  });

  it("returns an over-long segment whole, so the caller fails loudly", () => {
    // Truncating here would narrate a shortened story as if it were the story.
    const long = "x".repeat(30);
    expect(chunkEditionSpeech([long], 10)).toEqual([long]);
  });

  it("drops nothing", () => {
    const segments = Array.from({ length: 40 }, (_, i) => `Segment ${i}.`);
    const joined = chunkEditionSpeech(segments, 60).join("\n\n");
    for (const segment of segments) expect(joined).toContain(segment);
  });
});
