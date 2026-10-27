import type { useT } from "@agent-native/core/client/i18n";
import { IconChevronUp } from "@tabler/icons-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { CommentThread } from "@/hooks/use-comments";
import { cn } from "@/lib/utils";

import { commentThreadQuote } from "./comment-block-anchors";
import {
  CommentAvatar,
  CommentRow,
  renderCommentBody,
  useCommentTimestamp,
} from "./CommentRow";

type Translate = ReturnType<typeof useT>;

/** Two cards' edges under a stack, so it reads as more than one thread. */
export function CommentStackSheets() {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-6 right-8 top-8 rounded-xl bg-popover shadow-comment-card ring-1 ring-border/60"
        data-comment-stack-sheet
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1 left-4 right-6 top-4 rounded-xl bg-popover shadow-comment-card ring-1 ring-border/60"
        data-comment-stack-sheet
      />
    </>
  );
}

/** The first authors of a stack's threads, without repeats: email, name. */
function stackAuthors(threads: readonly CommentThread[]) {
  const authors = new Map<string, string>();
  for (const thread of threads) {
    const first = thread.comments[0];
    if (!first || authors.has(first.author_email)) continue;
    authors.set(first.author_email, first.author_name ?? first.author_email);
    if (authors.size === 3) break;
  }
  return [...authors];
}

function StackAvatars({ threads }: { threads: readonly CommentThread[] }) {
  return (
    <span className="flex -space-x-1">
      {stackAuthors(threads).map(([email, name]) => (
        <CommentAvatar
          key={email}
          email={email}
          name={name}
          className="size-5 text-[9px] ring-2 ring-popover"
        />
      ))}
    </span>
  );
}

/** "+N more" with the avatars of the threads it counts. */
export function CommentStackMore({
  threads,
  t,
}: {
  threads: readonly CommentThread[];
  t: Translate;
}) {
  return (
    <>
      <StackAvatars threads={threads} />
      <span className="font-medium">
        {t("comments.stackMore", { count: threads.length })}
      </span>
    </>
  );
}

const footerClass =
  "flex h-9 w-full items-center gap-2 border-t border-border/60 px-4 text-xs text-muted-foreground";

/** A new comment's footer on a folded stack; it opens the stack. */
export const CommentStackShowAll = forwardRef<
  HTMLButtonElement,
  {
    threads: readonly CommentThread[];
    onOpen: () => void;
    t: Translate;
  }
>(function CommentStackShowAll({ threads, onOpen, t }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        footerClass,
        "text-start hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
      aria-expanded={false}
      aria-label={t("comments.stackShowAll", { count: threads.length })}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      data-comment-stack-show-all
    >
      <CommentStackMore threads={threads} t={t} />
    </button>
  );
});

/** A folded stack's front thread, and the one it replaced on its way out. */
export type StackFrontMotion = {
  front: string;
  leaving: string | null;
  /** Counts front changes, so an earlier change can't clear a later one. */
  turn: number;
};

/** How long a front change takes to play out, a frame past its animations. */
const STACK_FRONT_CHANGE_MS = 240;

/**
 * A folded card starts still, or plays the change from the thread it last
 * showed, as when a stack folds with another thread in front. Until the
 * margin has placed every thread, it holds on to the thread it last showed.
 */
export function startStackFront(
  front: string,
  shown: string | undefined,
  placed: boolean,
): StackFrontMotion {
  if (!placed) return { front: shown ?? front, leaving: null, turn: 0 };
  return shown && shown !== front
    ? { front, leaving: shown, turn: 1 }
    : { front, leaving: null, turn: 0 };
}

/**
 * The card in front leaves as the new one comes in. A card already on its way
 * out is dropped, so changes in quick succession never queue up.
 */
export function changeStackFront(
  motion: StackFrontMotion,
  front: string,
): StackFrontMotion {
  if (motion.front === front) return motion;
  return { front, leaving: motion.front, turn: motion.turn + 1 };
}

export function settleStackFront(
  motion: StackFrontMotion,
  turn: number,
): StackFrontMotion {
  return motion.turn === turn && motion.leaving
    ? { ...motion, leaving: null }
    : motion;
}

// Every card in a folded stack shares one grid cell, so the stack is as tall
// as its tallest card whichever is in front.
const stackCardClass = "col-start-1 row-start-1 flex flex-col";

const frontCardClass = cn(
  stackCardClass,
  "overflow-hidden rounded-xl bg-popover ring-1 ring-border/60 shadow-comment-card",
);

