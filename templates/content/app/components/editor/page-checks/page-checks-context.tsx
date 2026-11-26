import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  PAGE_CHECK_TYPING_PAUSE_MS,
  type PageCheckList,
  type PageCheckQuestionInput,
  type PageCheckScope,
  type PageCheckSure,
  type PageCheckTry,
  type PageCheckView,
} from "@shared/page-checks";
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

import type { LivePageChecks } from "./page-check-body";

export interface PageChecksBody {
  scopeAt: (pos?: number) => PageCheckScope;
  focusCheck: (checkId: string) => boolean;
}

export type PageCheckDialogState =
  | { mode: "add"; scope: PageCheckScope }
  | { mode: "edit"; checkId: string };

export interface PageCheckSaveInput {
  checkId?: string | undefined;
  sentence: string;
  scope: PageCheckScope;
  questions?: PageCheckQuestionInput[] | undefined;
  sure?: PageCheckSure | undefined;
}

export type PageCheckTryInput = Omit<PageCheckSaveInput, "checkId">;

export interface PageChecksActions {
  enabled: boolean;
  canEdit: boolean;
  openAdd: (at?: number) => void;
  openEdit: (checkId: string) => void;
  closeDialog: () => void;
  openList: () => void;
  focusCheck: (checkId: string) => void;
  runNow: () => void;
  save: (input: PageCheckSaveInput) => Promise<boolean>;
  tryCheck: (input: PageCheckTryInput) => Promise<PageCheckTry>;
  setPaused: (checkId: string, paused: boolean) => Promise<void>;
  remove: (checkId: string) => Promise<boolean>;
  skip: (args: {
    checkId: string;
    placeKey: string;
    textHash: string;
    undo?: boolean;
  }) => Promise<void>;
  prefillComment: (text: string) => void;
  bodyMarkdown: () => string;
  noteLocalEdit: () => void;
  publishLive: (live: LivePageChecks | null) => void;
  registerBody: (body: PageChecksBody | null) => void;
}

export interface PageChecksState {
  list: PageCheckList | undefined;
  checks: PageCheckView[];
  loading: boolean;
  loadFailed: boolean;
  live: LivePageChecks | null;
  running: boolean;
  runFailed: boolean;
  dialog: PageCheckDialogState | null;
}

const ActionsContext = createContext<PageChecksActions | null>(null);
const StateContext = createContext<PageChecksState | null>(null);

export function usePageChecksActions() {
  return useContext(ActionsContext);
}

export function usePageChecksState() {
  return useContext(StateContext);
}

export function PageChecksProvider({
  value,
  children,
}: {
  value: { actions: PageChecksActions; state: PageChecksState };
  children: ReactNode;
}) {
  return (
    <ActionsContext.Provider value={value.actions}>
      <StateContext.Provider value={value.state}>
        {children}
      </StateContext.Provider>
    </ActionsContext.Provider>
  );
}

const SAVE_ERRORS = {
  PAGE_CHECK_LIMIT: "pageChecks.limit",
  PAGE_CHECK_NO_MODEL: "pageChecks.noModel",
  PAGE_CHECK_VAGUE: "pageChecks.vagueSaveFailed",
  PAGE_CHECK_QUESTION_UNWRITTEN: "pageChecks.unwritten",
} as const;

const SAVE_WAITS = 3;
const SAVE_WAIT_MS = 1_000;

