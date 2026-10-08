import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { EditionCoverageData, EditionReaderStory } from "@shared/edition";
import { useMemo, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { EditionCoverageNote } from "./EditionCoverageNote";
import {
  editionStat,
  EditionStatUnavailable,
  StatSumValue,
  sumStat,
} from "./editionStats";
import { editionStoryAnchorId } from "./EditionStory";
import {
  EDITION_META_CLASS,
  EditionLabel,
  editionStoryNumber,
} from "./editionTypography";

const INDEX_HEADING_ID = "edition-index-heading";

/** One porcelain field and its value, right-aligned. */
function DiffStatRow({
  field,
  children,
}: {
  field: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{field}</dt>
      <dd className="text-plan-text tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * `git diff --stat` for the whole issue. Keys are the porcelain names on
 * purpose: they are identifiers, so they are neither translated nor set in the
 * prose font.
 */
function DiffStatTable({
  stories,
  coverage,
}: {
  stories: EditionReaderStory[];
  coverage: EditionCoverageData | null;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const totals = useMemo(() => {
    const recaps = new Map<string, EditionReaderStory["recaps"][number]>();
    const authors = new Set<string>();
    for (const story of stories) {
      for (const recap of story.recaps) {
        recaps.set(`${recap.repo}#${recap.prNumber}`, recap);
        if (recap.authorLogin) authors.add(recap.authorLogin);
      }
    }
    const cited = [...recaps.values()];
    return {
      pullRequests: cited.length,
      authors: authors.size,
      insertions: sumStat(cited.map((recap) => recap.additions)),
      deletions: sumStat(cited.map((recap) => recap.deletions)),
      files: sumStat(cited.map((recap) => recap.filesChanged)),
    };
  }, [stories]);

  const commits = editionStat(coverage?.commitCount);
  const partial =
    totals.insertions.reported < totals.insertions.counted ||
    totals.deletions.reported < totals.deletions.counted ||
    totals.files.reported < totals.files.counted;

  return (
    <section>
      <EditionLabel as="h2">git diff --stat</EditionLabel>
      <dl className={cn(EDITION_META_CLASS, "mt-2 flex flex-col gap-1")}>
        <DiffStatRow field="pull_requests">
          {formatNumber(totals.pullRequests)}
        </DiffStatRow>
        <DiffStatRow field="commits">
          {commits.available ? (
            formatNumber(commits.value)
          ) : (
            <EditionStatUnavailable label={t("edition.promise.unavailable")} />
          )}
        </DiffStatRow>
        <DiffStatRow field="insertions">
          <StatSumValue sum={totals.insertions} />
        </DiffStatRow>
        <DiffStatRow field="deletions">
          <StatSumValue sum={totals.deletions} />
        </DiffStatRow>
        <DiffStatRow field="files_touched">
          <StatSumValue sum={totals.files} />
        </DiffStatRow>
        <DiffStatRow field="authors">
          {formatNumber(totals.authors)}
        </DiffStatRow>
      </dl>
      {partial && (
        <p className={cn(EDITION_META_CLASS, "mt-2 leading-snug")}>
          {t("edition.rail.partial")}
        </p>
      )}
    </section>
  );
}

/** The numbered index, matching the number each story prints. */
function BuildIndex({ stories }: { stories: EditionReaderStory[] }) {
  const t = useT();
  if (stories.length === 0) return null;
  return (
    <nav aria-labelledby={INDEX_HEADING_ID}>
      <EditionLabel as="h2" className="mb-2">
        <span id={INDEX_HEADING_ID}>{t("edition.rail.inThisBuild")}</span>
      </EditionLabel>
      <ol className="flex flex-col gap-2">
        {stories.map((story, index) => (
          <li key={story.storyId} className="flex gap-2.5">
            <span
              className={cn(EDITION_META_CLASS, "pt-0.5 tabular-nums")}
              aria-hidden="true"
            >
              {editionStoryNumber(index)}
            </span>
            <a
              href={`#${editionStoryAnchorId(story.storyId)}`}
              className="text-sm leading-snug text-plan-muted transition-colors hover:text-plan-text"
            >
              {story.headline}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Distinct areas across the issue, as `#tag` chips. */
function Threads({ stories }: { stories: EditionReaderStory[] }) {
  const t = useT();
  const tags = useMemo(() => {
    const seen = new Set<string>();
    for (const story of stories) {
      for (const tag of story.tags) seen.add(tag);
    }
    return [...seen];
  }, [stories]);
  if (tags.length === 0) return null;
  return (
    <section>
      <EditionLabel as="h2">{t("edition.rail.threads")}</EditionLabel>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <li
            key={tag}
            className={cn(
              EDITION_META_CLASS,
              "rounded border border-plan-line px-1.5 py-0.5",
            )}
          >
            {`#${tag}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The standing furniture: the day's through-line, its diffstat, its index, its
 * threads, and what the issue could not see.
 */
export function EditionRail({
  stories,
  coverage,
  notes,
  unresolvedBlockRefs,
}: {
  stories: EditionReaderStory[];
  coverage: EditionCoverageData | null;
  notes?: string | null;
  unresolvedBlockRefs: number;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  return (
    <>
      {notes?.trim() && (
        <section>
          <EditionLabel as="h2">{t("edition.rail.notes")}</EditionLabel>
          <p className="mt-2 text-sm leading-[1.6] text-plan-muted">{notes}</p>
        </section>
      )}
      <DiffStatTable stories={stories} coverage={coverage} />
      <BuildIndex stories={stories} />
      <Threads stories={stories} />
      {coverage ? (
        <EditionCoverageNote coverage={coverage} />
      ) : (
        // Absent coverage is not full coverage: say the gap is unknown rather
        // than letting the issue read as the whole day.
        <section>
          <EditionLabel as="h2">{t("edition.coverage.label")}</EditionLabel>
          <p className="mt-2 text-sm leading-[1.55] text-plan-muted">
            {t("edition.coverage.unknown")}
          </p>
        </section>
      )}
      {unresolvedBlockRefs > 0 && (
        <p className={cn(EDITION_META_CLASS, "leading-snug")}>
          {t("edition.coverage.unresolvedBlocks", {
            total: formatNumber(unresolvedBlockRefs),
          })}
        </p>
      )}
    </>
  );
}
