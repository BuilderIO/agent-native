// A Page's Discussion is every comment on it: the ones on the whole page and
// the ones that point at text or a Property. This file holds what the panel
// adds on top of the comment threads: their order, the search, sort and filter
// controls Collections and Trash share, and the composer for the whole page.
import { useT } from "@agent-native/core/client/i18n";
import type { TiptapComposerHandle } from "@agent-native/toolkit/composer";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconArrowsSort,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconSearch,
} from "@tabler/icons-react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";

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
import { cn } from "@/lib/utils";

import { commentThreadMarkSelector } from "./comment-block-anchors";
import type { MentionEntry } from "./comment-drafts";
import { CommentAvatar } from "./CommentAvatar";
import type { CommentAiDraft, CommentAiSubmitPayload } from "./CommentComposer";
import { CommentComposer } from "./CommentComposer";
import { renderCommentBody } from "./CommentRow";
import {
  type PropertyThreadTarget,
  propertyThreadTargetText,
} from "./property-comments";

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
 * Where an entry sits in page order. Property comments come first, in the
 * Page's Property order, then text by where its highlight is on screen, then
 * text with no highlight showing (resolved, deleted, or in a closed tab) by
 * where it was in the text. Comments on the whole page come last.
 */
export const DISCUSSION_RANK = {
  property: 0,
  shownText: 1,
  hiddenText: 2,
  page: 3,
} as const;

export type DiscussionRank =
  (typeof DISCUSSION_RANK)[keyof typeof DISCUSSION_RANK];

/** The sections page order reads in, and each one's heading. */
export const DISCUSSION_SECTIONS: readonly DiscussionTarget[] = [
  "property",
  "text",
  "page",
];
export const DISCUSSION_SECTION_LABELS = {
  property: "comments.sectionProperties",
  text: "comments.sectionText", // i18n-ignore message key
  page: "comments.sectionPage",
} as const satisfies Record<DiscussionTarget, string>;

/** The group a rank's entries sit under in page order. */
export function discussionRankTarget(rank: DiscussionRank): DiscussionTarget {
  if (rank === DISCUSSION_RANK.property) return "property";
  return rank === DISCUSSION_RANK.page ? "page" : "text";
}

export type DiscussionOrderFacts = {
  rank: DiscussionRank;
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
  if (target === "page")
    return { ...facts, rank: DISCUSSION_RANK.page, position: 0 };
  if (target === "property") {
    const index = propertyIndex(thread.property!.propertyId);
    return {
      ...facts,
      rank: DISCUSSION_RANK.property,
      position: index < 0 ? Infinity : index,
    };
  }
  return discussionTextOrderFacts(facts, documentTop, thread.startOffset);
}

/** Text, or a suggested edit, by where its highlight shows or last was. */
export function discussionTextOrderFacts(
  facts: Pick<DiscussionOrderFacts, "createdAt" | "lastActivityAt" | "id">,
  documentTop: number | undefined,
  offset: number | null | undefined,
): DiscussionOrderFacts {
  return documentTop === undefined
    ? {
        ...facts,
        rank: DISCUSSION_RANK.hiddenText,
        position: offset ?? Infinity,
      }
    : { ...facts, rank: DISCUSSION_RANK.shownText, position: documentTop };
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

/**
 * What a thread is about, named in full at its top: the Property and its
 * value, or the quoted text. Show takes you there. Without `onShow`, as when
 * the Property is gone or the highlight isn't on the page, it only names it.
 */
export function DiscussionSubjectChip({
  kind,
  label,
  onShow,
  children,
}: {
  kind: "property" | "text";
  /** What Show does, read out in place of the chip's words. */
  label: string;
  onShow?: (() => void) | undefined;
  children: ReactNode;
}) {
  const t = useT();
  const className = cn(
    "-mb-1 flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-start text-sm",
    kind === "text"
      ? "discussion-subject-quote text-foreground"
      : "bg-muted text-muted-foreground",
  );
  // A Property's value shows in full; quoted text keeps to two lines.
  const words = (
    <span
      className={cn(
        "min-w-0 flex-1 break-words",
        kind === "text" && "line-clamp-2",
      )}
    >
      {children}
    </span>
  );
  if (!onShow)
    return (
      <div className={className} data-discussion-subject={kind}>
        {words}
      </div>
    );
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        className,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        kind === "property" && "hover:bg-accent hover:text-foreground",
      )}
      data-discussion-subject={kind}
      onClick={(event) => {
        event.stopPropagation();
        onShow();
      }}
    >
      {words}
      <span
        className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {t("comments.showSubject")}
        <IconChevronRight className="size-3.5" />
      </span>
    </button>
  );
}

/**
 * What a thread in Discussion is about: its Property and value, or the text,
 * block or moment it points at. With `onShow` it is the thread's Show.
 */
