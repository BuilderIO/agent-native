import type {
  EditionReaderStory,
  EditionStoryCohort,
  EditionStoryRecapRef,
} from "@shared/edition";
import { describe, expect, it } from "vitest";

import { storySources } from "./editionSources";

function story(
  recaps: EditionStoryRecapRef[],
  cohorts: EditionStoryCohort[] = [],
): EditionReaderStory {
  return {
    storyId: "s",
    headline: "h",
    dek: "",
    tags: [],
    lead: true,
    recaps,
    cohorts,
    blocks: [],
  };
}

function recap(repo: string, prNumber: number): EditionStoryRecapRef {
  return {
    repo,
    prNumber,
    prUrl: `https://github.com/${repo}/pull/${prNumber}`,
  };
}

describe("storySources", () => {
  it("keeps one source per repo when two repos share a PR number", () => {
    const sources = storySources(
      story([
        recap("BuilderIO/agent-native", 42),
        recap("BuilderIO/builder", 42),
      ]),
    );

    expect(sources.map((source) => source.url)).toEqual([
      "https://github.com/BuilderIO/agent-native/pull/42",
      "https://github.com/BuilderIO/builder/pull/42",
    ]);
    expect(new Set(sources.map((source) => source.key)).size).toBe(2);
  });

  it("collapses the same pull request listed twice", () => {
    const sources = storySources(
      story([
        recap("BuilderIO/agent-native", 42),
        recap("BuilderIO/agent-native", 42),
      ]),
    );

    expect(sources).toHaveLength(1);
  });

  it("leaves an ambiguous cohort number unlinked", () => {
    const cohort: EditionStoryCohort = {
      name: "c",
      sentence: "s",
      prNumbers: [42, 43],
      repos: ["BuilderIO/agent-native", "BuilderIO/builder"],
    };
    const sources = storySources(
      story(
        [
          recap("BuilderIO/agent-native", 42),
          recap("BuilderIO/builder", 42),
          recap("BuilderIO/agent-native", 43),
        ],
        [cohort],
      ),
    );

    expect(
      sources.find((source) => source.prNumber === 42)?.url,
    ).toBeUndefined();
    expect(sources.find((source) => source.prNumber === 43)?.url).toBe(
      "https://github.com/BuilderIO/agent-native/pull/43",
    );
  });
});
