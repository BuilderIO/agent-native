import {
  BlockRegistryProvider,
  NarrowContainerProvider,
} from "@agent-native/core/blocks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  EditionReaderStory,
  EditionStoryBlock,
  EditionStoryCohort,
  EditionStoryRecapRef,
} from "@shared/edition";
import { planPathForKind } from "@shared/plan-routes";
import { IconArrowUpRight, IconChevronDown } from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { PlanBlockView } from "../DocumentArea";
import { createPlanBlockRenderContext, planBlockRegistry } from "../planBlocks";
import { PlanMarkdownReader } from "../PlanMarkdownReader";
import { storySources } from "./editionSources";
import {
  editionStat,
  EditionStatUnavailable,
  useDiffText,
} from "./editionStats";
import {
  EDITION_LINK_CLASS,
  EDITION_META_CLASS,
  EditionLabel,
  EditionMetaLine,
  editionStoryNumber,
} from "./editionTypography";

/**
 * Fragment target for a story. The rail index and the story itself must derive
 * it from the same transform, or a headline in the index scrolls nowhere.
 */
export function editionStoryAnchorId(storyId: string): string {
  return `edition-story-${storyId.trim().replace(/\s+/g, "-")}`;
}

function storyRecapId(story: EditionReaderStory): string | undefined {
  return story.recaps.find((recap) => recap.recapId)?.recapId;
}

/** `BuilderIO/agent-native` reads as `agent-native` once the org repeats. */
function shortRepo(repo: string): string {
  const segments = repo.split("/");
  return segments[segments.length - 1] || repo;
}

function distinctAuthors(story: EditionReaderStory): string[] {
  const logins = new Set<string>();
  for (const recap of story.recaps) {
    if (recap.authorLogin) logins.add(recap.authorLogin);
  }
  return [...logins];
}

/**
 * The story's number and area, above the headline: `01 [design-runtime]`. The
 * number is the same one the rail index prints.
 */
function StoryStamp({ index, tags }: { index: number; tags: string[] }) {
  return (
    <p
      className={cn(
        EDITION_META_CLASS,
        "flex flex-wrap items-baseline gap-x-2",
      )}
    >
      <span className="text-plan-text tabular-nums">
        {editionStoryNumber(index)}
      </span>
      {tags.length > 0 && <span>{`[${tags.join(" / ")}]`}</span>}
    </p>
  );
}

/**
 * Attribution for the pull request a story leads on: author, size, and a link
 * out. A story citing many PRs gets ONE of these, not eleven — the rest of the
 * cluster is summarised by its cohorts.
 */