export function DiscussionThreadSubject({
  quote,
  propertyTarget,
  onShow,
}: {
  quote: string | null | undefined;
  propertyTarget: PropertyThreadTarget | null;
  onShow?: (() => void) | undefined;
}) {
  const t = useT();
  if (propertyTarget) {
    const { name, value } = propertyThreadTargetText(propertyTarget, t);
    return (
      <DiscussionSubjectChip
        kind="property"
        label={t("comments.showPropertyInInfo", { property: name })}
        onShow={onShow}
      >
        <span data-comment-property-target={propertyTarget.state}>
          <span className="font-medium text-foreground">{name}</span>
          {value === null ? null : ` · ${value}`}
        </span>
      </DiscussionSubjectChip>
    );
  }
  if (!quote) return null;
  return (
    <DiscussionSubjectChip
      kind="text"
      label={t("comments.showQuoteOnPage", { quote })}
      onShow={onShow}
    >
      <span data-comment-quote>{quote}</span>
    </DiscussionSubjectChip>
  );
}

/**
 * The thread Discussion has stepped aside for, while it may stay aside: the
 * panel covers the page and the thread is still open. Editing away its text
 * keeps the bar, which is still the way back to the thread.
 */
export function discussionPeekThread(
  threads: readonly CommentThread[] | undefined,
  threadId: string | null,
  coversPage: boolean,
): CommentThread | null {
  if (!threadId || !coversPage) return null;
  return (
    threads?.find(
      (thread) => thread.threadId === threadId && !thread.resolved,
    ) ?? null
  );
}

/**
 * Discussion stepped aside so Show could show the page: the text and comment
 * it showed, and the way back. On a phone it spans the foot of the screen.
 */
export function DiscussionPeekBar({
  thread,
  quote,
  sheet,
  onBack,
}: {
  thread: Pick<CommentThread, "comments">;
  quote: string | null | undefined;
  sheet: boolean;
  onBack: () => void;
}) {
  const t = useT();
  const backRef = useRef<HTMLButtonElement>(null);
  // Show's button went with the panel, so the way back takes focus.
  useEffect(() => backRef.current?.focus({ preventScroll: true }), []);
  const first = thread.comments.length ? thread.comments[0] : undefined;
  return (
    <div
      className={cn(
        "z-40 col-span-2 col-start-1 row-start-2 flex items-center gap-2.5 self-end rounded-xl border border-border bg-background py-2.5 pe-2.5 ps-3 text-sm shadow-[0_10px_28px_rgba(0,0,0,0.15)] duration-200 animate-in fade-in slide-in-from-bottom-4 motion-reduce:animate-none print:hidden",
        sheet
          ? "m-2 justify-self-stretch"
          : "m-3 w-[22rem] max-w-[calc(100%-1.5rem)] justify-self-end",
      )}
      data-discussion-peek
    >
      <div className="min-w-0 flex-1">
        {quote ? (
          <p className="truncate font-medium">
            <span className="discussion-subject-quote rounded-sm px-0.5">
              {quote}
            </span>
          </p>
        ) : null}
        {first ? (
          <p className="line-clamp-2 break-words text-muted-foreground">
            {first.author_name ?? first.author_email.split("@")[0]}:{" "}
            {renderCommentBody(first.content, first.mentions, {
              compact: true,
            })}
          </p>
        ) : null}
      </div>
      <Button
        ref={backRef}
        variant="secondary"
        className="shrink-0 gap-1.5"
        aria-label={t("comments.backToDiscussion")}
        onClick={onBack}
      >
        <IconArrowLeft className="size-4" aria-hidden="true" />
        {t("comments.discussion")}
      </Button>
    </div>
  );
}

// guard:allow-raw-color — the comment highlight's hue, as global.css spells it in both themes; each keyframe sets its own alpha.
const SHOW_PULSE_COLOR = "hsl(45 93% 47%";
const showPulses = new WeakMap<Element, Animation>();

/**
 * Rings what Show has just shown, once: a thread's marks in the page's text,
 * or a Property's row. An animation, not a class: the editor redraws a mark
 * whose class it didn't set, and React rewrites a row's when it changes.
 */
export function pulseShownSubject(elements: Iterable<Element>) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const element of elements) {
    if (!("animate" in element)) continue;
    const row = element.matches("[data-property-row]");
    const ring = (size: number, alpha: number) =>
      row
        ? { boxShadow: `0 0 0 ${size}px ${SHOW_PULSE_COLOR} / ${alpha})` }
        : { outline: `${size}px solid ${SHOW_PULSE_COLOR} / ${alpha})` };
    // Pressing Show again before it ends starts the ring over.
    showPulses.get(element)?.cancel();
    showPulses.set(
      element,
      element.animate(
        [
          { ...ring(0, 0), offset: 0 },
          { ...ring(row ? 5 : 6, row ? 0.4 : 0.38), offset: row ? 0.3 : 0.25 },
          { ...ring(row ? 9 : 10, 0), offset: 1 },
        ],
        { duration: 1000, easing: "ease" },
      ),
    );
  }
}

/** A thread's marks in the page's text, under `root`. */
export function pageCommentMarks(root: ParentNode | null, threadId: string) {
  return [
    ...(root?.querySelectorAll(commentThreadMarkSelector(threadId)) ?? []),
  ].filter((element) => element.closest(".content-editor"));
}

/** Writes a comment on the whole page: nothing selected, nothing quoted. */
export const DiscussionComposer = forwardRef<
  TiptapComposerHandle,
  {
    currentUserEmail?: string;
    currentUserName?: string;
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
    currentUserName,
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
        <CommentAvatar
          email={currentUserEmail ?? null}
          name={currentUserName?.trim() || currentUserEmail || null}
        />
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
