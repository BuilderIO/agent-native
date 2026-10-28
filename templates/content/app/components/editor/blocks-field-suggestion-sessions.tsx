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
  blocksFieldSuggestionRevision,
  CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
  suggestionBlocksFieldId,
} from "@shared/blocks-field-suggestions";
import { SuggestionFormattingMappingError } from "@shared/suggestion-formatting";

import { SUGGESTION_AUTOSAVE_IDLE_MS } from "./suggestions/autosave-schedule";
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
import type { VisualEditorSuggestion } from "./VisualEditor";

// Suggesting mode on a Blocks field tab other than the page body. Each tab
// keeps its own draft, made against the tab's saved text and revision, and
// saves it as suggestions on that field, which accepting writes into the
// field alone. The page body keeps its own draft in DocumentEditor.

/** A save that failed on the server, or never reached it, is tried again. */
const RETRY_MS = 5000;
const NO_TRANSITIONS: SuggestionPresentationTransitions = new Map();
const NO_VISUALS: VisualEditorSuggestion[] = [];

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
  fieldId: string;
  session: SuggestionDraftSession;
  draft: string;
  /** The tab's saved suggestions, keyed by the draft's edit that made each. */
  entries: Map<string, SuggestionPersistenceEntry>;
  proposalId: string | null;
  /** Changed since it was last saved. */
  dirty: boolean;
  /** The last save failed, so the next failure stays quiet while typing. */
  failed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
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
  authorEmail: string | null;
  /** The page's saved suggestions, freshest copy of each. */
  saved: readonly ResourceSuggestion[];
  /** How the page editor turns suggestions into highlights. */
  presentations: (args: PresentationsArgs) => VisualEditorSuggestion[];
  /** Suggestions a tab saved, so they show before the list is read again. */
  onSaved: (suggestions: ResourceSuggestion[]) => void;
  refetchSuggestions: () => Promise<ResourceSuggestion[] | undefined>;
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
  const [deciding, setDeciding] = useState(false);
  const decidingRef = useRef(false);
  const [anchors, setAnchors] = useState<ReadonlyMap<string, string[]>>(
    () => new Map(),
  );

  const saveRef = useRef<
    (session: FieldSession, options: { autosave: boolean }) => Promise<boolean>
  >(() => Promise.resolve(true));
  const schedule = useCallback(
    (session: FieldSession, delay = SUGGESTION_AUTOSAVE_IDLE_MS) => {
      if (session.timer) clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        session.timer = null;
        void saveRef.current(session, { autosave: true });
      }, delay);
    },
    [],
  );

  const latest = useCallback(async (id: string) => {
    const suggestions = await refetchRef.current();
    if (!suggestions) throw new Error("Could not refresh suggestions");
    return suggestions.find((suggestion) => suggestion.id === id);
  }, []);

  const persist = useCallback(
    async (session: FieldSession, autosave: boolean): Promise<boolean> => {
      const draft = session.draft;
      session.dirty = false;
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
        operations.forEach((operation, index) => {
          session.entries.set(keys[index], {
            idempotencyKey,
            operation,
            suggestion: created.suggestions[index],
          });
        });
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
            resourceId: documentId,
            adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
            baseRevision: session.session.baseRevision,
            summary,
            proposalId: session.proposalId ?? undefined,
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
        if (error instanceof SuggestionFormattingMappingError) {
          if (!autosave)
            toast.error(tRef.current("editor.suggestionFormattingUnsupported"));
          return false;
        }
        if (autosave && !refused) schedule(session, RETRY_MS);
        if (!quiet) {
          toast.error(tRef.current("editor.suggestionCreateFailed"), {
            description:
              actionErrorMessage(error) ?? tRef.current("empty.genericError"),
          });
        }
        return false;
      } finally {
        if (savedNow.length > 0) onSavedRef.current(savedNow);
        bump();
      }
    },
    [bump, documentId, latest, schedule],
  );

  /** Saves the tab's draft after any save already under way. */
  const save = useCallback(
    (
      session: FieldSession,
      { autosave, ended = false }: { autosave: boolean; ended?: boolean },
    ): Promise<boolean> => {
      if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
      }
      const run = session.queue.then(() => {
        if (!ended && sessionsRef.current.get(session.fieldId) !== session)
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
      if (session.dirty || session.unresolved)
        void save(session, { autosave: true, ended: true });
      else if (session.timer) clearTimeout(session.timer);
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

  useEffect(() => {
    if (!suggesting) return;
    const saveNow = () => {
      for (const session of sessionsRef.current.values()) {
        if (session.dirty) void save(session, { autosave: true });
      }
    };
    const onVisibilityChange = () => {
      if (window.document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("blur", saveNow);
    window.addEventListener("pagehide", saveNow);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", saveNow);
      window.removeEventListener("pagehide", saveNow);
      window.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    };
  }, [save, suggesting]);

  const start = useCallback(
    (fieldId: string, base: { content: string; revision: number }) => {
      if (!suggestingRef.current || sessionsRef.current.has(fieldId)) return;
      sessionsRef.current.set(fieldId, {
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
        failed: false,
        timer: null,
        queue: Promise.resolve(),
        unresolved: null,
      });
      bump();
    },
    [bump],
  );

  const change = useCallback(
    (fieldId: string, markdown: string) => {
      const session = sessionsRef.current.get(fieldId);
      if (!session || session.draft === markdown) return;
      session.draft = markdown;
      session.dirty = true;
      schedule(session);
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
    for (const session of sessionsRef.current.values()) {
      sessions.set(session.fieldId, {
        key: session.session.id,
        draft: session.draft,
      });
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
    return { revision, sessions, drafts, visuals, editing, withdrawn };
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

  const visuals = useCallback(
    (fieldId: string, markdown: string) => {
      const shown = derived.visuals.get(fieldId) ?? [];
      const inSession = new Set(shown.map((visual) => visual.id));
      return presentations({
        savedSuggestions: suggestions.filter(
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
    [derived, presentations, suggestions],
  );

  const provider = useMemo<BlocksFieldSuggestionsValue>(
    () => ({
      suggesting,
      sessions: derived.sessions,
      start,
      change,
      replacementIntent,
      visuals,
      activeSuggestionId,
      onActivateSuggestion,
      onHoverSuggestion,
      onAnchorsChange,
    }),
    [
      activeSuggestionId,
      change,
      derived.sessions,
      onActivateSuggestion,
      onAnchorsChange,
      onHoverSuggestion,
      replacementIntent,
      start,
      suggesting,
      visuals,
    ],
  );

  /** Saves every tab's draft; false when one couldn't be. */
  const flushAll = useCallback(async () => {
    const results = await Promise.all(
      [...sessionsRef.current.values()].map((session) =>
        save(session, { autosave: false }),
      ),
    );
    return results.every(Boolean);
  }, [save]);

  /** The saved copy of a draft, once its tab's draft is saved. */
  const materializeDraft = useCallback(
    async (draft: DraftSuggestion): Promise<ResourceSuggestion | null> => {
      const fieldId = suggestionBlocksFieldId(draft);
      const session = fieldId ? sessionsRef.current.get(fieldId) : undefined;
      if (!session || !(await save(session, { autosave: false }))) return null;
      if (draft.operations.length === 0) return null;
      const operation = draft.operations[0];
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

  /** The freshest copy of a saved suggestion this page knows. */
  const freshest = useCallback((suggestion: ResourceSuggestion) => {
    for (const session of sessionsRef.current.values()) {
      for (const entry of session.entries.values()) {
        if (entry.suggestion.id === suggestion.id) return entry.suggestion;
      }
    }
    const listed = savedRef.current.find(
      (candidate) => candidate.id === suggestion.id,
    );
    return listed && listed.revision > suggestion.revision
      ? listed
      : suggestion;
  }, []);

  /**
   * Runs a decision on tabs' suggestions: their drafts are saved first, and
   * afterwards the tabs read their text again and start new drafts on it.
   */
  const decideOnFields = useCallback(
    async (fieldIds: string[], run: () => Promise<void>) => {
      if (decidingRef.current) return;
      decidingRef.current = true;
      setDeciding(true);
      try {
        for (const fieldId of new Set(fieldIds)) {
          const session = sessionsRef.current.get(fieldId);
          if (session && !(await save(session, { autosave: false }))) return;
        }
        await run();
        await queryClient.refetchQueries({
          queryKey: ["action", "list-document-properties", { documentId }],
        });
        let restarted = false;
        for (const fieldId of new Set(fieldIds)) {
          const session = sessionsRef.current.get(fieldId);
          if (!session) continue;
          if (session.timer) clearTimeout(session.timer);
          sessionsRef.current.delete(fieldId);
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
        setDeciding(false);
      }
    },
    [bump, documentId, queryClient, save],
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
        if (!savedTarget) return;
        await mutationsRef.current.decideSuggestion.mutateAsync({
          id: savedTarget.id,
          decision,
          idempotencyKey: globalThis.crypto.randomUUID(),
          observedBase: savedTarget.baseRevision,
          observedRevision: savedTarget.revision,
        });
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
          await mutationsRef.current.decideProposal.mutateAsync({
            proposalId,
            decision,
            idempotencyKey: globalThis.crypto.randomUUID(),
            members: current.map((member) => ({
              id: member.id,
              observedRevision: member.revision,
              observedBase: member.baseRevision,
            })),
          });
        },
      ),
    [decideOnFields, freshest],
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
    deciding,
    flushAll,
    materializeDraft,
    decide,
    decideProposal: decideMembers,
  };
}
