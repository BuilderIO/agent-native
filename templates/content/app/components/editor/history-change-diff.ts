import type {
  DocumentHistoryChange,
  DocumentHistoryPageState,
} from "@shared/document-history";

/** A stretch of an entry's changes that followed one another with nothing between. */
export interface HistoryChangeSpan {
  before: DocumentHistoryPageState;
  after: DocumentHistoryPageState;
}

/**
 * Joins an entry's changes into spans: a change that starts from the page the
 * one before it left extends that span, and one that starts elsewhere, since
 * someone else edited in between, begins a new one.
 */
export function historyChangeSpans(
  changes: readonly DocumentHistoryChange[],
): HistoryChangeSpan[] {
  const spans: HistoryChangeSpan[] = [];
  let last: HistoryChangeSpan | undefined;
  for (const { before, after } of changes) {
    if (
      last &&
      last.after.title === before.title &&
      last.after.content === before.content
    ) {
      last.after = after;
    } else {
      last = { before, after };
      spans.push(last);
    }
  }
  return spans;
}