function StoryByline({ recap }: { recap: EditionStoryRecapRef | undefined }) {
  const t = useT();
  const files = editionStat(recap?.filesChanged);
  const additions = editionStat(recap?.additions);
  const deletions = editionStat(recap?.deletions);
  const diff = useDiffText(recap?.additions, recap?.deletions);
  if (!recap) return null;
  // A stat this recap never reported is left out, not printed as a dash: the
  // diffstat table in the rail is where the absence is stated once, and three
  // dashes in a byline say it three times while reading as noise.
  return (
    <EditionMetaLine
      className="mt-3"
      items={[
        recap.authorLogin ? (
          <span className="text-plan-text">{`@${recap.authorLogin}`}</span>
        ) : null,
        files.available
          ? t("edition.story.fileCount", { count: files.value })
          : null,
        additions.available || deletions.available ? diff : null,
        <a
          href={recap.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-plan-text underline decoration-plan-line underline-offset-4 transition-[text-decoration-color] visited:text-plan-muted hover:decoration-current"
        >
          {`#${recap.prNumber}`}
          <IconArrowUpRight className="size-3" aria-hidden="true" />
        </a>,
      ]}
    />
  );
}

/**
 * One recap block, reprinted through Plan's own renderer. Marked narrow so a
 * borrowed diff picks the layout that survives a story column.
 */
function StoryBlock({ entry }: { entry: EditionStoryBlock }) {
  const ctx = useMemo(
    () =>
      createPlanBlockRenderContext({
        planId: entry.recapId,
        editingDisabled: true,
      }),
    [entry.recapId],
  );
  return (
    <div className="min-w-0" data-edition-block={entry.block.id}>
      <BlockRegistryProvider registry={planBlockRegistry} ctx={ctx}>
        <NarrowContainerProvider>
          <PlanBlockView
            block={entry.block}
            planId={entry.recapId}
            editingDisabled
            compactVisuals
          />
        </NarrowContainerProvider>
      </BlockRegistryProvider>
    </div>
  );
}

/** A named group of pull requests, for a story too big to cite one by one. */
function CohortRow({ cohort }: { cohort: EditionStoryCohort }) {
  const t = useT();
  const diff = useDiffText(cohort.additions, cohort.deletions);
  const repos = [...new Set(cohort.repos.map(shortRepo))];
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1",
        // Devin's dim-and-sink: release, lockfile, codegen, and translation
        // work stays visible without competing with the real changes.
        cohort.mechanical && "opacity-55",
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-[0.95rem] leading-snug">
        <span className="font-semibold text-plan-text">{cohort.name}</span>
        <span className={cn(EDITION_META_CLASS, "flex items-baseline gap-x-2")}>
          <span>
            {t("edition.story.prCount", { count: cohort.prNumbers.length })}
          </span>
          {repos.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{repos.join(", ")}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          {diff}
        </span>
      </p>
      <p className="max-w-[68ch] text-sm leading-[1.55] text-plan-muted">
        {cohort.sentence}
      </p>
    </li>
  );
}

function StorySection({
  label,
  markdown,
}: {
  label: string;
  markdown?: string;
}) {
  if (!markdown?.trim()) return null;
  return (
    <section className="max-w-[68ch]">
      <EditionLabel as="h3">{label}</EditionLabel>
      <PlanMarkdownReader markdown={markdown} className="mt-1" />
    </section>
  );
}

function StoryDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            EDITION_META_CLASS,
            "h-7 w-fit gap-1.5 px-0 hover:bg-transparent hover:text-plan-text",
          )}
        >
          <span aria-hidden="true">{">"}</span>
          {label}
          <IconChevronDown
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Techmeme's `More:` line: the whole cluster as bare numbers, nothing else. */
function SourcesLine({ story }: { story: EditionReaderStory }) {
  const sources = storySources(story);
  if (sources.length === 0) return null;
  return (
    <p
      className={cn(
        EDITION_META_CLASS,
        "flex flex-wrap gap-x-1.5 gap-y-1 leading-relaxed",
      )}
    >
      {sources.map((source, index) => {
        const { key, prNumber, url } = source;
        const label = `#${prNumber}${index < sources.length - 1 ? "," : ""}`;
        return url ? (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="tabular-nums underline decoration-plan-line underline-offset-4 transition-[text-decoration-color] visited:text-plan-muted hover:decoration-current"
          >
            {label}
          </a>
        ) : (
          <span key={key} className="tabular-nums">
            {label}
          </span>
        );
      })}
    </p>
  );
}

function StoryHeadline({
  story,
  className,
}: {
  story: EditionReaderStory;
  className?: string;
}) {
  const recapId = storyRecapId(story);
  return (
    <h2 className={className}>
      {recapId ? (
        <Link
          to={planPathForKind(recapId, "recap")}
          className={EDITION_LINK_CLASS}
        >
          {story.headline}
        </Link>
      ) : (
        story.headline
      )}
    </h2>
  );
}

/**
 * A lead story, read in full: what shipped, why, and how it works are all
 * open. The reader came to learn what happened, so the explanation is the
 * page, not something behind a click.
 */
