import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import type { SuggestionPlacement } from "@shared/suggestion-placement";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * An Accept or Reject made while editing. It shows from the click, saves in
 * click order, and leaves once the server's change has reached this tab.
 */
export interface QueuedSuggestionDecision {
  key: string;
  proposalId: string | null;
  decision: SuggestionDecision;
  members: ResourceSuggestion[];
  beforeContent: string;
}

/** What the open editor for a Page does as its queued decisions finish. */
export interface SuggestionDecisionView {
  failed(entry: QueuedSuggestionDecision, error: unknown): void;
  decided(entry: QueuedSuggestionDecision, decided: ResourceSuggestion[]): void;
  /** Resolves once this tab has the server's latest change. */
  catchUp(): Promise<boolean>;
  /**
   * Where the editor shows each suggestion's words, once this tab's typing
   * has reached the live copy the server writes the accept into.
   */
  placements(
    suggestionIds: readonly string[],
  ): Promise<Record<string, SuggestionPlacement>>;
}

interface PageDecisionQueue {
  entries: QueuedSuggestionDecision[];
  tail: Promise<void>;
  listeners: Set<() => void>;
}

// Decisions live outside the editor, per Page, so leaving the Page or opening
// another one never drops a decision that was already shown as made.
const queues = new Map<string, PageDecisionQueue>();
// Every editor showing a Page, latest last: when one closes, the one before
// it takes over.
const views = new Map<string, Array<{ current: SuggestionDecisionView }>>();
const NO_DECISIONS: QueuedSuggestionDecision[] = [];

function queueFor(documentId: string): PageDecisionQueue {
  let queue = queues.get(documentId);
  if (!queue) {
    queue = {
      entries: NO_DECISIONS,
      tail: Promise.resolve(),
      listeners: new Set(),
    };
    queues.set(documentId, queue);
  }
  return queue;
}

export function queuedSuggestionDecisions(
  documentId: string,
): QueuedSuggestionDecision[] {
  return queues.get(documentId)?.entries ?? NO_DECISIONS;
}

export function updateQueuedSuggestionDecisions(
  documentId: string,
  update: (current: QueuedSuggestionDecision[]) => QueuedSuggestionDecision[],
) {
  const queue = queueFor(documentId);
  queue.entries = update(queue.entries);
  warnBeforeUnloadWhileSaving();
  for (const listener of [...queue.listeners]) listener();
}

/** Runs `run` for the entry after every decision queued before it. */
export function enqueueSuggestionDecision(
  documentId: string,
  entry: QueuedSuggestionDecision,
  run: (entry: QueuedSuggestionDecision) => Promise<void>,
) {
  updateQueuedSuggestionDecisions(documentId, (queued) => [...queued, entry]);
  const queue = queueFor(documentId);
  queue.tail = queue.tail
    .then(() => run(entry))
    .catch(() => undefined)
    .finally(() =>
      updateQueuedSuggestionDecisions(documentId, (queued) =>
        queued.some((candidate) => candidate.key === entry.key)
          ? queued.filter((candidate) => candidate.key !== entry.key)
          : queued,
      ),
    );
}

/** Resolves once every decision queued for the Page has finished. */
export async function suggestionDecisionsSettled(documentId: string) {
  const queue = queues.get(documentId);
  while (queue?.entries.length) await queue.tail;
}

export function useQueuedSuggestionDecisions(documentId: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const queue = queueFor(documentId);
      queue.listeners.add(listener);
      return () => {
        queue.listeners.delete(listener);
      };
    },
    [documentId],
  );
  const snapshot = useCallback(
    () => queuedSuggestionDecisions(documentId),
    [documentId],
  );
  return useSyncExternalStore(subscribe, snapshot, () => NO_DECISIONS);
}

/** Routes a Page's finished decisions to the editor that shows it now. */
export function useSuggestionDecisionView(
  documentId: string,
  view: SuggestionDecisionView,
) {
  const ref = useRef(view);
  ref.current = view;
  useEffect(() => {
    views.set(documentId, [...(views.get(documentId) ?? []), ref]);
    return () => {
      const rest = (views.get(documentId) ?? []).filter((view) => view !== ref);
      if (rest.length) views.set(documentId, rest);
      else views.delete(documentId);
    };
  }, [documentId]);
}

export function suggestionDecisionView(
  documentId: string,
): SuggestionDecisionView | null {
  const open = views.get(documentId);
  return open?.[open.length - 1]?.current ?? null;
}

// Closing the tab while a decision is still saving would lose it.
let warning = false;
function confirmUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
}
function warnBeforeUnloadWhileSaving() {
  if (typeof window === "undefined") return;
  const saving = [...queues.values()].some((queue) => queue.entries.length);
  if (saving === warning) return;
  warning = saving;
  if (saving) window.addEventListener("beforeunload", confirmUnload);
  else window.removeEventListener("beforeunload", confirmUnload);
}