/** A front thread's quote and first comment, with the others counted below. */
function StackFrontPreview({
  thread,
  quote,
  others,
  t,
}: {
  thread: CommentThread;
  quote: string | null;
  others: readonly CommentThread[];
  t: Translate;
}) {
  const timestamp = useCommentTimestamp();
  const first = thread.comments.length > 0 ? thread.comments[0] : null;
  const replies = thread.comments.length - 1;
  return (
    <>
      <div
        inert
        className="grid flex-1 grid-cols-1 content-start gap-3.5 px-4 pb-3.5 pt-3.5"
      >
        {quote ? (
          <p className="-mb-1 line-clamp-1 border-s-2 border-border ps-2.5 text-sm text-muted-foreground">
            {quote}
          </p>
        ) : null}
        {first ? (
          <CommentRow
            avatar={
              <CommentAvatar
                email={first.author_email}
                name={first.author_name ?? first.author_email}
              />
            }
            name={first.author_name ?? first.author_email.split("@")[0]}
            timestamp={{
              ...timestamp(first.created_at),
              dateTime: first.created_at,
            }}
          >
            <span className="line-clamp-3">
              {renderCommentBody(first.content, first.mentions)}
            </span>
          </CommentRow>
        ) : null}
        {replies > 0 ? (
          <p className="-mt-2 ps-9.5 text-xs text-muted-foreground">
            {t("comments.replyCount", { count: replies })}
          </p>
        ) : null}
      </div>
      <div inert className={footerClass} data-comment-stack-footer>
        <CommentStackMore threads={others} t={t} />
      </div>
    </>
  );
}

/**
 * A block's open threads folded into one card: the front thread's quote and
 * first comment, with the others counted below. When another thread comes to
 * the front, its card takes the place of the one leaving.
 */
