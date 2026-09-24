import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type HTMLAttributes,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useLocalStorage } from "../../hooks/use-local-storage";
import type { CommentAiDraft, MentionEntry } from "./CommentComposer";

export interface CommentDraft {
  text: string;
  mentions: MentionEntry[];
  aiDraft: CommentAiDraft | null;
}

export interface CommentDraftRevision extends CommentDraft {
  revision: number;
}

export type CommentHistoryStatus = "all" | "open" | "resolved";

interface CommentPanelSession {
  historyStatus: CommentHistoryStatus;
  historyAuthor: string | null;
  historyScrollTop: number;
}

interface CommentDraftContextValue {
  drafts: ReadonlyMap<string, CommentDraftRevision>;
  persistenceState: CommentDraftStorageState;
  updateDraft: (
    key: string,
    initial: CommentDraft,
    update: (draft: CommentDraft) => CommentDraft,
  ) => void;
  clearIfUnchanged: (key: string, submittedDraft: CommentDraftRevision) => void;
  submittedDrafts: Map<string, CommentDraftRevision>;
  beginSubmission: (
    key: string,
    operationId: string,
    submittedDraft: CommentDraftRevision,
  ) => CommentDraftRevision;
  restoreSubmittedDraft: (key: string, operationId: string) => void;
  finishSubmission: (operationId: string) => void;
  isSubmittingDraft: (key: string) => boolean;
  resolutionVersion: number;
  isResolving: (threadId: string) => boolean;
  startResolution: (threadId: string) => boolean;
  finishResolution: (threadId: string) => void;
  discard: (key: string) => void;
  panelSession: CommentPanelSession;
  setHistoryStatus: Dispatch<SetStateAction<CommentHistoryStatus>>;
  setPanelSession: Dispatch<SetStateAction<CommentPanelSession>>;
}

type CommentDraftStorageState = "ready" | "unavailable" | "unreadable";

interface StoredCommentDrafts {
  version: 1;
  drafts: Record<string, CommentDraftRevision>;
}

const COMMENT_DRAFT_STORAGE_VERSION = 1;
const MAX_STORED_COMMENT_DRAFTS = 50;
const MAX_COMMENT_DRAFT_STORAGE_BYTES = 256_000;

const EMPTY_DRAFT: CommentDraft = { text: "", mentions: [], aiDraft: null };
const CommentDraftContext = createContext<CommentDraftContextValue | null>(
  null,
);

function draftsMatch(left: CommentDraft, right: CommentDraft) {
  return (
    left.text === right.text &&
    left.aiDraft?.mode === right.aiDraft?.mode &&
    left.aiDraft?.selection.model === right.aiDraft?.selection.model &&
    left.aiDraft?.selection.engine === right.aiDraft?.selection.engine &&
    left.aiDraft?.selection.provider === right.aiDraft?.selection.provider &&
    left.mentions.length === right.mentions.length &&
    left.mentions.every(
      (mention, index) =>
        mention.email === right.mentions[index]?.email &&
        mention.name === right.mentions[index]?.name,
    )
  );
}

function isCommentDraftRevision(value: unknown): value is CommentDraftRevision {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CommentDraftRevision>;
  return (
    typeof draft.text === "string" &&
    Number.isSafeInteger(draft.revision) &&
    (draft.revision ?? -1) >= 0 &&
    Array.isArray(draft.mentions) &&
    draft.mentions.every(
      (mention) =>
        mention &&
        typeof mention === "object" &&
        typeof mention.email === "string" &&
        typeof mention.name === "string",
    ) &&
    (draft.aiDraft === null ||
      (draft.aiDraft !== undefined &&
        typeof draft.aiDraft === "object" &&
        ["auto", "reply", "suggest", "apply-resolve"].includes(
          draft.aiDraft.mode,
        ) &&
        typeof draft.aiDraft.selection?.model === "string" &&
        typeof draft.aiDraft.selection.engine === "string" &&
        typeof draft.aiDraft.selection.provider === "string"))
  );
}

export function commentDraftStorageKey(
  documentId: string,
  currentUserEmail?: string | null,
  currentUserOrgId?: string | null,
) {
  const email = currentUserEmail?.trim().toLowerCase();
  if (!email) return null;
  const account = currentUserOrgId?.trim()
    ? `org:${currentUserOrgId.trim()}`
    : "personal";
  return `content-comment-drafts:${JSON.stringify({ version: COMMENT_DRAFT_STORAGE_VERSION, account, email, documentId })}`;
}

