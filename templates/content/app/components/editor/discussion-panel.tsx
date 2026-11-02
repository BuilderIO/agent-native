// A Page's Discussion is every comment on it: the ones on the whole page and
// the ones that point at text or a Property. This file holds what the panel
// adds on top of the comment threads: their order, the search, sort and filter
// controls Collections and Trash share, and the composer for the whole page.
import { useT } from "@agent-native/core/client/i18n";
import type { TiptapComposerHandle } from "@agent-native/toolkit/composer";
import {
  IconAdjustmentsHorizontal,
  IconArrowsSort,
  IconEye,
  IconEyeOff,
  IconSearch,
} from "@tabler/icons-react";
import { forwardRef, useState } from "react";

import {
  ContentTableConstraintBar,
  ContentTableConstraintChip,
  ContentTableSearch,
  ContentTableToolbar,
  ContentTableToolbarButton,
} from "@/components/editor/database/ContentTable";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CommentThread } from "@/hooks/use-comments";

import type { MentionEntry } from "./comment-drafts";
import { CommentAvatar } from "./CommentAvatar";
import type { CommentAiDraft, CommentAiSubmitPayload } from "./CommentComposer";
import { CommentComposer } from "./CommentComposer";

export type DiscussionSort = "page" | "activity" | "oldest";
export const DISCUSSION_SORTS: readonly DiscussionSort[] = [
  "page",
  "activity",
  "oldest",
];

/** What a thread points at; a thread that points at nothing is on the page. */
export type DiscussionTarget = "page" | "text" | "property";
export const DISCUSSION_TARGETS: readonly DiscussionTarget[] = [
  "page",
  "text",
  "property",
];

export function discussionThreadTarget(
  thread: Pick<CommentThread, "quotedText" | "property" | "block" | "clip">,
): DiscussionTarget {
  if (thread.property) return "property";
  // A thread on a whole block, such as a video, or on a moment of a Clip,
  // sits in the text as a quote does.
  return thread.block || thread.clip || thread.quotedText?.trim()
    ? "text"
    : "page";
}

/** A comment on the whole page: no quote, block, Clip, or Property. */
export function isPageCommentThread(
  thread: Pick<CommentThread, "quotedText" | "property" | "block" | "clip">,
) {
  return discussionThreadTarget(thread) === "page";
}

/**
 * Where an entry sits in page order. Comments on the whole page come first,
 * then Property comments in the Page's Property order, then text by where its
 * highlight is on screen; text with no highlight showing (resolved, deleted,
 * or in a closed tab) goes last, by where it was in the text.
 */
export type DiscussionOrderFacts = {
  rank: 0 | 1 | 2 | 3;
  position: number;
  createdAt: string;
  lastActivityAt: string;
  id: string;
};