export function CommentStackCard({
  stackKey,
  heightId,
  threads,
  front,
  frontPlaced,
  shownFronts,
  quotes,
  isActive,
  onOpen,
  onHoverChange,
  onHeightChange,
  t,
}: {
  stackKey: string;
  /** The id the margin lays this card out under. */
  heightId: string;
  threads: readonly CommentThread[];
  front: CommentThread;
  /**
   * Whether the margin has placed every open thread. Until it has, the front
   * is only provisional, and a change to it isn't played.
   */
  frontPlaced: boolean;
  /**
   * The thread a folded card last showed in front, under each of its stack's
   * threads, kept while the card is away, as when its stack is open. A block's
   * key moves with the blocks above it; its threads don't.
   */
  shownFronts: Map<string, string>;
  /** Quotes as the page shows them, under their thread ids, where they differ. */
  quotes: ReadonlyMap<string, string>;
  isActive: boolean;
  onOpen: () => void;
  onHoverChange: (hovered: boolean) => void;
  onHeightChange: (threadId: string, height: number) => void;
  t: Translate;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      onHeightChange(heightId, element.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [heightId, onHeightChange]);
  const [motion, setMotion] = useState(() =>
    startStackFront(
      front.threadId,
      threads
        .map((thread) => shownFronts.get(thread.threadId))
        .find((shown) => shown !== undefined),
      frontPlaced,
    ),
  );
  if (frontPlaced && motion.front !== front.threadId)
    setMotion(changeStackFront(motion, front.threadId));
  useEffect(() => {
    for (const thread of threads)
      shownFronts.set(thread.threadId, motion.front);
  }, [motion.front, shownFronts, threads]);
  useEffect(() => {
    if (!motion.leaving) return;
    const { turn } = motion;
    const timer = setTimeout(
      () => setMotion((current) => settleStackFront(current, turn)),
      STACK_FRONT_CHANGE_MS,
    );
    return () => clearTimeout(timer);
  }, [motion]);
  // A front gone from the stack, like a posted comment's stand-in once the
  // saved thread replaces it, leaves no card to picture, so the one after it
  // takes its place without playing the change.
  const leaving = motion.leaving
    ? threads.find((thread) => thread.threadId === motion.leaving)
    : undefined;
  const quoteOf = (thread: CommentThread) =>
    quotes.get(thread.threadId) ?? commentThreadQuote(thread, t) ?? null;
  const quote = quoteOf(front);
  const first = front.comments[0];
  const firstName = first
    ? (first.author_name ?? first.author_email.split("@")[0])
    : null;
  const replies = front.comments.length - 1;
  const others = threads.filter((thread) => thread !== front);
  return (
    <div
      ref={ref}
      className="group/stack relative pb-2"
      data-comment-stack={stackKey}
      data-comment-stack-state="folded"
      data-comment-stack-front={front.threadId}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <CommentStackSheets />
      <div
        className={cn(
          "relative mx-2 mr-4 grid rounded-xl transition-[translate] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transform-none motion-reduce:transition-none",
          isActive
            ? "-translate-x-2"
            : "group-hover/stack:-translate-x-2 group-focus-within/stack:-translate-x-2 motion-reduce:group-hover/stack:translate-x-0 motion-reduce:group-focus-within/stack:translate-x-0",
        )}
      >
        {/* The cards behind it, unseen: they keep the stack's size when
            another thread comes to the front. */}
        {threads.map((thread) =>
          thread === front || thread === leaving ? null : (
            <div
              key={`behind:${thread.threadId}`}
              aria-hidden
              inert
              className={cn(stackCardClass, "invisible")}
              data-comment-stack-behind={thread.threadId}
            >
              <StackFrontPreview
                thread={thread}
                quote={quoteOf(thread)}
                others={others}
                t={t}
              />
            </div>
          ),
        )}
        {/* The card it replaced, on its way out: only a picture of it. */}
        {leaving ? (
          <div
            key={`leaving:${motion.turn}`}
            aria-hidden
            inert
            className={cn(
              frontCardClass,
              "comment-stack-front-leave pointer-events-none",
            )}
            data-comment-stack-leaving={leaving.threadId}
          >
            <StackFrontPreview
              thread={leaving}
              quote={quoteOf(leaving)}
              others={threads.filter((thread) => thread !== leaving)}
              t={t}
            />
          </div>
        ) : null}
        {/* Inert keeps the preview's links out of reach, and leaves it out of
            the open button's description too; the hidden copy below is
            what a screen reader hears. */}
        <div
          key={`front:${front.threadId}`}
          className={cn(
            frontCardClass,
            "relative transition-[box-shadow] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transition-none",
            leaving && "comment-stack-front-enter",
            isActive
              ? "shadow-comment-emphasis ring-foreground/15"
              : "group-hover/stack:shadow-comment-emphasis group-focus-within/stack:shadow-comment-emphasis",
          )}
          data-comment-stack-front-card
        >
          <StackFrontPreview
            thread={front}
            quote={quote}
            others={others}
            t={t}
          />
        </div>
        <div hidden id={descriptionId} data-comment-stack-description>
          {quote ? <p>{quote}</p> : null}
          {first ? (
            <>
              <p>{firstName}</p>
              <p>{renderCommentBody(first.content, first.mentions)}</p>
            </>
          ) : null}
          {replies > 0 ? (
            <p>{t("comments.replyCount", { count: replies })}</p>
          ) : null}
          {stackAuthors(others).map(([email, name]) => (
            <p key={email}>{name}</p>
          ))}
          <p>{t("comments.stackMore", { count: others.length })}</p>
        </div>
        <button
          type="button"
          className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={false}
          aria-label={t("comments.stackShowAll", { count: threads.length })}
          aria-describedby={descriptionId}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          data-comment-stack-open
        />
      </div>
    </div>
  );
}

/** Above an open stack's cards: folds them back into one. */
export function CommentStackHeader({
  stackKey,
  top,
  onCollapse,
  t,
}: {
  stackKey: string;
  top: number;
  onCollapse: () => void;
  t: Translate;
}) {
  return (
    <div
      className="absolute inset-x-2 flex h-7 items-center transition-[top] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transition-none"
      style={{ top }}
      data-comment-stack={stackKey}
      data-comment-stack-state="open"
    >
      <button
        type="button"
        className="-ms-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded
        onClick={(event) => {
          event.stopPropagation();
          onCollapse();
        }}
        data-comment-stack-collapse
      >
        <IconChevronUp className="size-3.5" aria-hidden />
        {t("comments.stackCollapse")}
      </button>
    </div>
  );
}

/** The line beside an open stack's cards that ties them to one block. */
export function CommentStackGuide({
  top,
  height,
}: {
  top: number;
  height: number;
}): ReactNode {
  if (height <= 0) return null;
  return (
    <span
      aria-hidden
      className="absolute start-0.5 w-0.5 rounded-full bg-border transition-[top,height] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transition-none"
      style={{ top, height }}
      data-comment-stack-guide
    />
  );
}