function readCommentDrafts(storageKey: string | null): {
  drafts: Map<string, CommentDraftRevision>;
  state: CommentDraftStorageState;
} {
  if (!storageKey || typeof window === "undefined") {
    return { drafts: new Map(), state: "unavailable" };
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return { drafts: new Map(), state: "unavailable" };
  }
  if (raw === null) return { drafts: new Map(), state: "ready" };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCommentDrafts>;
    if (
      parsed.version !== COMMENT_DRAFT_STORAGE_VERSION ||
      !parsed.drafts ||
      typeof parsed.drafts !== "object" ||
      Array.isArray(parsed.drafts)
    ) {
      return { drafts: new Map(), state: "unreadable" };
    }
    const entries = Object.entries(parsed.drafts);
    if (
      entries.length > MAX_STORED_COMMENT_DRAFTS ||
      entries.some(
        ([key, draft]) => key.length > 512 || !isCommentDraftRevision(draft),
      )
    ) {
      return { drafts: new Map(), state: "unreadable" };
    }
    return { drafts: new Map(entries), state: "ready" };
  } catch {
    return { drafts: new Map(), state: "unreadable" };
  }
}

function writeCommentDrafts(
  storageKey: string | null,
  drafts: ReadonlyMap<string, CommentDraftRevision>,
): CommentDraftStorageState {
  if (!storageKey || typeof window === "undefined") return "unavailable";
  const entries = [...drafts.entries()]
    .sort((left, right) => right[1].revision - left[1].revision)
    .slice(0, MAX_STORED_COMMENT_DRAFTS);
  const record: StoredCommentDrafts = {
    version: COMMENT_DRAFT_STORAGE_VERSION,
    drafts: Object.fromEntries(entries),
  };
  const serialized = JSON.stringify(record);
  if (serialized.length > MAX_COMMENT_DRAFT_STORAGE_BYTES) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      return "unavailable";
    }
    return "unavailable";
  }
  try {
    if (entries.length === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, serialized);
    return "ready";
  } catch {
    return "unavailable";
  }
}

