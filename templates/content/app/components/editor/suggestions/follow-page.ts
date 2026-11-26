import type {
  ResourceSuggestion,
  SuggestionOperation,
} from "@agent-native/core/review";
import { rebaseBodyEdit } from "@shared/body-rebase";
import { canonicalizeNfm } from "@shared/nfm";
import { SuggestionFormattingMappingError } from "@shared/suggestion-formatting";

import {
  canonicalSuggestionRevision,
  planSuggestionDraftPersistence,
  suggestionDraftOperations,
  suggestionOperationKey,
  type SuggestionDraftSession,
  type SuggestionPersistenceEntry,
} from "./draft-session";
import type { MarkdownSuggestionOperation } from "./markdown-operation";

/** How long the draft has to sit still before it moves to a newer Page. */
export const SUGGESTION_FOLLOW_QUIET_MS = 2000;
/** How often a busy draft checks again whether it can move. */
export const SUGGESTION_FOLLOW_RECHECK_MS = 500;

export type SuggestionPageFollow =
  | { kind: "stay" }
  | { kind: "wait"; ms: number }
  | { kind: "rebase"; baseRevision: string }
  | { kind: "restart" };

function bodyRevisionNumber(revision: string): number | null {
  const match = /^body:(0|[1-9]\d*):/.exec(revision);
  return match ? Number(match[1]) : null;
}

function pageIsNewer(
  page: { revision: string; updatedAt: string },
  base: { revision: string; updatedAt: string },
) {
  if (page.revision === base.revision) return false;
  const pageBody = bodyRevisionNumber(page.revision);
  const baseBody = bodyRevisionNumber(base.revision);
  if (pageBody !== null && baseBody !== null) return pageBody > baseBody;
  return page.updatedAt > base.updatedAt;
}

export function laterPage<
  Page extends { revision?: string; updatedAt: string },
>(first: Page, second: Page): Page {
  return pageIsNewer(
    {
      revision: canonicalSuggestionRevision(second),
      updatedAt: second.updatedAt,
    },
    {
      revision: canonicalSuggestionRevision(first),
      updatedAt: first.updatedAt,
    },
  )
    ? second
    : first;
}

/**
 * A suggestion is saved against the Page revision its draft started from, and
 * the server refuses one whose Page has since changed. When someone else
 * changes the Page, the draft moves to it once nothing typed here is waiting
 * to be saved and the typing has paused; until then it stays put, so the move
 * never replaces text the draft still holds.
 */
export function suggestionPageFollow(args: {
  session: Pick<
    SuggestionDraftSession,
    "baseContent" | "baseRevision" | "existingSuggestion"
  > | null;
  page: { content: string; revision: string; updatedAt: string };
  /** When the Page the draft started from was saved. */
  draftUpdatedAt: string;
  /** Nothing is unsaved, saving, or being decided. */
  settled: boolean;
  draftChangedAt: number | null;
  now: number;
}): SuggestionPageFollow {
  const { session, page } = args;
  // Amending a saved suggestion has its own conflict check and recovery.
  if (!session || session.existingSuggestion) return { kind: "stay" };
  if (
    !pageIsNewer(page, {
      revision: session.baseRevision,
      updatedAt: args.draftUpdatedAt,
    })
  )
    return { kind: "stay" };
  if (page.content === session.baseContent)
    return { kind: "rebase", baseRevision: page.revision };
  if (!args.settled) return { kind: "wait", ms: SUGGESTION_FOLLOW_RECHECK_MS };
  const quietFor =
    args.draftChangedAt === null
      ? SUGGESTION_FOLLOW_QUIET_MS
      : args.now - args.draftChangedAt;
  if (quietFor < SUGGESTION_FOLLOW_QUIET_MS)
    return { kind: "wait", ms: SUGGESTION_FOLLOW_QUIET_MS - quietFor };
  return { kind: "restart" };
}

function sameEdits(
  before: readonly MarkdownSuggestionOperation[],
  after: readonly MarkdownSuggestionOperation[],
) {
  if (after.length !== before.length) return false;
  const moved = after.values();
  return before.every((previous) => {
    const step = moved.next();
    return (
      !step.done &&
      step.value.kind === previous.kind &&
      step.value.before.changedText === previous.before.changedText &&
      step.value.after.changedText === previous.after.changedText
    );
  });
}

