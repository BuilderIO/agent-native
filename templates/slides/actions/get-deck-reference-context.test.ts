import { describe, expect, it } from "vitest";

import {
  buildReferenceDeckContext,
  pickExemplarSlides,
} from "./get-deck-reference-context.js";

const slides = [
  { id: "a", layout: "title", content: "<h1>Q3 Review</h1>" },
  {
    id: "b",
    layout: "content",
    content: "<h2>Revenue</h2><ul><li>Up</li></ul>",
  },
  { id: "c", layout: "content", content: "<h2>Churn</h2>" },
  { id: "d", layout: "quote", content: "<blockquote>Ship it</blockquote>" },
];

describe("pickExemplarSlides", () => {
  it("takes the first slide plus one sample per new layout", () => {
    expect(pickExemplarSlides(slides).map((e) => e.slideNumber)).toEqual([
      1, 2, 4,
    ]);
  });

  it("keeps the first slide even when its layout repeats later", () => {
    const repeated = [slides[1], slides[2], slides[0]];
    expect(pickExemplarSlides(repeated).map((e) => e.slideNumber)).toEqual([
      1, 3,
    ]);
  });
});

describe("buildReferenceDeckContext", () => {
  const context = buildReferenceDeckContext({
    id: "deck-1",
    title: "Brand Base",
    aspectRatio: "16:9",
    designSystemId: "ds-1",
    slides,
  });

  it("states that structure is reused but content is not", () => {
    expect(context).toContain("Imitate its structure and styling");
    expect(context).toContain("Do NOT copy its subject matter");
  });

  it("includes the full slide progression and exemplar markup", () => {
    expect(context).toContain("1. [title] Q3 Review");
    expect(context).toContain("4. [quote] Ship it");
    expect(context).toContain("<blockquote>Ship it</blockquote>");
  });

  it("points the agent at get-deck for slides it did not receive", () => {
    expect(context).toContain("get-deck --id deck-1");
  });
});
