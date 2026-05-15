import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  escapeLikeTerm,
  normalizeSearchTerms,
  scoreSearchText,
  sourceUrlFromMetadata,
} from "./search.js";

describe("Brain universal search helpers", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLikeTerm(String.raw`100%_done\ship`)).toBe(
      String.raw`100\%\_done\\ship`,
    );
  });

  it("keeps the phrase and useful terms for query expansion", () => {
    expect(
      normalizeSearchTerms("What did Platform decide about OAuth?"),
    ).toEqual([
      "what did platform decide about oauth",
      "platform",
      "decide",
      "oauth",
    ]);
  });

  it("builds a short snippet around the first matching term", () => {
    const snippet = buildSnippet(
      `${"intro ".repeat(80)}The rollout policy requires approvals before launch.`,
      ["policy"],
      80,
    );
    expect(snippet).toContain("policy requires approvals");
    expect(snippet.startsWith("...")).toBe(true);
  });

  it("scores title matches higher than body-only matches", () => {
    const terms = normalizeSearchTerms("retention policy");
    const titleScore = scoreSearchText(
      { title: "Retention policy", body: "short note" },
      terms,
    );
    const bodyScore = scoreSearchText(
      { title: "Random note", body: "Retention policy details" },
      terms,
    );
    expect(titleScore).toBeGreaterThan(bodyScore);
  });

  it("extracts source links from common metadata keys", () => {
    expect(
      sourceUrlFromMetadata({ permalink: "https://slack.example/p/1" }),
    ).toBe("https://slack.example/p/1");
    expect(sourceUrlFromMetadata({ sourceUrl: "https://docs.example/a" })).toBe(
      "https://docs.example/a",
    );
  });
});
