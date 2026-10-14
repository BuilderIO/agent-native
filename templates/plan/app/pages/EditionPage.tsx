import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import type { EditionCoverageData, EditionReaderStory } from "@shared/edition";
import { planRouteSegment } from "@shared/plan-routes";
import { IconArrowLeft } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import {
  EditionArchive,
  EditionLeadStory,
  EditionListenButton,
  EditionMasthead,
  EditionQuickLinks,
  EditionRail,
  EditionSecondaryStory,
  EditionSignInPrompt,
  EditionStatBar,
  isUnauthorizedError,
} from "@/components/plan/edition";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const ARCHIVE_HREF = `/${planRouteSegment("edition")}`;

/** Three, because a fourth lead is a list item pretending to be a story. */
const MAX_LEAD_STORIES = 3;

type EditionDetail = {
  edition: {
    id: string;
    title: string;
    brief: string;
    issueNumber?: number | null;
    notes?: string | null;
    dateKey: string;
    windowStart: string;
    windowEnd: string;
    timezone: string;
  };
  stories: EditionReaderStory[];
  coverage: EditionCoverageData | null;
  /** Cited recap blocks that no longer resolve, counted server-side. */
  unresolvedBlockRefs?: number;
};

const READER_CONTAINER_CLASS =
  "mx-auto w-full max-w-[1360px] px-6 py-10 sm:px-10 sm:py-14";

/** The stat bar is a rule-bounded strip, the way a masthead colophon is. */
const STAT_STRIP_CLASS =
  "mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-plan-line py-2.5";

const READER_GRID_CLASS =
  "mt-10 grid gap-x-10 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]";

const RAIL_CLASS =
  "flex min-w-0 flex-col gap-8 lg:border-s lg:border-plan-line lg:ps-8";

/**
 * The secondary band stays inside the reading column so it follows the leads
 * directly. Run full-width instead and a long coverage list in the rail pushes
 * it below the fold of the fold.
 */
const SECONDARY_GRID_CLASS =
  "mt-14 grid gap-x-8 gap-y-10 md:grid-cols-2 xl:grid-cols-3";

/**
 * Mounts the way back into the app header. An issue is reached from the
 * archive, a sidebar link, a share link or the agent, so the reader cannot
 * assume history has anywhere to go back to — this is a link, not `history.back`.
 */
function useEditionBackTitle() {
  const t = useT();
  useSetPageTitle(
    useMemo(
      () => (
        <Button
          asChild
          type="button"
          variant="ghost"
          size="sm"
          className="-ms-2"
        >
          <Link to={ARCHIVE_HREF}>
            <IconArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
            {t("edition.nav.label")}
          </Link>
        </Button>
      ),
      [t],
    ),
  );
}