function CommentDraftStore({
  children,
  storageKey,
  draftStorageKey,
}: {
  children: ReactNode;
  storageKey: string;
  draftStorageKey: string | null;
}) {
  const [historyStatus, setHistoryStatus] =
    useLocalStorage<CommentHistoryStatus>(storageKey, "open");
  const initialStoredDrafts = useMemo(
    () => readCommentDrafts(draftStorageKey),
    [draftStorageKey],
  );
  const [drafts, setDrafts] = useState<
    ReadonlyMap<string, CommentDraftRevision>
  >(initialStoredDrafts.drafts);
  const [draftStorageState, setDraftStorageState] = useState(
    initialStoredDrafts.state,
  );
  const [draftMutationVersion, setDraftMutationVersion] = useState(0);
  const [panelSession, setPanelSession] = useState<CommentPanelSession>({
    historyStatus: "open",
    historyAuthor: null,
    historyScrollTop: 0,
  });

  const revision = useRef(
    Math.max(
      0,
      ...[...initialStoredDrafts.drafts.values()].map(
        (draft) => draft.revision,
      ),
    ),
  );
  const submittedDrafts = useRef(
    new Map<string, CommentDraftRevision>(),
  ).current;
  const submittingDrafts = useRef(new Map<string, string>()).current;
  const [submissionVersion, setSubmissionVersion] = useState(0);

  const resolvingThreads = useRef(new Set<string>());
  const [resolutionVersion, setResolutionVersion] = useState(0);
  const isResolving = useCallback(
    (threadId: string) => resolvingThreads.current.has(threadId),
    [],
  );
  const startResolution = useCallback((threadId: string) => {
    if (resolvingThreads.current.has(threadId)) return false;
    resolvingThreads.current.add(threadId);
    setResolutionVersion((version) => version + 1);
    return true;
  }, []);
  const finishResolution = useCallback((threadId: string) => {
    resolvingThreads.current.delete(threadId);
    setResolutionVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (draftMutationVersion === 0) return;
    setDraftStorageState(writeCommentDrafts(draftStorageKey, drafts));
  }, [draftMutationVersion, draftStorageKey, drafts]);

  const updateDraft = useCallback<CommentDraftContextValue["updateDraft"]>(
    (key, initial, update) => {
      const nextRevision = ++revision.current;
      setDraftMutationVersion((version) => version + 1);
      setDrafts((current) => {
        const nextDraft = update(current.get(key) ?? initial);
        const next = new Map(current);
        next.set(key, {
          ...nextDraft,
          mentions: nextDraft.mentions.map((mention) => ({ ...mention })),
          aiDraft: nextDraft.aiDraft
            ? {
                ...nextDraft.aiDraft,
                selection: { ...nextDraft.aiDraft.selection },
              }
            : null,
          revision: nextRevision,
        });
        return next;
      });
    },
    [],
  );
  const clearIfUnchanged = useCallback<
    CommentDraftContextValue["clearIfUnchanged"]
  >((key, submittedDraft) => {
    setDraftMutationVersion((version) => version + 1);
    setDrafts((current) => {
      const saved = current.get(key);
      if (!saved || saved.revision !== submittedDraft.revision) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  const discard = useCallback((key: string) => {
    setDraftMutationVersion((version) => version + 1);
    setDrafts((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  const beginSubmission = useCallback<
    CommentDraftContextValue["beginSubmission"]
  >((key, operationId, submittedDraft) => {
    const existing = submittedDrafts.get(operationId);
    if (existing) return existing;
    submittedDrafts.set(operationId, submittedDraft);
    submittingDrafts.set(key, operationId);
    setDrafts((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setSubmissionVersion((version) => version + 1);
    return submittedDraft;
  }, []);
  const restoreSubmittedDraft = useCallback<
    CommentDraftContextValue["restoreSubmittedDraft"]
  >((key, operationId) => {
    const submitted = submittedDrafts.get(operationId);
    if (!submitted) return;
    setDrafts((current) => {
      // A newly-created entry, including an intentionally empty one, is newer
      // typing and must remain recoverable instead of being overwritten.
      if (current.has(key)) return current;
      const next = new Map(current);
      next.set(key, {
        ...submitted,
        mentions: submitted.mentions.map((mention) => ({ ...mention })),
        revision: ++revision.current,
      });
      return next;
    });
  }, []);
  const finishSubmission = useCallback<
    CommentDraftContextValue["finishSubmission"]
  >((operationId) => {
    submittedDrafts.delete(operationId);
    for (const [key, currentOperationId] of submittingDrafts) {
      if (currentOperationId === operationId) submittingDrafts.delete(key);
    }
    setSubmissionVersion((version) => version + 1);
  }, []);
  const isSubmittingDraft = useCallback(
    (key: string) => submittingDrafts.has(key),
    [submittingDrafts, submissionVersion],
  );

  const value = useMemo<CommentDraftContextValue>(
    () => ({
      drafts,
      persistenceState: draftStorageState,
      resolutionVersion,
      submittedDrafts,
      isResolving,
      startResolution,
      finishResolution,
      updateDraft,
      clearIfUnchanged,
      discard,
      beginSubmission,
      restoreSubmittedDraft,
      finishSubmission,
      isSubmittingDraft,
      panelSession: { ...panelSession, historyStatus },
      setHistoryStatus,
      setPanelSession,
    }),
    [
      draftStorageState,
      resolutionVersion,
      drafts,
      submittedDrafts,
      isResolving,
      startResolution,
      finishResolution,
      updateDraft,
      clearIfUnchanged,
      discard,
      beginSubmission,
      restoreSubmittedDraft,
      finishSubmission,
      isSubmittingDraft,
      panelSession,
      historyStatus,
      setHistoryStatus,
    ],
  );

  return (
    <CommentDraftContext.Provider value={value}>
      {children}
    </CommentDraftContext.Provider>
  );
}

export function CommentDraftProvider({
  documentId,
  currentUserEmail,
  currentUserOrgId,
  children,
}: {
  documentId: string;
  currentUserEmail?: string | null;
  currentUserOrgId?: string | null;
  children: ReactNode;
}) {
  const accountKey = currentUserEmail?.trim().toLowerCase() ?? "";
  const orgKey = currentUserOrgId?.trim() ?? "personal";
  const draftStorageKey = commentDraftStorageKey(
    documentId,
    currentUserEmail,
    currentUserOrgId,
  );
  return (
    <CommentDraftStore
      key={`${documentId}\u0000${orgKey}\u0000${accountKey}`}
      storageKey={`content-review-status:${JSON.stringify(accountKey)}`}
      draftStorageKey={draftStorageKey}
    >
      {children}
    </CommentDraftStore>
  );
}

export function useCommentDraftContext() {
  const context = useContext(CommentDraftContext);
  if (!context) {
    throw new Error("Comment drafts require CommentDraftProvider");
  }
  return context;
}

export function useCommentDraft(
  key: string,
  initial: CommentDraft = EMPTY_DRAFT,
) {
  const context = useCommentDraftContext();
  const initialRef = useRef({ key, draft: { ...initial, revision: 0 } });
  if (
    initialRef.current.key !== key ||
    !draftsMatch(initialRef.current.draft, initial)
  ) {
    initialRef.current = { key, draft: { ...initial, revision: 0 } };
  }
  const draft = context.drafts.get(key) ?? initialRef.current.draft;

  const setText = useCallback<Dispatch<SetStateAction<string>>>(
    (nextText) => {
      context.updateDraft(key, initialRef.current.draft, (current) => ({
        ...current,
        text:
          typeof nextText === "function" ? nextText(current.text) : nextText,
      }));
    },
    [context, key],
  );
  const setMentions = useCallback<Dispatch<SetStateAction<MentionEntry[]>>>(
    (nextMentions) => {
      context.updateDraft(key, initialRef.current.draft, (current) => ({
        ...current,
        mentions:
          typeof nextMentions === "function"
            ? nextMentions(current.mentions)
            : nextMentions,
      }));
    },
    [context, key],
  );
  const setAiDraft = useCallback<
    Dispatch<SetStateAction<CommentAiDraft | null>>
  >(
    (nextAiDraft) => {
      context.updateDraft(key, initialRef.current.draft, (current) => ({
        ...current,
        aiDraft:
          typeof nextAiDraft === "function"
            ? nextAiDraft(current.aiDraft)
            : nextAiDraft,
      }));
    },
    [context, key],
  );
  const clearIfUnchanged = useCallback(
    (submittedDraft: CommentDraftRevision) =>
      context.clearIfUnchanged(key, submittedDraft),
    [context, key],
  );
  const clearOnSuccess = async <T,>(
    submittedDraft: CommentDraftRevision,
    mutation: Promise<T>,
  ): Promise<T> => {
    const result = await mutation;
    context.clearIfUnchanged(key, submittedDraft);
    return result;
  };
  const discard = useCallback(() => context.discard(key), [context, key]);

  const markSubmitted = (operationId: string) => {
    const submitted = context.submittedDrafts.get(operationId);
    if (submitted) return submitted;
    context.submittedDrafts.set(operationId, draft);
    return draft;
  };
  const beginSubmission = (operationId: string) =>
    context.beginSubmission(key, operationId, draft);
  const restoreSubmittedDraft = (operationId: string) =>
    context.restoreSubmittedDraft(key, operationId);
  const getSubmittedDraft = (operationId: string) =>
    context.submittedDrafts.get(operationId);

  return {
    draft,
    setText,
    setMentions,
    setAiDraft,
    clearIfUnchanged,
    clearOnSuccess,
    discard,
    markSubmitted,
    beginSubmission,
    restoreSubmittedDraft,
    finishSubmission: context.finishSubmission,
    getSubmittedDraft,
  };
}

export function useCommentPanelSession() {
  const {
    panelSession,
    setPanelSession,
    setHistoryStatus,
    isResolving,
    startResolution,
    finishResolution,
  } = useCommentDraftContext();
  const setHistoryAuthor = useCallback<Dispatch<SetStateAction<string | null>>>(
    (next) =>
      setPanelSession((current) => ({
        ...current,
        historyAuthor:
          typeof next === "function" ? next(current.historyAuthor) : next,
      })),
    [setPanelSession],
  );
  const setHistoryScrollTop = useCallback<Dispatch<SetStateAction<number>>>(
    (next) =>
      setPanelSession((current) => ({
        ...current,
        historyScrollTop:
          typeof next === "function" ? next(current.historyScrollTop) : next,
      })),
    [setPanelSession],
  );

  return {
    ...panelSession,
    isResolving,
    startResolution,
    finishResolution,
    setHistoryStatus,
    setHistoryAuthor,
    setHistoryScrollTop,
  };
}

export function CommentHistoryScrollContainer({
  children,
  onScroll,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const { historyScrollTop, setHistoryScrollTop } = useCommentPanelSession();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = historyScrollTop;
  }, [historyScrollTop]);

  return (
    <div
      {...props}
      ref={ref}
      onScroll={(event) => {
        setHistoryScrollTop(event.currentTarget.scrollTop);
        onScroll?.(event);
      }}
    >
      {children}
    </div>
  );
}