export function EditionLeadStory({
  story,
  index,
}: {
  story: EditionReaderStory;
  index: number;
}) {
  const t = useT();
  const [leadBlock, ...restBlocks] = story.blocks;
  const cohorts = useMemo(
    () =>
      [...story.cohorts].sort(
        (a, b) => Number(a.mechanical ?? false) - Number(b.mechanical ?? false),
      ),
    [story.cohorts],
  );
  const authors = distinctAuthors(story);

  return (
    <article
      id={editionStoryAnchorId(story.storyId)}
      className="flex min-w-0 scroll-mt-8 flex-col"
    >
      <StoryStamp index={index} tags={story.tags} />
      <StoryHeadline
        story={story}
        className="mt-2 text-balance text-[1.6rem] font-bold leading-[1.12] tracking-[-0.02em] sm:text-[1.9rem]"
      />
      <p className="mt-3 max-w-[64ch] text-pretty text-[1.05rem] leading-[1.6] text-plan-muted">
        {story.dek}
      </p>
      <StoryByline recap={story.recaps[0]} />
      {leadBlock && (
        <figure className="mt-5 min-w-0">
          <StoryBlock entry={leadBlock} />
        </figure>
      )}
      <div className="mt-6 flex flex-col gap-5">
        <StorySection
          label={t("edition.story.whatShipped")}
          markdown={story.whatShipped}
        />
        <StorySection label={t("edition.story.why")} markdown={story.why} />
        <StorySection
          label={t("edition.story.howItWorks")}
          markdown={story.howItWorks}
        />
      </div>
      {cohorts.length > 0 && (
        <ul className="mt-6 flex flex-col gap-4">
          {cohorts.map((cohort) => (
            <CohortRow key={cohort.name} cohort={cohort} />
          ))}
        </ul>
      )}
      {(restBlocks.length > 0 || storySources(story).length > 0) && (
        <div className="mt-5">
          <StoryDisclosure label={t("edition.story.sources")}>
            <div className="flex flex-col gap-5">
              <SourcesLine story={story} />
              {restBlocks.map((entry) => (
                <StoryBlock key={entry.block.id} entry={entry} />
              ))}
            </div>
          </StoryDisclosure>
        </div>
      )}
      {authors.length > 1 && (
        <EditionMetaLine
          className="mt-3"
          items={[
            <span>
              {t("edition.story.authors", { names: authors.join(", ") })}
            </span>,
          ]}
        />
      )}
    </article>
  );
}

/**
 * A secondary story in the grid: enough to learn what happened, with why and
 * how one click away so the column stays scannable.
 */
export function EditionSecondaryStory({
  story,
  index,
}: {
  story: EditionReaderStory;
  index: number;
}) {
  const t = useT();
  const hasDetail = Boolean(story.why?.trim() || story.howItWorks?.trim());
  return (
    <article
      id={editionStoryAnchorId(story.storyId)}
      className="flex min-w-0 scroll-mt-8 flex-col"
    >
      <StoryStamp index={index} tags={story.tags} />
      <StoryHeadline
        story={story}
        className="mt-1.5 text-balance text-[1.15rem] font-bold leading-[1.2] tracking-[-0.01em]"
      />
      <p className="mt-2 text-pretty text-sm leading-[1.55] text-plan-muted">
        {story.dek}
      </p>
      <StoryByline recap={story.recaps[0]} />
      <div className="mt-4">
        <StorySection
          label={t("edition.story.whatShipped")}
          markdown={story.whatShipped}
        />
      </div>
      {hasDetail && (
        <div className="mt-3">
          <StoryDisclosure label={t("edition.story.whyAndHow")}>
            <div className="flex flex-col gap-5">
              <StorySection
                label={t("edition.story.why")}
                markdown={story.why}
              />
              <StorySection
                label={t("edition.story.howItWorks")}
                markdown={story.howItWorks}
              />
            </div>
          </StoryDisclosure>
        </div>
      )}
    </article>
  );
}