// Comment times can arrive as Postgres text ("2026-10-21 12:34:56.789+00"),
// which Safari won't parse until it reads as ISO.
export function discussionTime(value: string): number {
  return Date.parse(
    value
      .replace(" ", "T")
      .replace(/(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/, "$1$2:00"),
  );
}

export function compareDiscussionEntries(
  sort: DiscussionSort,
  left: DiscussionOrderFacts,
  right: DiscussionOrderFacts,
): number {
  if (sort === "activity") {
    return (
      discussionTime(right.lastActivityAt) -
        discussionTime(left.lastActivityAt) || left.id.localeCompare(right.id)
    );
  }
  if (sort === "page") {
    const byRank = left.rank - right.rank;
    if (byRank) return byRank;
    const byPosition = left.position - right.position;
    // Two unknown positions subtract to NaN, which falls through to time.
    if (byPosition) return byPosition;
  }
  return (
    discussionTime(left.createdAt) - discussionTime(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function commentThreadOrderFacts(
  thread: CommentThread,
  {
    documentTop,
    propertyIndex,
  }: {
    /** The highlight's distance from the top of the page, when it shows. */
    documentTop: number | undefined;
    /** The Property's place among the Page's Properties; -1 when it's gone. */
    propertyIndex: (propertyId: string) => number;
  },
): DiscussionOrderFacts {
  const root = thread.comments[0];
  const createdAt = root?.created_at ?? "";
  const lastActivityAt = thread.comments.reduce(
    (latest, comment) =>
      discussionTime(comment.created_at) > discussionTime(latest)
        ? comment.created_at
        : latest,
    createdAt,
  );
  const facts = { createdAt, lastActivityAt, id: thread.threadId };
  const target = discussionThreadTarget(thread);
  if (target === "page") return { ...facts, rank: 0, position: 0 };
  if (target === "property") {
    const index = propertyIndex(thread.property!.propertyId);
    return { ...facts, rank: 1, position: index < 0 ? Infinity : index };
  }
  if (documentTop !== undefined)
    return { ...facts, rank: 2, position: documentTop };
  return { ...facts, rank: 3, position: thread.startOffset ?? Infinity };
}

/** Whether someone is @mentioned anywhere in the thread. */
export function threadMentions(thread: CommentThread, email?: string | null) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return thread.comments.some((comment) =>
    comment.mentions.some(
      (mention) =>
        mention.kind === "person" &&
        mention.email.trim().toLowerCase() === normalized,
    ),
  );
}

/** Whether a search matches the thread's words, quote, Property, or people. */
export function threadMatchesSearch(thread: CommentThread, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    thread.quotedText,
    thread.property?.propertyName,
    thread.property?.propertyValue,
    ...thread.comments.flatMap((comment) => [
      comment.content,
      comment.author_name,
      comment.author_email,
    ]),
  ];
  return haystack.some((text) => text?.toLowerCase().includes(needle));
}

// The words an edit takes out or puts in: plain text, or the text inside the
// blocks it adds. Marks carry no words.
function changedText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(changedText);
  if (value && typeof value === "object") {
    const { text, content } = value as { text?: unknown; content?: unknown };
    return [...changedText(text), ...changedText(content)];
  }
  return [];
}

export function suggestionMatchesSearch(
  suggestion: {
    summary?: string;
    authorEmail: string | null;
    operations?: readonly {
      before?: unknown;
      after?: unknown;
      block?: unknown;
    }[];
  },
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const changed = (suggestion.operations ?? []).flatMap((operation) =>
    changedText([operation.before, operation.after, operation.block]),
  );
  return [suggestion.summary, suggestion.authorEmail, ...changed].some((text) =>
    text?.toLowerCase().includes(needle),
  );
}

export type DiscussionChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

type FilterOption = {
  key: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
};

export type DiscussionFilterGroup = {
  key: string;
  label: string;
  options: FilterOption[];
  /** Two columns for short labels; one for names. */
  columns?: 1 | 2;
};

/**
 * Search, sort and filter for the Discussion panel, built from the controls
 * Collections and Trash share so all three look and behave alike, plus the
 * switch that hides comment highlights on the page.
 */
export function DiscussionToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  filterGroups,
  chips,
  onClearFilters,
  portalContainer,
  highlightsVisible,
  onHighlightsVisibleChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  sort: DiscussionSort;
  onSortChange: (sort: DiscussionSort) => void;
  filterGroups: DiscussionFilterGroup[];
  chips: DiscussionChip[];
  onClearFilters: () => void;
  portalContainer?: HTMLElement | null;
  highlightsVisible?: boolean;
  onHighlightsVisibleChange?: (visible: boolean) => void;
}) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const sortLabel = (value: DiscussionSort) =>
    t(
      value === "page"
        ? "comments.sortPage"
        : value === "activity"
          ? "comments.sortActivity"
          : "comments.sortOldest",
    );
  return (
    <div data-discussion-toolbar>
      <ContentTableToolbar className="flex-nowrap justify-start px-3 py-1">
        <ContentTableSearch
          open={searchOpen}
          value={query}
          label={t("comments.searchDiscussion")}
          placeholder={t("comments.searchDiscussion")}
          closeLabel={t("comments.closeSearch")}
          onOpenChange={setSearchOpen}
          onValueChange={onQueryChange}
        />
        <Popover>
          <PopoverTrigger asChild>
            <ContentTableToolbarButton
              label={t("comments.sortBy")}
              active={sort !== "page"}
              data-discussion-sort-trigger
            >
              <IconArrowsSort className="size-3.5" />
            </ContentTableToolbarButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="grid w-52 gap-1 p-2"
            container={portalContainer}
          >
            {DISCUSSION_SORTS.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={sort === value ? "secondary" : "ghost"}
                className="justify-start"
                aria-pressed={sort === value}
                data-discussion-sort={value}
                onClick={() => onSortChange(value)}
              >
                {sortLabel(value)}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <ContentTableToolbarButton
              label={t("comments.filter")}
              active={chips.length > 0}
              count={chips.length}
              data-discussion-filter-trigger
            >
              <IconAdjustmentsHorizontal className="size-3.5" />
            </ContentTableToolbarButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="grid max-h-[min(32rem,var(--radix-popover-content-available-height))] w-72 gap-3 overflow-y-auto"
            container={portalContainer}
          >
            {filterGroups.map((group) => (
              <fieldset
                key={group.key}
                className="grid gap-1.5"
                data-discussion-filter-group={group.key}
              >
                <legend className="text-xs font-medium">{group.label}</legend>
                <div
                  className={
                    group.columns === 1
                      ? "grid gap-1"
                      : "grid grid-cols-2 gap-1"
                  }
                >
                  {group.options.map((option) => (
                    <Button
                      key={option.key}
                      type="button"
                      size="sm"
                      variant={option.selected ? "secondary" : "ghost"}
                      className="justify-start truncate"
                      aria-pressed={option.selected}
                      data-discussion-filter-option={option.key}
                      onClick={option.onSelect}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
            ))}
            {chips.length ? (
              <Button variant="ghost" size="sm" onClick={onClearFilters}>
                {t("comments.clearFilters")}
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>
        {onHighlightsVisibleChange ? (
          <ContentTableToolbarButton
            label={t(
              highlightsVisible
                ? "comments.hideIndicators"
                : "comments.showIndicators",
            )}
            active={!highlightsVisible}
            aria-pressed={!highlightsVisible}
            className="ms-auto"
            data-discussion-highlights-toggle
            onClick={() => onHighlightsVisibleChange(!highlightsVisible)}
          >
            {highlightsVisible ? (
              <IconEye className="size-3.5" />
            ) : (
              <IconEyeOff className="size-3.5" />
            )}
          </ContentTableToolbarButton>
        ) : null}
      </ContentTableToolbar>
      {query.trim() || sort !== "page" || chips.length ? (
        <ContentTableConstraintBar
          className="px-3 pb-2"
          trailing={
            chips.length ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={onClearFilters}
              >
                {t("comments.clearFilters")}
              </Button>
            ) : undefined
          }
        >
          {query.trim() ? (
            <ContentTableConstraintChip
              icon={<IconSearch className="size-3.5" />}
              label={`${t("comments.searchDiscussion")}: ${query.trim()}`}
              removeLabel={t("comments.removeFilter", {
                filter: t("comments.searchDiscussion"),
              })}
              onRemove={() => {
                onQueryChange("");
                setSearchOpen(false);
              }}
            />
          ) : null}
          {sort !== "page" ? (
            <ContentTableConstraintChip
              icon={<IconArrowsSort className="size-3.5" />}
              label={`${t("comments.sortBy")}: ${sortLabel(sort)}`}
              removeLabel={t("comments.removeFilter", {
                filter: t("comments.sortBy"),
              })}
              onRemove={() => onSortChange("page")}
            />
          ) : null}
          {chips.map((chip) => (
            <ContentTableConstraintChip
              key={chip.key}
              label={chip.label}
              removeLabel={t("comments.removeFilter", { filter: chip.label })}
              onRemove={chip.onRemove}
            />
          ))}
        </ContentTableConstraintBar>
      ) : null}
    </div>
  );
}

/** Writes a comment on the whole page: nothing selected, nothing quoted. */
export const DiscussionComposer = forwardRef<
  TiptapComposerHandle,
  {
    currentUserEmail?: string;
    value: string;
    onChange: (text: string) => void;
    mentions: MentionEntry[];
    onMentionsChange: (mentions: MentionEntry[]) => void;
    aiDraft: CommentAiDraft | null;
    onAiDraftChange: (draft: CommentAiDraft | null) => void;
    aiModelStorageKey?: string;
    onSubmit: () => void;
    onAiSubmit?: (selection: CommentAiSubmitPayload) => void;
    submitting: boolean;
    submitDisabled?: boolean;
  }
>(function DiscussionComposer(
  {
    currentUserEmail,
    value,
    onChange,
    mentions,
    onMentionsChange,
    aiDraft,
    onAiDraftChange,
    aiModelStorageKey,
    onSubmit,
    onAiSubmit,
    submitting,
    submitDisabled = false,
  },
  ref,
) {
  const t = useT();
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-3"
      data-discussion-composer
    >
      <div className="flex h-9.5 shrink-0 items-center">
        <CommentAvatar email={currentUserEmail} name={currentUserEmail} />
      </div>
      <div className="min-w-0 flex-1">
        <CommentComposer
          ref={ref}
          value={value}
          onChange={onChange}
          mentions={mentions}
          onMentionsChange={onMentionsChange}
          onSubmit={onSubmit}
          onAiSubmit={onAiSubmit}
          aiDraft={aiDraft}
          onAiDraftChange={onAiDraftChange}
          aiModelStorageKey={onAiSubmit ? aiModelStorageKey : undefined}
          placeholder={t("comments.commentOnPage")}
          ariaLabel={t("comments.commentOnPage")}
          submitLabel={t("comments.submit")}
          submitDisabled={submitDisabled}
          disabled={submitting}
        />
      </div>
    </div>
  );
});
