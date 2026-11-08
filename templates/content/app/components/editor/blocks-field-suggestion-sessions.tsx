import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateResourceSuggestionProposal,
  useDecideResourceSuggestion,
  useDecideResourceSuggestionProposal,
  useUpdateResourceSuggestion,
} from "@agent-native/core/client/review";
import type {
  ResourceSuggestion,
  SuggestionDecision,
  SuggestionOperation,
} from "@agent-native/core/review";
import type { DocumentPropertiesResponse } from "@shared/api";
import {
  blocksFieldSuggestionRevision,
  CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
  suggestionBlocksFieldId,
} from "@shared/blocks-field-suggestions";
import { SuggestionFormattingMappingError } from "@shared/suggestion-formatting";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  nextSuggestionAutosaveRetryDelay,
  suggestionAutosaveDebounce,
} from "./suggestions/autosave-schedule";
import {
  createSuggestionDraftSession,
  forgetSuggestionProposalCreationIdempotencyKey,
  planSuggestionDraftPersistence,
  previewSuggestionDraft,
  recordSuggestionReplacementIntent,
  saveUnlessSuggestionChanged,
  suggestionAmendmentIdempotencyKey,
  suggestionDraftOperations,
  suggestionOperationKey,
  suggestionProposalCreationIdempotencyKey,
  suggestionSessionVisuals,
  unpersistedDraftSuggestions,
  withdrawnSessionSuggestionIds,
  type DraftSuggestion,
  type SuggestionDraftSession,
  type SuggestionPersistenceEntry,
} from "./suggestions/draft-session";
import type { SuggestionPresentationTransitions } from "./suggestions/presentation-rebase";
import { suggestionSourceThreadId } from "./thread-suggestions";
import type { VisualEditorSuggestion } from "./VisualEditor";

// Suggesting mode on a Blocks field tab other than the page body. Each tab
// keeps its own draft, made against the tab's saved text and revision, and
// saves it as suggestions on that field, which accepting writes into the
// field alone. The page body keeps its own draft in DocumentEditor.

const NO_TRANSITIONS: SuggestionPresentationTransitions = new Map();
const NO_VISUALS: VisualEditorSuggestion[] = [];
const NO_FIELDS: ReadonlySet<string> = new Set();
const NO_VIEWS: ReadonlyMap<string, ResourceSuggestion[]> = new Map();

type ProposalRequest = {
  resourceType: string;
  resourceId: string;
  adapterKind: string;
  baseRevision: string;
  summary: string;
  proposalId?: string;
  idempotencyKey: string;
  suggestions: Array<{ summary: string; operations: SuggestionOperation[] }>;
};

type FieldSession = {
  /** The page it suggests on, kept for saves that outlive the page. */
  documentId: string;
  fieldId: string;
  session: SuggestionDraftSession;
  draft: string;
  /** The tab's saved suggestions, keyed by the draft's edit that made each. */
  entries: Map<string, SuggestionPersistenceEntry>;
  proposalId: string | null;
  /** Changed since it was last saved. */
  dirty: boolean;
  /**
   * When it first changed after its last complete save. As with the body's
   * draft, typing without a pause still saves it once the max wait passes.
   */
  dirtySince: number | null;
  /**
   * Suggesting ended with edits unsaved or still saving. It's no longer the
   * tab's session, but it keeps trying to save them.
   */
  ended: boolean;
  /** The last save failed, so the next failure stays quiet while typing. */
  failed: boolean;
  /**
   * The draft's last save was refused, and no retry would change that, so
   * the page offers to discard it.
   */
  refused: boolean;
  /** A save is under way. */
  saving: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * The timer is a failed save's retry. As with the body's draft, typing
   * doesn't pull it earlier, or an outage becomes a request per pause.
   */
  retrying: boolean;
  /** The retry's wait, which grows while saves keep failing. */
  retryDelay: number;
  /** Saves run one at a time, in order. */
  queue: Promise<unknown>;
  /** A creation sent without an answer; it's sent again before anything else. */
  unresolved: {
    request: ProposalRequest;
    keys: string[];
    operations: SuggestionOperation[];
  } | null;
};

type PresentationsArgs = {
  savedSuggestions: ResourceSuggestion[];
  drafts: DraftSuggestion[];
  currentMarkdown: string;
  editingSuggestionId: null;
  pendingSuggestionId: null;
  transitions: SuggestionPresentationTransitions;
};

type ReplacementIntent = {
  beforeText: string;
  startOffset: number;
  beforeMarkdown: string;
};

type BlocksFieldSuggestionsValue = {
  suggesting: boolean;
  sessions: ReadonlyMap<string, { key: string; draft: string }>;
  start: (fieldId: string, base: { content: string; revision: number }) => void;
  change: (fieldId: string, markdown: string) => void;
  replacementIntent: (fieldId: string, intent: ReplacementIntent) => void;
  visuals: (fieldId: string, markdown: string) => VisualEditorSuggestion[];
  /** Tabs whose suggestions are being accepted or rejected. */
  decidingFields: ReadonlySet<string>;
  /** The page is saving every draft to leave Suggesting mode or the page. */
  leaving: boolean;
  activeSuggestionId: string | null;
  onActivateSuggestion: ((suggestionId: string) => void) | undefined;
  onHoverSuggestion: ((suggestionId: string | null) => void) | undefined;
  onAnchorsChange: (fieldId: string, suggestionIds: string[]) => void;
};