export function usePageChecks(args: {
  documentId: string;
  enabled: boolean;
  canEdit: boolean;
  markdown: string;
  isSaved: () => boolean;
  openInfo: () => void;
  prefillComment: (text: string) => void;
}): { actions: PageChecksActions; state: PageChecksState } {
  const { documentId, enabled, canEdit } = args;
  const t = useT();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["action", "list-page-checks", { documentId }] as const,
    [documentId],
  );
  const query = useActionQuery(
    "list-page-checks",
    { documentId },
    { enabled, refetchOnWindowFocus: false },
  );
  const list = enabled ? (query.data as PageCheckList | undefined) : undefined;
  const checks = useMemo(() => list?.checks ?? [], [list]);
  const [live, setLive] = useState<LivePageChecks | null>(null);
  const [running, setRunning] = useState(false);
  const [runFailed, setRunFailed] = useState(false);
  const [dialog, setDialog] = useState<PageCheckDialogState | null>(null);

  const latest = useRef(args);
  latest.current = args;
  const checksRef = useRef(checks);
  checksRef.current = checks;
  const bodyRef = useRef<PageChecksBody | null>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runState = useRef({ running: false, again: false, editorSaved: true });

  const putList = useCallback(
    (next: PageCheckList) => {
      queryClient.setQueryData(queryKey, {
        documentId: next.documentId,
        canEdit: next.canEdit,
        checks: next.checks,
      });
    },
    [queryClient, queryKey],
  );
  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey, exact: true }),
    [queryClient, queryKey],
  );

  const run = useCallback(
    async (options: { editorSaved: boolean; quiet: boolean }) => {
      const state = runState.current;
      if (state.running) {
        state.again = true;
        state.editorSaved &&= options.editorSaved;
        return;
      }
      state.running = true;
      setRunning(true);
      try {
        putList(
          (await callAction("run-page-checks", {
            documentId,
            editorSaved: options.editorSaved || undefined,
          })) as PageCheckList,
        );
        setRunFailed(false);
      } catch {
        setRunFailed(true);
        if (!options.quiet) toast.error(t("pageChecks.runFailed"));
      } finally {
        state.running = false;
        setRunning(false);
        if (state.again) {
          state.again = false;
          const editorSaved = state.editorSaved;
          state.editorSaved = true;
          void run({ editorSaved, quiet: true });
        }
      }
    },
    [documentId, putList, t],
  );

  const clearPause = () => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = null;
  };
  useEffect(() => clearPause, [documentId]);

  const actions = useMemo<PageChecksActions>(() => {
    const runAfterPause = (waits: number) => {
      pauseTimer.current = null;
      const saved = latest.current.isSaved();
      if (!saved && waits > 0) {
        pauseTimer.current = setTimeout(
          () => runAfterPause(waits - 1),
          SAVE_WAIT_MS,
        );
        return;
      }
      void run({ editorSaved: saved, quiet: true });
    };
    return {
      enabled,
      canEdit: enabled && canEdit,
      openAdd(at) {
        if (!canEdit) return;
        setDialog({
          mode: "add",
          scope: bodyRef.current?.scopeAt(at) ?? { kind: "intro" },
        });
      },
      openEdit(checkId) {
        if (canEdit) setDialog({ mode: "edit", checkId });
      },
      closeDialog() {
        setDialog(null);
      },
      openList() {
        latest.current.openInfo();
        let frames = 0;
        const reveal = () => {
          const section =
            globalThis.document.querySelector<HTMLElement>(
              "[data-page-checks]",
            );
          if (section) {
            section.scrollIntoView({ block: "start" });
            section.focus({ preventScroll: true });
          } else if (frames++ < 20) {
            requestAnimationFrame(reveal);
          }
        };
        requestAnimationFrame(reveal);
      },
      focusCheck(checkId) {
        bodyRef.current?.focusCheck(checkId);
      },
      runNow() {
        clearPause();
        void run({ editorSaved: false, quiet: false });
      },
      async save(input) {
        const wording = {
          documentId,
          sentence: input.sentence,
          scope: input.scope,
          questions: input.questions,
          sure: input.sure,
        };
        try {
          const next = input.checkId
            ? await callAction("update-page-check", {
                ...wording,
                checkId: input.checkId,
              })
            : await callAction("add-page-check", wording);
          putList(next as PageCheckList);
          return true;
        } catch (error) {
          const code = (error as { errorCode?: unknown } | null)?.errorCode;
          toast.error(
            t(
              typeof code === "string" && code in SAVE_ERRORS
                ? SAVE_ERRORS[code as keyof typeof SAVE_ERRORS]
                : "pageChecks.saveFailed",
            ),
          );
          return false;
        }
      },
      async tryCheck(input) {
        return (await callAction("try-page-check", {
          documentId,
          ...input,
        })) as PageCheckTry;
      },
      async setPaused(checkId, paused) {
        try {
          putList(
            (await callAction("update-page-check", {
              documentId,
              checkId,
              paused,
            })) as PageCheckList,
          );
        } catch {
          toast.error(t("pageChecks.saveFailed"));
        }
      },
      async remove(checkId) {
        try {
          await callAction("delete-page-check", { documentId, checkId });
          const current = queryClient.getQueryData<PageCheckList>(queryKey);
          if (current) {
            putList({
              ...current,
              checks: current.checks.filter((check) => check.id !== checkId),
            });
          }
          void reload();
          return true;
        } catch {
          toast.error(t("pageChecks.saveFailed"));
          return false;
        }
      },
      async skip(input) {
        try {
          await callAction("skip-page-check", { documentId, ...input });
          await reload();
        } catch {
          toast.error(t("pageChecks.saveFailed"));
        }
      },
      prefillComment(text) {
        latest.current.prefillComment(text);
      },
      bodyMarkdown() {
        return latest.current.markdown;
      },
      noteLocalEdit() {
        if (!enabled || !canEdit) return;
        if (!checksRef.current.some((check) => !check.paused)) return;
        clearPause();
        pauseTimer.current = setTimeout(
          () => runAfterPause(SAVE_WAITS),
          PAGE_CHECK_TYPING_PAUSE_MS,
        );
      },
      publishLive(next) {
        setLive(next);
      },
      registerBody(body) {
        bodyRef.current = body;
      },
    };
  }, [
    canEdit,
    documentId,
    enabled,
    putList,
    queryClient,
    queryKey,
    reload,
    run,
    t,
  ]);

  const state = useMemo<PageChecksState>(
    () => ({
      list,
      checks,
      loading: enabled && query.isPending,
      loadFailed: enabled && query.isError,
      live,
      running,
      runFailed,
      dialog,
    }),
    [
      checks,
      dialog,
      enabled,
      list,
      live,
      query.isError,
      query.isPending,
      runFailed,
      running,
    ],
  );

  return { actions, state };
}
