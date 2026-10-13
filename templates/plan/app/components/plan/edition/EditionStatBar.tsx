import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { EditionCoverageData, EditionReaderStory } from "@shared/edition";
import { useMemo, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { editionStat, EditionStatUnavailable } from "./editionStats";
import { EDITION_META_CLASS } from "./editionTypography";

/** Words a minute for prose on a screen, rounded down to stay honest. */
const READING_WORDS_PER_MINUTE = 220;

function countWords(value: string | undefined): number {
  if (!value) return 0;
  const words = value.trim().split(/\s+/u);
  return words[0] === "" ? 0 : words.length;
}

/**
 * Minutes for everything the page can show, including what the disclosures
 * hold. One number for the whole digest, never per story.
 */
function readingMinutes(stories: EditionReaderStory[]): number {
  let words = 0;
  for (const story of stories) {
    words += countWords(story.headline);
    words += countWords(story.dek);
    words += countWords(story.whatShipped);
    words += countWords(story.why);
    words += countWords(story.howItWorks);
    for (const cohort of story.cohorts) {
      words += countWords(cohort.name) + countWords(cohort.sentence);
    }
  }
  return Math.max(1, Math.round(words / READING_WORDS_PER_MINUTE));
}

function distinctAreas(stories: EditionReaderStory[]): number {
  const areas = new Set<string>();
  for (const story of stories) {
    for (const tag of story.tags) areas.add(tag);
  }
  return areas.size;
}

/**
 * The corpus and the promise, in one rule-bounded strip: how much work this
 * issue covers and how long it takes to read. One read-time for the whole
 * issue, never per story.
 */
export function EditionStatBar({
  stories,
  coverage,
}: {
  stories: EditionReaderStory[];
  coverage: EditionCoverageData | null;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const minutes = useMemo(() => readingMinutes(stories), [stories]);
  const areas = useMemo(() => distinctAreas(stories), [stories]);
  const merged = editionStat(coverage?.mergedPrCount);

  const segments: ReactNode[] = [];
  // A corpus count that could not be resolved is omitted rather than shown as
  // a zero: "0 pull requests analysed" would read as a quiet day.
  if (merged.available) {
    segments.push(t("edition.promise.analysed", { count: merged.value }));
  }
  // Lead stories only. Counting the quick-links tail as "stories" inflates the
  // number and contradicts the whole point of capping leads at three.
  segments.push(
    t("edition.promise.storyCount", {
      count: stories.filter((story) => story.lead).length,
    }),
  );
  segments.push(t("edition.promise.readTime", { minutes }));
  if (areas > 0) {
    segments.push(t("edition.promise.areaCount", { count: areas }));
  }

  return (
    <p
      className={cn(
        EDITION_META_CLASS,
        "flex flex-wrap items-baseline gap-x-2 gap-y-1",
      )}
    >
      {segments.map((segment, index) => (
        <span key={index} className="flex items-baseline gap-x-2">
          {index > 0 && <span aria-hidden="true">·</span>}
          {segment}
        </span>
      ))}
    </p>
  );
}