const BlocksFieldSuggestionsContext =
  createContext<BlocksFieldSuggestionsValue | null>(null);

export function BlocksFieldSuggestionsProvider({
  value,
  children,
}: {
  value: BlocksFieldSuggestionsValue;
  children: ReactNode;
}) {
  return (
    <BlocksFieldSuggestionsContext.Provider value={value}>
      {children}
    </BlocksFieldSuggestionsContext.Provider>
  );
}

/**
 * Suggesting for one tab's editor: its draft while the page suggests, and
 * the highlights of its saved suggestions.
 */
export function useBlocksFieldSuggestionEditor(fieldId: string) {
  const value = useContext(BlocksFieldSuggestionsContext);
  // Each is stable for as long as the page is, so the handlers are too.
  const start = value?.start;
  const change = value?.change;
  const replacementIntent = value?.replacementIntent;
  const activate = value?.onActivateSuggestion;
  const hover = value?.onHoverSuggestion;
  const anchorsChange = value?.onAnchorsChange;
  const handlers = useMemo(
    () => ({
      start: (base: { content: string; revision: number }) =>
        start?.(fieldId, base),
      change: (markdown: string) => change?.(fieldId, markdown),
      replacementIntent: (intent: ReplacementIntent) =>
        replacementIntent?.(fieldId, intent),
      activate: (suggestionId: string) => activate?.(suggestionId),
      hover: (suggestionId: string | null) => hover?.(suggestionId),
      anchorsChange: (suggestionIds: string[]) =>
        anchorsChange?.(fieldId, suggestionIds),
    }),
    [activate, anchorsChange, change, fieldId, hover, replacementIntent, start],
  );
  const fieldVisuals = value?.visuals;
  const visuals = useCallback(
    (markdown: string) => fieldVisuals?.(fieldId, markdown) ?? NO_VISUALS,
    [fieldId, fieldVisuals],
  );
  if (!value) return null;
  return {
    suggesting: value.suggesting,
    session: value.sessions.get(fieldId) ?? null,
    /**
     * The tab takes no typing: a decision on its suggestions, or the page's
     * last save before Suggesting mode ends, would leave what's typed unsaved.
     */
    readOnly: value.leaving || value.decidingFields.has(fieldId),
    visuals,
    activeSuggestionId: value.activeSuggestionId,
    ...handlers,
  };
}

function onField<T extends { operations: SuggestionOperation[] }>(
  suggestion: T,
  fieldId: string,
): T {
  return {
    ...suggestion,
    operations: suggestion.operations.map((operation) => ({
      ...operation,
      targetId: fieldId,
    })),
  };
}

function operationsOnField(
  operations: SuggestionOperation[],
  fieldId: string,
): SuggestionOperation[] {
  return operations.map((operation) => ({ ...operation, targetId: fieldId }));
}

function isConflict(error: unknown) {
  return (
    (error as { errorCode?: unknown } | null)?.errorCode ===
    "suggestion_conflict"
  );
}

