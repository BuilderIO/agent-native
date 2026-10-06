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
 * A cohort lists `prNumbers` and `repos` separately, so a number it names and
 * no recap claims has nothing to link to and travels as bare text.
 */
export function storySources(story: EditionReaderStory): StorySource[] {
  const sources: StorySource[] = [];
  const seen = new Set<string>();
  const linked = new Set<number>();

  for (const recap of story.recaps) {
    const key = `${recap.repo}#${recap.prNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    linked.add(recap.prNumber);
    sources.push({ key, prNumber: recap.prNumber, url: recap.prUrl });
  }

  for (const cohort of story.cohorts) {
    for (const prNumber of cohort.prNumbers) {
      if (linked.has(prNumber) || seen.has(String(prNumber))) continue;
      seen.add(String(prNumber));
      sources.push({ key: String(prNumber), prNumber });
    }
  }

  return sources.sort((a, b) => a.prNumber - b.prNumber);
}
