import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type HTMLAttributes,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { MentionEntry } from "./CommentComposer";

export interface CommentDraft {
  text: string;
  mentions: MentionEntry[];
}

export type CommentHistoryStatus = "all" | "open" | "resolved";

interface CommentPanelSession {
  historyStatus: CommentHistoryStatus;
  historyAuthor: string | null;
  historyScrollTop: number;
}

interface CommentDraftContextValue {
  drafts: ReadonlyMap<string, CommentDraft>;
  updateDraft: (
    key: string,
    initial: CommentDraft,
    update: (draft: CommentDraft) => CommentDraft,
  ) => void;
  clearIfUnchanged: (key: string, submittedDraft: CommentDraft) => void;
  discard: (key: string) => void;
  panelSession: CommentPanelSession;
  setPanelSession: Dispatch<SetStateAction<CommentPanelSession>>;
}

const EMPTY_DRAFT: CommentDraft = { text: "", mentions: [] };
const CommentDraftContext = createContext<CommentDraftContextValue | null>(
  null,
);

function draftsMatch(left: CommentDraft, right: CommentDraft) {
  return (
    left.text === right.text &&
    left.mentions.length === right.mentions.length &&
    left.mentions.every(
      (mention, index) =>
        mention.email === right.mentions[index]?.email &&
        mention.name === right.mentions[index]?.name,
    )
  );
}

function CommentDraftStore({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, CommentDraft>>(
    () => new Map(),
  );
  const [panelSession, setPanelSession] = useState<CommentPanelSession>({
    historyStatus: "all",
    historyAuthor: null,
    historyScrollTop: 0,
  });

  const updateDraft = useCallback<CommentDraftContextValue["updateDraft"]>(
    (key, initial, update) => {
      setDrafts((current) => {
        const nextDraft = update(current.get(key) ?? initial);
        const next = new Map(current);
        next.set(key, nextDraft);
        return next;
      });
    },
    [],
  );
  const clearIfUnchanged = useCallback<
    CommentDraftContextValue["clearIfUnchanged"]
  >((key, submittedDraft) => {
    setDrafts((current) => {
      const saved = current.get(key);
      if (!saved || !draftsMatch(saved, submittedDraft)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  const discard = useCallback((key: string) => {
    setDrafts((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);

  const value = useMemo<CommentDraftContextValue>(
    () => ({
      drafts,
      updateDraft,
      clearIfUnchanged,
      discard,
      panelSession,
      setPanelSession,
    }),
    [drafts, updateDraft, clearIfUnchanged, discard, panelSession],
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
  children,
}: {
  documentId: string;
  currentUserEmail?: string | null;
  children: ReactNode;
}) {
  const accountKey = currentUserEmail?.trim().toLowerCase() ?? "";
  return (
    <CommentDraftStore key={`${documentId}\u0000${accountKey}`}>
      {children}
    </CommentDraftStore>
  );
}

function useCommentDraftContext() {
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
  const initialRef = useRef({ key, draft: initial });
  if (
    initialRef.current.key !== key ||
    !draftsMatch(initialRef.current.draft, initial)
  ) {
    initialRef.current = { key, draft: initial };
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
  const clearIfUnchanged = useCallback(
    (submittedDraft: CommentDraft) =>
      context.clearIfUnchanged(key, submittedDraft),
    [context, key],
  );
  const discard = useCallback(() => context.discard(key), [context, key]);

  return { draft, setText, setMentions, clearIfUnchanged, discard };
}

export function useCommentPanelSession() {
  const { panelSession, setPanelSession } = useCommentDraftContext();
  const setHistoryStatus = useCallback<
    Dispatch<SetStateAction<CommentHistoryStatus>>
  >(
    (next) =>
      setPanelSession((current) => ({
        ...current,
        historyStatus:
          typeof next === "function" ? next(current.historyStatus) : next,
      })),
    [setPanelSession],
  );
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