function savedMarkdown(operation: SuggestionOperation) {
  const { after } = operation;
  return after &&
    typeof after === "object" &&
    "markdown" in after &&
    typeof after.markdown === "string"
    ? canonicalizeNfm(after.markdown)
    : null;
}

export function carryOwnSuggestions(args: {
  session: SuggestionDraftSession;
  draft: string;
  next: SuggestionDraftSession;
  entries: ReadonlyMap<string, SuggestionPersistenceEntry>;
  latest: (
    id: string,
  ) => Pick<ResourceSuggestion, "status" | "revision"> | undefined;
  unsaved?: boolean;
}): {
  content: string;
  entries: Map<string, SuggestionPersistenceEntry>;
} | null {
  const { session, draft, next, entries } = args;
  const unsaved = args.unsaved === true;
  if ((entries.size === 0 && !unsaved) || session.existingSuggestion)
    return null;
  for (const { suggestion } of entries.values()) {
    const latest = args.latest(suggestion.id);
    if (latest?.status !== "pending" || latest.revision !== suggestion.revision)
      return null;
  }
  try {
    const before = suggestionDraftOperations(session, draft);
    const plan = planSuggestionDraftPersistence(before, entries);
    if (
      plan.unchanged.size + plan.amend.length !== entries.size ||
      plan.withdraw.length > 0 ||
      (!unsaved && plan.create.length + plan.amend.length > 0)
    )
      return null;
    const base = session.initialContent ?? canonicalizeNfm(session.baseContent);
    const current = next.initialContent ?? canonicalizeNfm(next.baseContent);
    const content = rebaseBodyEdit(base, draft, current);
    if (content === null) return null;
    const after = suggestionDraftOperations(next, content);
    if (!sameEdits(before, after)) return null;
    const carried = new Map<string, SuggestionPersistenceEntry>();
    const moved = after.values();
    for (const previous of before) {
      const step = moved.next();
      if (step.done) return null;
      const entry = entries.get(suggestionOperationKey(previous));
      if (entry) {
        const operation = step.value;
        carried.set(suggestionOperationKey(operation), { ...entry, operation });
      }
    }
    for (const { previousKey } of plan.amend) {
      const entry = entries.get(previousKey);
      const saved = entry ? savedMarkdown(entry.operation) : null;
      if (!entry || saved === null) return null;
      const savedOnNext = rebaseBodyEdit(base, saved, current);
      if (savedOnNext === null) return null;
      const savedBefore = suggestionDraftOperations(session, saved);
      const savedAfter = suggestionDraftOperations(next, savedOnNext);
      if (savedBefore.length !== 1 || !sameEdits(savedBefore, savedAfter))
        return null;
      for (const operation of savedAfter)
        carried.set(suggestionOperationKey(operation), { ...entry, operation });
    }
    return { content, entries: carried };
  } catch (error) {
    if (error instanceof SuggestionFormattingMappingError) return null;
    throw error;
  }
}

/**
 * Reads the Page again after its live copy changes, at most once per recheck.
 * A change while a read is on its way waits for that read and then reads once
 * more, rather than cancelling it: steady typing elsewhere would otherwise
 * keep every read from coming back. A read that joined one already on its way
 * reads once more too, since that one may have left before the change.
 */
export function readPageOnLiveCopyChange(args: {
  subscribe: (changed: () => void) => () => void;
  read: () => Promise<unknown>;
  alreadyReading: () => boolean;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reading = false;
  let readAgain = false;
  let stopped = false;
  const changed = () => {
    if (reading) readAgain = true;
    else if (!timer) timer = setTimeout(read, SUGGESTION_FOLLOW_RECHECK_MS);
  };
  const settled = () => {
    reading = false;
    if (readAgain && !stopped) changed();
  };
  const read = () => {
    timer = null;
    reading = true;
    readAgain = args.alreadyReading();
    void args.read().then(settled, settled);
  };
  const unsubscribe = args.subscribe(changed);
  return () => {
    stopped = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
