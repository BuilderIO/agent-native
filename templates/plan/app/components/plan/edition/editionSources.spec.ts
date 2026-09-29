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

  it("links both repos behind a shared number even with cohorts", () => {
    const cohort: EditionStoryCohort = {
      name: "c",
      sentence: "s",
      prNumbers: [42],
      repos: ["BuilderIO/agent-native", "BuilderIO/builder"],
    };
    const sources = storySources(
      story(
        [recap("BuilderIO/agent-native", 42), recap("BuilderIO/builder", 42)],
        [cohort],
      ),
    );

    expect(sources.map((source) => source.url)).toEqual([
      "https://github.com/BuilderIO/agent-native/pull/42",
      "https://github.com/BuilderIO/builder/pull/42",
    ]);
  });

  it("leaves a cohort number no recap claims as bare text", () => {
    const cohort: EditionStoryCohort = {
      name: "c",
      sentence: "s",
      prNumbers: [42, 99],
      repos: ["BuilderIO/agent-native"],
    };
    const sources = storySources(
      story([recap("BuilderIO/agent-native", 42)], [cohort]),
    );

    expect(sources.map((source) => [source.prNumber, source.url])).toEqual([
      [42, "https://github.com/BuilderIO/agent-native/pull/42"],
      [99, undefined],
    ]);
  });
});
