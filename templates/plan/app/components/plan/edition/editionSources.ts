import type { EditionReaderStory } from "@shared/edition";

export interface StorySource {
  key: string;
  prNumber: number;
  url?: string;
}

/**
 * Every PR the story covers, ascending, for the sources line. A pull request
 * is identified by repo AND number: two repos can both have a #42, and keying
 * on the bare number drops one of them and links the other to the wrong diff.
 */
export function storySources(story: EditionReaderStory): StorySource[] {
  const cohortNumbers = new Set<number>();
  for (const cohort of story.cohorts) {
    for (const prNumber of cohort.prNumbers) cohortNumbers.add(prNumber);
  }

  // A cohort lists `prNumbers` and `repos` separately, so its numbers carry no
  // repo to resolve against. Link one only when a single recap claims it.
  if (cohortNumbers.size > 0) {
    return [...cohortNumbers]
      .sort((a, b) => a - b)
      .map((prNumber) => {
        const claimed = story.recaps.filter(
          (recap) => recap.prNumber === prNumber,
        );
        return {
          key: String(prNumber),
          prNumber,
          url: claimed.length === 1 ? claimed[0]?.prUrl : undefined,
        };
      });
  }

  const seen = new Set<string>();
  return story.recaps
    .map((recap) => ({
      key: `${recap.repo}#${recap.prNumber}`,
      prNumber: recap.prNumber,
      url: recap.prUrl,
    }))
    .filter((source) => {
      if (seen.has(source.key)) return false;
      seen.add(source.key);
      return true;
    })
    .sort((a, b) => a.prNumber - b.prNumber);
}