function isClientError(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

function sameIds(left: readonly string[] | undefined, right: string[]) {
  return (
    !!left &&
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * The tab sessions of a page in Suggesting mode, and the review of the tabs'
 * saved suggestions: what the margin shows for them, and their decisions.
 */
export function useBlocksFieldSuggestions({
  documentId,
  suggesting,
  saving,
  authorEmail,
  saved,
  presentations,
  onSaved,
  refetchSuggestions,
  activeSuggestionId,
  onActivateSuggestion,
  onHoverSuggestion,
}: {
  documentId: string;
  /** The page is in Suggesting mode. */
  suggesting: boolean;
  /** The page is saving its own suggestions on its way out of Suggesting mode or off the page. */
  saving: boolean;
  authorEmail: string | null;
  /** The page's saved suggestions, freshest copy of each. */
  saved: readonly ResourceSuggestion[];
  /** How the page editor turns suggestions into highlights. */
  presentations: (args: PresentationsArgs) => VisualEditorSuggestion[];
  /** Suggestions a tab saved, so they show before the list is read again. */
  onSaved: (suggestions: ResourceSuggestion[]) => void;
  /**
   * Reads the page's suggestions again: the suggestions query's own
   * `refetch`, which resolves even when the read fails.
   */
  refetchSuggestions: () => Promise<{
    data?: { suggestions: ResourceSuggestion[] } | undefined;
    isError: boolean;
    error: Error | null;
  }>;
  activeSuggestionId: string | null;
  onActivateSuggestion?: (suggestionId: string) => void;
  onHoverSuggestion?: (suggestionId: string | null) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const createProposal = useCreateResourceSuggestionProposal();
  const updateSuggestion = useUpdateResourceSuggestion();
  const decideSuggestion = useDecideResourceSuggestion();
  const decideProposal = useDecideResourceSuggestionProposal();
  // Read through refs, so a session's saves and timers never hold a stale
  // copy and the callbacks below keep their identity.
  const mutations = {
    createProposal,
    updateSuggestion,
    decideSuggestion,
    decideProposal,
  };
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const tRef = useRef(t);
  tRef.current = t;

  const sessionsRef = useRef(new Map<string, FieldSession>());
  /** Ended sessions that are still saving what they hold. */
  const endedRef = useRef(new Set<FieldSession>());
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((current) => current + 1), []);
  const suggestingRef = useRef(suggesting);
  suggestingRef.current = suggesting;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const refetchRef = useRef(refetchSuggestions);
  refetchRef.current = refetchSuggestions;
  const amendmentKeysRef = useRef(new Map<string, string>());
  const creationKeysRef = useRef(new Map<string, string>());
  const [decidingFields, setDecidingFields] =
    useState<ReadonlySet<string>>(NO_FIELDS);
  /**
   * The saved suggestions each tab shows until its decided text is read:
   * those it showed when the decision began. Read and changed through the
   * ref, so a hold always builds on the one before it.
   */
  const [decidingViews, setDecidingViews] =
    useState<ReadonlyMap<string, ResourceSuggestion[]>>(NO_VIEWS);
  const decidingViewsRef = useRef(decidingViews);
  const changeViews = useCallback(
    (
      change: (
        views: ReadonlyMap<string, ResourceSuggestion[]>,
      ) => ReadonlyMap<string, ResourceSuggestion[]>,
    ) => {
      const next = change(decidingViewsRef.current);
      if (next === decidingViewsRef.current) return;
      decidingViewsRef.current = next;
      setDecidingViews(next);
    },
    [],
  );
  /** Stops the waits for decided tabs' text that hold their views. */
  const waitingReadsRef = useRef(new Set<() => void>());
  /** Counts the pages this one has left, so a late decision waits on none. */
  const pageLeftRef = useRef(0);
  const decidingRef = useRef(false);
  const [flushing, setFlushing] = useState(false);
  const [anchors, setAnchors] = useState<ReadonlyMap<string, string[]>>(
    () => new Map(),
  );

  const saveRef = useRef<
    (session: FieldSession, options: { autosave: boolean }) => Promise<boolean>
  >(() => Promise.resolve(true));
  /** Saves the draft after `delay`, or after the typing debounce. */
  const schedule = useCallback(
    (session: FieldSession, delay?: number, retrying = false) => {
      if (session.timer) clearTimeout(session.timer);
      session.retrying = retrying;
      const now = Date.now();
      session.timer = setTimeout(
        () => {
          session.timer = null;
          session.retrying = false;
          void saveRef.current(session, { autosave: true });
        },
        delay ?? suggestionAutosaveDebounce(session.dirtySince ?? now, now),
      );
    },
    [],
  );

  const latest = useCallback(async (id: string) => {
    const refreshed = await refetchRef.current();
    // A failed read still resolves, with the last list read, which mustn't
    // pass for the current one; the save fails and tries again instead.
    if (refreshed.isError || !refreshed.data)
      throw refreshed.error ?? new Error("Could not refresh suggestions");
    return refreshed.data.suggestions.find(
      (suggestion) => suggestion.id === id,
    );
  }, []);

  const persist = useCallback(
    async (session: FieldSession, autosave: boolean): Promise<boolean> => {
      const draft = session.draft;
      session.dirty = false;
      session.saving = true;
      const savedNow: ResourceSuggestion[] = [];
      const record = (
        created: {
          proposal: { id: string };
          suggestions: ResourceSuggestion[];
        },
        keys: string[],
        operations: SuggestionOperation[],
        idempotencyKey: string,
      ) => {
        if (
          created.suggestions.length !== operations.length ||
          keys.length !== operations.length
        )
          throw new Error("Proposal creation returned an incomplete edit set");
        session.proposalId = created.proposal.id;
        // The three lists line up, one entry per edit, as checked above.
        const savedKeys = keys.values();
        const savedSuggestions = created.suggestions.values();
        for (const operation of operations) {
          const key = savedKeys.next();
          const suggestion = savedSuggestions.next();
          if (key.done || suggestion.done) break;
          session.entries.set(key.value, {
            idempotencyKey,
            operation,
            suggestion: suggestion.value,
          });
        }
        savedNow.push(...created.suggestions);
      };
      try {
        const unresolved = session.unresolved;
        if (unresolved) {
          record(
            await mutationsRef.current.createProposal.mutateAsync(
              unresolved.request,
            ),
            unresolved.keys,
            unresolved.operations,
            unresolved.request.idempotencyKey,
          );
          forgetSuggestionProposalCreationIdempotencyKey(
            creationKeysRef.current,
            unresolved.request,
          );
          session.unresolved = null;
        }
        const operations = operationsOnField(
          suggestionDraftOperations(session.session, draft),
          session.fieldId,
        );
        const plan = planSuggestionDraftPersistence(
          operations,
          session.entries,
        );
        const conflictCheck = { isConflict, latest };
        for (const { key, suggestion } of plan.withdraw) {
          const withdrawn = await saveUnlessSuggestionChanged(
            suggestion,
            async () =>
              (
                await mutationsRef.current.decideSuggestion.mutateAsync({
                  id: suggestion.id,
                  decision: "withdrawn",
                  idempotencyKey: `withdraw:${suggestion.id}:${suggestion.revision}`,
                  observedBase: suggestion.baseRevision,
                  observedRevision: suggestion.revision,
                })
              ).suggestion,
            conflictCheck,
          );
          if (withdrawn.status === "saved") savedNow.push(withdrawn.result);
          // Decided or amended elsewhere, it's no longer this draft's.
          session.entries.delete(key);
        }
        const create = [...plan.create];
        for (const amendment of plan.amend) {
          const target = amendment.suggestion;
          const amended = await saveUnlessSuggestionChanged(
            target,
            async () => {
              const idempotencyKey = suggestionAmendmentIdempotencyKey(
                amendmentKeysRef.current,
                target,
                amendment.key,
              );
              const suggestion =
                await mutationsRef.current.updateSuggestion.mutateAsync({
                  id: target.id,
                  observedRevision: target.revision,
                  idempotencyKey,
                  operations: [amendment.operation],
                });
              return { idempotencyKey, suggestion };
            },
            conflictCheck,
          );
          session.entries.delete(amendment.previousKey);
          if (amended.status !== "saved") {
            // Decided or amended elsewhere while the author kept typing: the
            // current text is suggested anew rather than lost.
            create.push({ key: amendment.key, operation: amendment.operation });
            continue;
          }
          session.entries.set(amendment.key, {
            ...amended.result,
            operation: amendment.operation,
          });
          savedNow.push(amended.result.suggestion);
        }
        if (create.length > 0) {
          const summary = tRef.current("editor.toolbar.suggestEdits");
          const pending = create.map(({ operation }) => operation);
          const keys = create.map(({ key }) => key);
          const fields = {
            resourceType: "document",
            resourceId: session.documentId,
            adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
            baseRevision: session.session.baseRevision,
            summary,
            ...(session.proposalId === null
              ? {}
              : { proposalId: session.proposalId }),
            suggestions: pending.map((operation) => ({
              summary,
              operations: [operation],
            })),
          };
          const request = {
            ...fields,
            idempotencyKey: suggestionProposalCreationIdempotencyKey(
              creationKeysRef.current,
              fields,
            ),
          };
          session.unresolved = { request, keys, operations: pending };
          record(
            await mutationsRef.current.createProposal.mutateAsync(request),
            keys,
            pending,
            request.idempotencyKey,
          );
          forgetSuggestionProposalCreationIdempotencyKey(
            creationKeysRef.current,
            request,
          );
          session.unresolved = null;
        }
        session.failed = false;
        session.refused = false;
        session.retryDelay = 0;
        // Typing during the save keeps the old start, so the max wait still
        // counts from the first edit this save missed.
        if (session.draft === draft) session.dirtySince = null;
        return true;
      } catch (error) {
        session.dirty = true;
        const refused = isClientError(error);
        if (refused && session.unresolved) {
          // A refused creation would be refused again; the draft is
          // suggested afresh on the next save.
          forgetSuggestionProposalCreationIdempotencyKey(
            creationKeysRef.current,
            session.unresolved.request,
          );
          session.unresolved = null;
        }
        const quiet = autosave && session.failed;
        session.failed = true;
        if (refused || error instanceof SuggestionFormattingMappingError) {
          session.refused = true;
          // No retry follows a refusal, so typing saves again, with its max
          // wait started over; past the old one, every keystroke would save.
          session.dirtySince = Date.now();
        }
        if (error instanceof SuggestionFormattingMappingError) {
          if (!autosave)
            toast.error(tRef.current("editor.suggestionFormattingUnsupported"));
          return false;
        }
        if (!refused) {
          // A save that failed on the server, or never reached it, is tried
          // again, less often the longer it keeps failing. That includes a
          // decision's or the leaving save, which cleared any retry waiting.
          session.retryDelay = nextSuggestionAutosaveRetryDelay(
            session.retryDelay,
          );
          schedule(session, session.retryDelay, true);
        }
        if (!quiet) {
          toast.error(tRef.current("editor.suggestionCreateFailed"), {
            description:
              actionErrorMessage(error) ?? tRef.current("empty.genericError"),
          });
        }
        return false;
      } finally {
        session.saving = false;
        // No retry would change a refusal, so nothing is left to wait for.
        if (session.refused || (!session.dirty && !session.unresolved))
          endedRef.current.delete(session);
        if (savedNow.length > 0) onSavedRef.current(savedNow);
        bump();
      }
    },
    [bump, latest, schedule],
  );

  /** Saves the tab's draft after any save already under way. */
  const save = useCallback(
    (
      session: FieldSession,
      { autosave }: { autosave: boolean },
    ): Promise<boolean> => {
      if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
      }
      session.retrying = false;
      const run = session.queue.then(() => {
        // A session a decision replaced was saved before it; one that ended
        // with unsaved edits keeps saving them, retries included.
        if (
          !session.ended &&
          sessionsRef.current.get(session.fieldId) !== session
        )
          return true;
        if (!session.dirty && !session.unresolved) return true;
        return persist(session, autosave);
      });
      // coercion-ok: the queue only orders saves; `run` reports its failure.
      session.queue = run.catch(() => false);
      return run;
    },
    [persist],
  );
  saveRef.current = save;

  /** Ends every tab's session, saving what each hasn't saved yet. */
  const endSessions = useCallback(() => {
    const sessions = [...sessionsRef.current.values()];
    if (sessions.length === 0) return;
    sessionsRef.current.clear();
    for (const session of sessions) {
      // A save under way has cleared `dirty`, and it may yet fail.
      if (session.dirty || session.saving || session.unresolved) {
        session.ended = true;
        endedRef.current.add(session);
        void save(session, { autosave: true });
      } else if (session.timer) clearTimeout(session.timer);
    }
    bump();
  }, [bump, save]);

  useEffect(() => {
    if (!suggesting) endSessions();
  }, [endSessions, suggesting]);
  const endSessionsRef = useRef(endSessions);
  endSessionsRef.current = endSessions;
  // Another page, or none: what this one's tabs hold is saved as it goes.
  useEffect(() => () => endSessionsRef.current(), [documentId]);
  // Another row of the Collection has the same tabs; none of this page's
  // held views carry over to it.
  useEffect(
    () => () => {
      pageLeftRef.current += 1;
      for (const stop of waitingReadsRef.current) stop();
      waitingReadsRef.current.clear();
      changeViews(() => NO_VIEWS);
    },
    [changeViews, documentId],
  );

  useEffect(() => {
    // Suggesting mode may have ended, but what it left unsaved still counts.
    const unsavedSessions = () => [
      ...sessionsRef.current.values(),
      ...endedRef.current,
    ];
    const saveNow = () => {
      for (const session of unsavedSessions()) {
        if (session.dirty) void save(session, { autosave: true });
      }
    };
    const onVisibilityChange = () => {
      if (window.document.visibilityState === "hidden") saveNow();
    };
    // As the body's draft does, a tab's unsaved or saving draft asks before
    // the browser leaves the page, since a refusal then has nowhere to show.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const unsaved = unsavedSessions().some(
        (session) =>
          session.dirty || session.saving || session.unresolved !== null,
      );
      if (!unsaved) return;
      saveNow();
      event.preventDefault();
    };
    window.addEventListener("blur", saveNow);
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", saveNow);
      window.removeEventListener("pagehide", saveNow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    };
  }, [save]);

  const start = useCallback(
    (fieldId: string, base: { content: string; revision: number }) => {
      if (!suggestingRef.current || sessionsRef.current.has(fieldId)) return;
      // A draft Suggesting mode left still saving is the tab's again, so its
      // edits aren't suggested a second time by a fresh draft. Like any
      // session, it keeps the text it started from.
      for (const ended of endedRef.current) {
        if (ended.documentId !== documentId || ended.fieldId !== fieldId)
          continue;
        endedRef.current.delete(ended);
        ended.ended = false;
        sessionsRef.current.set(fieldId, ended);
        bump();
        return;
      }
      sessionsRef.current.set(fieldId, {
        documentId,
        fieldId,
        session: createSuggestionDraftSession({
          id: globalThis.crypto.randomUUID(),
          baseContent: base.content,
          baseRevision: blocksFieldSuggestionRevision(fieldId, base.revision),
          startedAt: new Date().toISOString(),
        }),
        draft: base.content,
        entries: new Map(),
        proposalId: null,
        dirty: false,
        dirtySince: null,
        ended: false,
        failed: false,
        refused: false,
        saving: false,
        timer: null,
        retrying: false,
        retryDelay: 0,
        queue: Promise.resolve(),
        unresolved: null,
      });
      bump();
    },
    [bump, documentId],
  );

  const change = useCallback(
    (fieldId: string, markdown: string) => {
      const session = sessionsRef.current.get(fieldId);
      if (!session || session.draft === markdown) return;
      session.draft = markdown;
      session.dirty = true;
      session.dirtySince ??= Date.now();
      if (!session.retrying) schedule(session);
      bump();
    },
    [bump, schedule],
  );

  const replacementIntent = useCallback(
    (fieldId: string, intent: ReplacementIntent) => {
      const session = sessionsRef.current.get(fieldId)?.session;
      if (
        !session ||
        previewSuggestionDraft(session, intent.beforeMarkdown, null).status !==
          "ready"
      )
        return;
      if (
        recordSuggestionReplacementIntent(
          session,
          intent,
          intent.beforeMarkdown,
        )
      )
        bump();
    },
    [bump],
  );

  const onAnchorsChange = useCallback(
    (fieldId: string, suggestionIds: string[]) => {
      setAnchors((current) => {
        if (sameIds(current.get(fieldId), suggestionIds)) return current;
        const next = new Map(current);
        next.set(fieldId, suggestionIds);
        return next;
      });
    },
    [],
  );

  // What the sessions hold at this revision (they live in a ref, and
  // `revision` counts their changes): drafts not saved yet, each saved
  // suggestion as its draft shows it, and the suggestions it took back.
  const derived = useMemo(() => {
    const sessions = new Map<string, { key: string; draft: string }>();
    const drafts: DraftSuggestion[] = [];
    const visuals = new Map<string, DraftSuggestion[]>();
    const editing = new Map<string, SuggestionOperation[]>();
    const withdrawn = new Set<string>();
    const refused: Array<{ fieldId: string; draft: string }> = [];
    for (const session of sessionsRef.current.values()) {
      sessions.set(session.fieldId, {
        key: session.session.id,
        draft: session.draft,
      });
      if (session.refused)
        refused.push({ fieldId: session.fieldId, draft: session.draft });
      const preview = previewSuggestionDraft(
        session.session,
        session.draft,
        authorEmail,
      );
      if (preview.status !== "ready") continue;
      const own = preview.suggestions.map((draft) =>
        onField(draft, session.fieldId),
      );
      const unsaved = unpersistedDraftSuggestions(own, session.entries);
      drafts.push(...unsaved);
      const unsavedIds = new Set(unsaved.map((draft) => draft.id));
      const shown = suggestionSessionVisuals(own, session.entries);
      visuals.set(session.fieldId, shown);
      for (const visual of shown) {
        if (!unsavedIds.has(visual.id))
          editing.set(visual.id, visual.operations);
      }
      for (const id of withdrawnSessionSuggestionIds(own, session.entries))
        withdrawn.add(id);
    }
    return {
      revision,
      sessions,
      drafts,
      visuals,
      editing,
      withdrawn,
      refused,
    };
  }, [authorEmail, revision]);

  /** The tabs' saved suggestions, as their drafts show them. */
  const suggestions = useMemo(
    () =>
      saved.flatMap((suggestion) => {
        if (
          suggestionBlocksFieldId(suggestion) === null ||
          derived.withdrawn.has(suggestion.id)
        )
          return [];
        const operations = derived.editing.get(suggestion.id);
        return [operations ? { ...suggestion, operations } : suggestion];
      }),
    [derived, saved],
  );
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;

  const visuals = useCallback(
    (fieldId: string, markdown: string) => {
      const shown = derived.visuals.get(fieldId) ?? [];
      const inSession = new Set(shown.map((visual) => visual.id));
      return presentations({
        savedSuggestions: (decidingViews.get(fieldId) ?? suggestions).filter(
          (suggestion) =>
            suggestion.status === "pending" &&
            !inSession.has(suggestion.id) &&
            suggestionBlocksFieldId(suggestion) === fieldId,
        ),
        drafts: shown,
        currentMarkdown: markdown,
        editingSuggestionId: null,
        pendingSuggestionId: null,
        transitions: NO_TRANSITIONS,
      });
    },
    [decidingViews, derived, presentations, suggestions],
  );

  const provider = useMemo<BlocksFieldSuggestionsValue>(
    () => ({
      suggesting,
      sessions: derived.sessions,
      start,
      change,
      replacementIntent,
      visuals,
      decidingFields,
      leaving: flushing || saving,
      activeSuggestionId,
      onActivateSuggestion,
      onHoverSuggestion,
      onAnchorsChange,
    }),
    [
      activeSuggestionId,
      change,
      decidingFields,
      derived.sessions,
      flushing,
      onActivateSuggestion,
      onAnchorsChange,
      onHoverSuggestion,
      replacementIntent,
      saving,
      start,
      suggesting,
      visuals,
    ],
  );

  /**
   * Saves every tab's draft before the page leaves Suggesting mode or the
   * page; false when one couldn't be. The tabs take no typing meanwhile, so
   * nothing typed after a tab's save is left to a session that has ended.
   */
  const flushAll = useCallback(async () => {
    setFlushing(true);
    try {
      const results = await Promise.all(
        [...sessionsRef.current.values()].map((session) =>
          save(session, { autosave: false }),
        ),
      );
      return results.every(Boolean);
    } finally {
      setFlushing(false);
    }
  }, [save]);

  /** The saved copy of a draft, once its tab's draft is saved. */
  const materializeDraft = useCallback(
    async (draft: DraftSuggestion): Promise<ResourceSuggestion | null> => {
      const fieldId = suggestionBlocksFieldId(draft);
      const session = fieldId ? sessionsRef.current.get(fieldId) : undefined;
      if (!session || !(await save(session, { autosave: false }))) return null;
      const first = draft.operations.values().next();
      if (first.done) return null;
      const operation = first.value;
      const exact = session.entries.get(suggestionOperationKey(operation));
      if (exact) return exact.suggestion;
      // Typing since the draft rendered changed its edit; the saved edit at
      // the same place stands in for it.
      const range = operation.anchor as { from: number; to: number };
      for (const entry of session.entries.values()) {
        const saved = entry.operation.anchor as { from: number; to: number };
        if (saved.from <= range.to && range.from <= saved.to)
          return entry.suggestion;
      }
      return null;
    },
    [save],
  );

  /**
   * The freshest copy of a saved suggestion this page knows: the highest
   * revision among a tab's own save of it and the list, which has someone
   * else's amendment first.
   */
  const freshest = useCallback((suggestion: ResourceSuggestion) => {
    let freshestCopy = suggestion;
    const consider = (candidate: ResourceSuggestion | undefined) => {
      if (
        candidate?.id === suggestion.id &&
        candidate.revision > freshestCopy.revision
      )
        freshestCopy = candidate;
    };
    for (const session of sessionsRef.current.values()) {
      for (const entry of session.entries.values()) consider(entry.suggestion);
    }
    consider(
      savedRef.current.find((candidate) => candidate.id === suggestion.id),
    );
    return freshestCopy;
  }, []);

  /**
   * Reads the tabs' text afresh, trying again while that fails for as long
   * as one of `sessions` is still its tab's. Reports whether it was read.
   * With `comments`, the page's comments are asked for in the same run, so
   * the two reads share a batch and land together: a tab never shows its
   * new text with a thread's old quote. It waits for both. Comments that
   * fail to load are asked for once more, and don't fail the read.
   */
  const reread = useCallback(
    async (sessions: FieldSession[], comments: boolean) => {
      const current = () =>
        sessions.some(
          (session) => sessionsRef.current.get(session.fieldId) === session,
        );
      const commentsKey = ["action", "list-comments", { documentId }];
      let delay = 0;
      for (;;) {
        const text = queryClient.refetchQueries(
          { queryKey: ["action", "list-document-properties", { documentId }] },
          { throwOnError: true },
        );
        const quotes = comments
          ? queryClient
              .refetchQueries({ queryKey: commentsKey }, { throwOnError: true })
              .catch(() =>
                queryClient.invalidateQueries({ queryKey: commentsKey }),
              )
              .catch(() => undefined)
          : undefined;
        try {
          await text;
          await quotes;
          return true;
        } catch (error) {
          if (!current()) return false;
          if (delay === 0) {
            toast.error(tRef.current("empty.genericError"), {
              description: actionErrorMessage(error) ?? undefined,
            });
          }
          delay = nextSuggestionAutosaveRetryDelay(delay);
          await new Promise((resolve) => setTimeout(resolve, delay));
          // Suggesting mode ended, or the page closed, meanwhile.
          if (!current()) return false;
        }
      }
    },
    [documentId, queryClient],
  );

  /**
   * Holds what tabs show of their saved suggestions as it is now. A tab
   * still holding an earlier decision's view, because the text with that
   * decision is unread, keeps it, with any suggestion shown since added.
   * Returns what lets this hold go, what drops suggestions from it, and the
   * tabs that kept an earlier view. A later hold on a tab replaces this one
   * there.
   */
  const holdViews = useCallback(
    (fieldIds: string[]) => {
      const held = new Map<string, ResourceSuggestion[]>();
      const carried = new Set<string>();
      for (const fieldId of new Set(fieldIds)) {
        const shown = suggestionsRef.current.filter(
          (suggestion) => suggestionBlocksFieldId(suggestion) === fieldId,
        );
        const earlier = decidingViewsRef.current.get(fieldId);
        if (earlier) carried.add(fieldId);
        held.set(
          fieldId,
          earlier
            ? [
                ...earlier,
                ...shown.filter(
                  (suggestion) =>
                    !earlier.some((kept) => kept.id === suggestion.id),
                ),
              ]
            : shown,
        );
      }
      changeViews((views) => new Map([...views, ...held]));
      const release = () =>
        changeViews((views) => {
          const kept = new Map(
            [...views].filter(([fieldId, view]) => held.get(fieldId) !== view),
          );
          if (kept.size === views.size) return views;
          return kept.size > 0 ? kept : NO_VIEWS;
        });
      const drop = (ids: ReadonlySet<string>) =>
        changeViews((views) => {
          let next = views;
          for (const [fieldId, view] of held) {
            if (views.get(fieldId) !== view) continue;
            const kept = view.filter((suggestion) => !ids.has(suggestion.id));
            if (kept.length === view.length) continue;
            held.set(fieldId, kept);
            next = new Map([...next, [fieldId, kept]]);
          }
          return next;
        });
      return { release, drop, carried };
    },
    [changeViews],
  );

  /**
   * The revisions of a tab's text that the page shows: one for each read of
   * its properties on screen that has the tab.
   */
  const shownRevisions = useCallback(
    (fieldId: string) =>
      queryClient
        .getQueryCache()
        .findAll({
          queryKey: ["action", "list-document-properties", { documentId }],
        })
        .filter((query) => query.getObserversCount() > 0)
        .flatMap((query) => {
          const read = query.state.data as
            | DocumentPropertiesResponse
            | undefined;
          const revision = read?.properties.find(
            (property) => property.definition.id === fieldId,
          )?.blocksField?.revision;
          return revision === undefined ? [] : [revision];
        }),
    [documentId, queryClient],
  );

  /**
   * Runs `then` once the page shows each tab of `revisions` past the
   * revision given for it, at once if it already does.
   */
  const afterTextRead = useCallback(
    (revisions: ReadonlyMap<string, number>, then: () => void) => {
      const read = () =>
        [...revisions].every(([fieldId, revision]) =>
          shownRevisions(fieldId).every((shown) => shown > revision),
        );
      if (read()) {
        then();
        return;
      }
      const stop = queryClient.getQueryCache().subscribe(() => {
        if (!read()) return;
        stop();
        waitingReadsRef.current.delete(stop);
        then();
      });
      waitingReadsRef.current.add(stop);
    },
    [queryClient, shownRevisions],
  );

  /**
   * Runs a decision on tabs' suggestions: their drafts are saved first, and
   * afterwards the tabs read their text again and start new drafts on it.
   * `run` reports the suggestions it decided.
   */
  const decideOnFields = useCallback(
    async (fieldIds: string[], run: () => Promise<ResourceSuggestion[]>) => {
      if (decidingRef.current) return;
      decidingRef.current = true;
      const pagesLeft = pageLeftRef.current;
      // The tabs stop taking typing until they restart on the decided text,
      // so nothing typed meanwhile is dropped with the old draft.
      setDecidingFields(new Set(fieldIds));
      // They also show their suggestions as they were until their text is
      // read: the list drops an accepted suggestion before the text holding
      // it arrives, and the tab would show its old text without it meanwhile.
      const views = holdViews(fieldIds);
      const shownBefore = new Map(
        [...new Set(fieldIds)].map((fieldId) => [
          fieldId,
          Math.max(-1, ...shownRevisions(fieldId)),
        ]),
      );
      /** The tabs whose changed text is still unread. */
      let unread: string[] = [];
      // Accepting moves each asking thread's quote onto the tab's new text.
      let movedQuotes = false;
      try {
        for (const fieldId of new Set(fieldIds)) {
          const session = sessionsRef.current.get(fieldId);
          if (session && !(await save(session, { autosave: false }))) return;
        }
        const outcomes = await run();
        const accepted = outcomes.filter(
          (suggestion) => suggestion.status === "accepted",
        );
        // A suggestion decided any other way left the text as it was, so the
        // tabs stop showing it now rather than when their text is read.
        views.drop(
          new Set(
            outcomes
              .filter((suggestion) => suggestion.status !== "accepted")
              .map((suggestion) => suggestion.id),
          ),
        );
        movedQuotes = accepted.some((suggestion) =>
          suggestionSourceThreadId(suggestion),
        );
        // Accepting changed the tabs' text, and a tab that kept an earlier
        // decision's view has that decision's change still to read.
        unread = [
          ...new Set([
            ...views.carried,
            ...(accepted.length > 0 ? fieldIds : []),
          ]),
        ];
        const decided = [...new Set(fieldIds)].flatMap(
          (fieldId) => sessionsRef.current.get(fieldId) ?? [],
        );
        // A tab restarted on its cached text would miss an accepted edit and
        // save its next draft on an old base. Until the text is read, the
        // tabs keep their old drafts, which have nothing unsaved.
        if (!(await reread(decided, movedQuotes))) return;
        unread = [];
        let restarted = false;
        for (const session of decided) {
          if (sessionsRef.current.get(session.fieldId) !== session) continue;
          if (session.timer) clearTimeout(session.timer);
          sessionsRef.current.delete(session.fieldId);
          restarted = true;
        }
        if (restarted) bump();
      } catch (error) {
        toast.error(tRef.current("empty.genericError"), {
          description: actionErrorMessage(error) ?? undefined,
        });
        void refetchRef.current().catch(() => undefined);
      } finally {
        decidingRef.current = false;
        setDecidingFields(NO_FIELDS);
        // Changed text that couldn't be read now, outside Suggesting mode or
        // after it ended, comes with the page's next read of it, which its
        // sync makes after a decision. Its tabs keep their views until the
        // page shows it, and the moved quotes are read after it. A page left
        // meanwhile waits on nothing.
        if (unread.length === 0 || pagesLeft !== pageLeftRef.current)
          views.release();
        else
          afterTextRead(
            new Map(
              unread.map((fieldId) => [
                fieldId,
                shownBefore.get(fieldId) ?? -1,
              ]),
            ),
            () => {
              views.release();
              if (movedQuotes)
                void queryClient.invalidateQueries({
                  queryKey: ["action", "list-comments", { documentId }],
                });
            },
          );
      }
    },
    [
      afterTextRead,
      bump,
      documentId,
      holdViews,
      queryClient,
      reread,
      save,
      shownRevisions,
    ],
  );

  const decide = useCallback(
    (
      target: ResourceSuggestion | DraftSuggestion,
      decision: SuggestionDecision,
    ) => {
      const fieldId = suggestionBlocksFieldId(target);
      if (!fieldId) return Promise.resolve();
      return decideOnFields([fieldId], async () => {
        const savedTarget =
          "durability" in target
            ? await materializeDraft(target)
            : freshest(target);
        if (!savedTarget) return [];
        const result = await mutationsRef.current.decideSuggestion.mutateAsync({
          id: savedTarget.id,
          decision,
          idempotencyKey: globalThis.crypto.randomUUID(),
          observedBase: savedTarget.baseRevision,
          observedRevision: savedTarget.revision,
        });
        return [result.suggestion];
      });
    },
    [decideOnFields, freshest, materializeDraft],
  );

  const decideMembers = useCallback(
    (
      proposalId: string,
      decision: SuggestionDecision,
      members: ResourceSuggestion[],
    ) =>
      decideOnFields(
        members.flatMap((member) => suggestionBlocksFieldId(member) ?? []),
        async () => {
          const current = members.map(freshest);
          const result = await mutationsRef.current.decideProposal.mutateAsync({
            proposalId,
            decision,
            idempotencyKey: globalThis.crypto.randomUUID(),
            members: current.map((member) => ({
              id: member.id,
              observedRevision: member.revision,
              observedBase: member.baseRevision,
            })),
          });
          return result.suggestions;
        },
      ),
    [decideOnFields, freshest],
  );

  /**
   * Drops a tab's refused draft and starts the tab again from its saved
   * text, read afresh: a draft is most often refused because that text
   * changed under it. Its suggestions saved before stay. If the text can't
   * be read, the draft stays too, since a draft restarted on the old text
   * would be refused again.
   */
  const discard = useCallback(
    async (fieldId: string) => {
      const session = sessionsRef.current.get(fieldId);
      if (!session || decidingRef.current) return;
      decidingRef.current = true;
      setDecidingFields(new Set([fieldId]));
      try {
        await queryClient.refetchQueries(
          { queryKey: ["action", "list-document-properties", { documentId }] },
          { throwOnError: true },
        );
        if (session.timer) clearTimeout(session.timer);
        if (sessionsRef.current.get(fieldId) === session)
          sessionsRef.current.delete(fieldId);
      } catch (error) {
        toast.error(tRef.current("empty.genericError"), {
          description: actionErrorMessage(error) ?? undefined,
        });
      } finally {
        decidingRef.current = false;
        setDecidingFields(NO_FIELDS);
        bump();
      }
    },
    [bump, documentId, queryClient],
  );

  const hasOpen =
    derived.drafts.length > 0 ||
    suggestions.some((suggestion) => suggestion.status === "pending");

  return {
    provider,
    /** The tabs' saved suggestions, as the margin and panel show them. */
    suggestions,
    /** The tabs' drafts not saved yet. */
    drafts: derived.drafts,
    /** Suggestions each tab's editor shows, by field. */
    anchors,
    hasOpen,
    deciding: decidingFields.size > 0,
    /** Tabs whose draft the server refused, with what each holds. */
    refusedDrafts: derived.refused,
    discard,
    flushAll,
    materializeDraft,
    decide,
    decideProposal: decideMembers,
  };
}
