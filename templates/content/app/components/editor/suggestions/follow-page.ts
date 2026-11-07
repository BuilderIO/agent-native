import type { SuggestionDraftSession } from "./draft-session";

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