function ReaderSkeleton() {
  const t = useT();
  return (
    <div
      className={READER_CONTAINER_CLASS}
      role="status"
      aria-label={t("edition.reader.loading")}
    >
      <span className="sr-only">{t("edition.reader.loading")}</span>
      <div aria-hidden="true">
        <div className="flex items-baseline justify-between gap-8">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="mt-6 h-11 w-full max-w-[34rem] sm:h-14" />
        <Skeleton className="mt-5 h-5 w-full max-w-[30rem]" />
        <div className={STAT_STRIP_CLASS}>
          <Skeleton className="h-3 w-full max-w-[26rem]" />
        </div>
        <div className={READER_GRID_CLASS}>
          <div className="flex min-w-0 flex-col gap-14">
            {[0, 1, 2].map((story) => (
              <div key={story} className="flex flex-col gap-4">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-8 w-full max-w-[32rem]" />
                <Skeleton className="h-4 w-full max-w-[26rem]" />
                <Skeleton className="h-3 w-full max-w-[18rem]" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-4 w-full max-w-[24rem]" />
              </div>
            ))}
          </div>
          <div className={RAIL_CLASS}>
            {[0, 1, 2, 3].map((block) => (
              <div key={block} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-full max-w-[12rem]" />
                <Skeleton className="h-4 w-full max-w-[10rem]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReaderMessage({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className={READER_CONTAINER_CLASS}>
      <EditionMasthead archiveHref={ARCHIVE_HREF} />
      <p className="mt-8 max-w-[62ch] text-sm leading-[1.55] text-plan-text">
        {message}
      </p>
      {onRetry && retryLabel && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

function EditionReader({ id }: { id: string }) {
  const t = useT();
  const query = useActionQuery<EditionDetail>("get-edition", { id });
  useEditionBackTitle();

  if (query.isPending) return <ReaderSkeleton />;

  if (isUnauthorizedError(query.error)) {
    return (
      <div className={READER_CONTAINER_CLASS}>
        <EditionMasthead archiveHref={ARCHIVE_HREF} />
        <div className="mt-8">
          <EditionSignInPrompt />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <ReaderMessage
        message={t("edition.reader.error")}
        onRetry={() => void query.refetch()}
        retryLabel={t("edition.reader.retry")}
      />
    );
  }

  const detail = query.data;
  if (!detail?.edition) {
    return <ReaderMessage message={t("edition.reader.notFound")} />;
  }

  const stories = detail.stories ?? [];
  const numberOf = new Map(
    stories.map((story, index) => [story.storyId, index]),
  );
  const leads = stories
    .filter((story) => story.lead)
    .slice(0, MAX_LEAD_STORIES);
  const leadIds = new Set(leads.map((story) => story.storyId));
  const rest = stories.filter((story) => !leadIds.has(story.storyId));
  // A grid cell earns its place if it can say more than the headline — a dek,
  // a what-shipped, or at minimum a byline with the author and the diff. A
  // story with none of those is a row, which keeps the tail one height.
  const hasByline = (story: EditionReaderStory) =>
    story.recaps.some(
      (recap) =>
        recap.authorLogin?.trim() ||
        typeof recap.filesChanged === "number" ||
        typeof recap.additions === "number" ||
        typeof recap.deletions === "number",
    );
  const hasSomethingToSay = (story: EditionReaderStory) =>
    Boolean(story.dek?.trim() || story.whatShipped?.trim() || hasByline(story));
  const secondary = rest.filter(hasSomethingToSay);
  const tail = rest.filter((story) => !hasSomethingToSay(story));

  return (
    <div className={READER_CONTAINER_CLASS}>
      <EditionMasthead
        archiveHref={ARCHIVE_HREF}
        issueNumber={detail.edition.issueNumber}
        dateKey={detail.edition.dateKey}
        title={detail.edition.title}
        brief={detail.edition.brief}
      />
      {stories.length > 0 && (
        <div className={STAT_STRIP_CLASS}>
          <EditionStatBar stories={stories} coverage={detail.coverage} />
          <EditionListenButton edition={detail.edition} stories={stories} />
        </div>
      )}

      {stories.length === 0 && (
        <p className="mt-8 text-sm leading-[1.55] text-plan-muted">
          {t("edition.reader.noStories")}
        </p>
      )}

      <div className={READER_GRID_CLASS}>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-col gap-14">
            {leads.map((story) => (
              <EditionLeadStory
                key={story.storyId}
                story={story}
                index={numberOf.get(story.storyId) ?? 0}
              />
            ))}
          </div>

          {secondary.length > 0 && (
            <div className={SECONDARY_GRID_CLASS}>
              {secondary.map((story) => (
                <EditionSecondaryStory
                  key={story.storyId}
                  story={story}
                  index={numberOf.get(story.storyId) ?? 0}
                />
              ))}
            </div>
          )}

          <EditionQuickLinks stories={tail} numberOf={numberOf} />
        </div>

        <aside className={RAIL_CLASS}>
          <EditionRail
            stories={stories}
            coverage={detail.coverage}
            notes={detail.edition.notes}
            unresolvedBlockRefs={detail.unresolvedBlockRefs ?? 0}
          />
        </aside>
      </div>
    </div>
  );
}

export function EditionPage() {
  const params = useParams<{ id?: string }>();
  return (
    <div className="plan-content-surface min-h-full bg-plan-document text-plan-text">
      {params.id ? <EditionReader id={params.id} /> : <EditionArchive />}
    </div>
  );
}
