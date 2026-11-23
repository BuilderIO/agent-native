import {
  callAction,
  readClientAppState,
  setClientAppState,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useAgentEngineConfigured } from "@agent-native/core/client/use-agent-engine-configured";
import { buildSettingsRoute } from "@agent-native/core/navigation";
import {
  AgentChatHome,
  AgentChatSurface,
  type AssistantChatComposerContextProviderProps,
} from "@agent-native/toolkit/app/chat";
import {
  IconArrowUpRight,
  IconChevronDown,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  type NavigateOptions,
  type To,
} from "react-router";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type listDataConnections from "../../../actions/list-data-connections";
import type listNotebookThreads from "../../../actions/list-notebook-threads";
import type { threadBindingRef } from "../../../shared/analytics-thread";
import { waitForNotebookEditing } from "../notebook/editing-snapshot";
import { NotebookReviewContext } from "../notebook/PendingChangeCard";
import type { NotebookReview } from "../notebook/useNotebookReview";
import { useWorkspaceData } from "../workspace/WorkspaceDataContext";
import { askToolLabel } from "./askToolLabel";
import { renderAskToolStepDetails } from "./AskToolStepDetails";
import {
  notebookThreadId,
  notebookThreadPath,
  NOTEBOOK_THREAD_PARAM,
  withNotebookAgentView,
} from "./notebook-thread-route";
import {
  AGENT_HOME_PATH,
  agentScope,
  agentStorageKey,
  agentThreadPath,
} from "./scope";
import { setThreadSubmissionSurfaceReady } from "./search-submission";
import { useAskThreadAdmission } from "./useAskThreadAdmission";

import "./agent.css";

export type WorkspaceAgentMode = "home" | "notebook" | "thread";

export interface WorkspaceAgentProps {
  mode: WorkspaceAgentMode;
  /** Selected workspace org id (the shell's workspace id). */
  orgId: string;
  /** Optional project the notebook/thread agent is looking at. */
  projectId?: string | null;
  /** Existing chat thread; omit on create routes. */
  threadId?: string | null;
  askBinding?: z.infer<typeof threadBindingRef> | null;
  onStopAsk?: () => Promise<unknown>;
  notebook?: NotebookAgentContext | undefined;
  homeIntent?: "notebook" | "app" | null;
  onClearHomeIntent?: () => void;
  className?: string;
  style?: CSSProperties;
}

const HomeIntentContext = createContext<{
  homeIntent: "notebook" | "app" | null;
  onClearHomeIntent?: (() => void) | undefined;
  source?: { id: string; title: string } | null;
  onSourceChange?: (source: { id: string; title: string } | null) => void;
}>({ homeIntent: null });

export interface NotebookCellSelection {
  projectId: string;
  cellId: string;
  title: string;
  proposalId?: string | undefined;
}

export type NotebookAgentContext = {
  review: NotebookReview;
  identity: string;
  editable: boolean;
  revision: string;
  selection: NotebookCellSelection | undefined;
  aiMode: boolean;
  connection: string | undefined;
  prepareThread: (threadId: string) => Promise<void>;
  createThread: () => Promise<void>;
  selectThread: (threadId: string | null) => void;
};

const NotebookProjectContext = createContext<{
  projectId: string | null;
  notebook: NotebookAgentContext | undefined;
}>({ projectId: null, notebook: undefined });

function NotebookContextProvider({
  children,
  threadId,
}: AssistantChatComposerContextProviderProps) {
  const t = useT();
  const { projectId, notebook } = useContext(NotebookProjectContext);
  const selection = notebook?.selection;
  const selected =
    selection && selection.projectId === projectId
      ? {
          key: "notebook-selection",
          title: t("notebook.reviewSelectedCell", {
            cell: selection.title,
            revision: notebook.revision,
          }),
          context: t("notebook.reviewSelectedCellContext", {
            cell: selection.title,
            cellId: selection.cellId,
            revision: notebook.revision,
          }),
        }
      : undefined;
  return children({
    menuItems: [],
    contextItems: [
      ...(selected ? [selected] : []),
      ...(notebook?.connection
        ? [
            {
              key: "notebook-connection",
              title: notebook.connection,
              context: t("notebook.reviewConnectionContext", {
                connection: notebook.connection,
              }),
            },
          ]
        : []),
    ],
    onRemoveContextItem: () => {},
    prepareSubmission: async (snapshot) => {
      if (projectId) await waitForNotebookEditing(projectId);
      await notebook?.prepareThread(threadId);
      return snapshot;
    },
    submissionAccepted: () => {},
  });
}

function NotebookThreadPicker({
  projectId,
  threadId,
  notebook,
}: {
  projectId: string;
  threadId: string | null;
  notebook: NotebookAgentContext;
}) {
  const t = useT();
  const { data, refetch } = useActionQuery<
    Awaited<ReturnType<typeof listNotebookThreads.run>>
  >(
    "list-notebook-threads",
    { projectId },
    {
      enabled: notebook.editable,
      queryKeyScope: [notebook.identity],
    },
  );
  const threads = data?.threads ?? [];
  const current = threads.find(({ id }) => id === threadId);
  const lastFetchedThreadId = useRef<string | null>(null);
  useEffect(() => {
    if (!notebook.editable || !threadId || current) return;
    if (lastFetchedThreadId.current === threadId) return;
    lastFetchedThreadId.current = threadId;
    void refetch();
  }, [current, notebook.editable, refetch, threadId]);
  return (
    <div className="ws-agent-thread-picker flex items-center justify-between gap-1 border-b px-2 py-1">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open && notebook.editable) void refetch();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("notebook.reviewThreadPicker")}
            className="min-w-0"
          >
            <span className="truncate">
              {current?.title || t("notebook.reviewNewThread")}
            </span>
            <IconChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => notebook.selectThread(null)}>
            {t("notebook.reviewBackToNotebook")}
          </DropdownMenuItem>
          {threads.map((thread) => (
            <DropdownMenuItem
              key={thread.id}
              onSelect={() => notebook.selectThread(thread.id)}
            >
              {thread.title || t("notebook.reviewNewThread")}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon"
        variant="ghost"
        className="ws-agent-thread-new"
        disabled={!notebook.editable}
        onClick={() => {
          void notebook.createThread().then(() => refetch());
        }}
        aria-label={t("notebook.reviewNewThread")}
      >
        <IconPlus size={16} />
      </Button>
    </div>
  );
}

const GENERATE_APP_AGENT_CONTEXT =
  "Generate an app: build a project app in this workspace with notebook cells arranged by set-app. This is not a source-code change.";

function HomeIntentProvider({
  children,
}: AssistantChatComposerContextProviderProps) {
  const { homeIntent, onClearHomeIntent, source, onSourceChange } =
    useContext(HomeIntentContext);
  const t = useT();
  const item = homeIntent
    ? {
        composerDefaultModelLabel: t("analytics.ask.defaultChoice"),
        key: "home-intent",
        title:
          homeIntent === "app"
            ? t("analytics.home.promptActions.generateApp")
            : t("analytics.home.promptActions.analyzeInNotebook"),
        context:
          homeIntent === "app"
            ? GENERATE_APP_AGENT_CONTEXT
            : t("analytics.home.promptActions.analyzeInNotebook"),
      }
    : null;
  return children({
    menuItems: onSourceChange
      ? [
          {
            id: "ask-data-connection",
            label: t("analytics.ask.contextMenuItems.selectDataConnection"),
            picker: {
              searchPlaceholder: t(
                "analytics.ask.contextMenuItems.searchDataConnections",
              ),
              load: async ({ search, signal }) => {
                const { connections } = await callAction<
                  Awaited<ReturnType<typeof listDataConnections.run>>
                >("list-data-connections", {}, { method: "GET", signal });
                return {
                  items: connections
                    .filter(
                      (connection) =>
                        !connection.isDraft &&
                        connection.aiUsage === "included" &&
                        connection.name
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .map(({ id, name }) => ({ id, title: name })),
                };
              },
              onSelect: ({ id, title }) => onSourceChange({ id, title }),
            },
          },
        ]
      : [],
    contextItems: [
      ...(item ? [item] : []),
      ...(source
        ? [
            {
              key: "ask-data-connection",
              title: source.title,
              context: source.id,
            },
          ]
        : []),
    ],
    onRemoveContextItem: (key) => {
      if (key === "ask-data-connection") onSourceChange?.(null);
      if (key === "home-intent") onClearHomeIntent?.();
    },
    prepareSubmission: async (snapshot) => snapshot,
    submissionAccepted: () => onClearHomeIntent?.(),
  });
}

/**
 * The notebook's pure `AgentPane` renders its own fallback composer whenever
 * `agentComposer` is null. This hidden element occupies that slot so the core
 * surface (mounted in `agentPane`) owns the only composer. It renders no UI.
 */
export function NotebookAgentComposerSuppressed() {
  return <span hidden data-workspace-agent-composer="suppressed" />;
}

const NOTEBOOK_TIP_DISMISSED_KEY = "ws-agent-notebook-tip-dismissed";

function NotebookComposerTip() {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return (
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(NOTEBOOK_TIP_DISMISSED_KEY) === "1"
      );
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <div className="ws-agent-notebook-tip" data-workspace-agent-note="">
      <span>{t("analytics.ask.contextBannerMessage")}</span>
      <Link
        to="/context-studio/setup"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("analytics.ask.contextBannerAction")}
        <IconArrowUpRight size={12} aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("analytics.ask.dismissContextBanner")}
        onClick={() => {
          setDismissed(true);
          try {
            if (typeof sessionStorage !== "undefined")
              sessionStorage.setItem(NOTEBOOK_TIP_DISMISSED_KEY, "1");
          } catch {
          }
        }}
      >
        <IconX size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * App-scoped agent entry.
 *
 * Built only on the public `@agent-native/toolkit/app/chat` surface, so the
 * core keeps ownership of the agent engine, attachments, dictation, voice
 * chat and the configured default model. There is no model picker here: the
 * configured engine default is resolved by the core, never a fabricated
 * model list.
 */
export function WorkspaceAgent({
  mode,
  orgId,
  projectId = null,
  threadId = null,
  askBinding = null,
  onStopAsk,
  notebook,
  homeIntent = null,
  onClearHomeIntent,
  className,
  style,
}: WorkspaceAgentProps) {
  const t = useT();
  const canConnectAi = useWorkspaceData()?.shell.features?.isAdmin;
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ threadId?: string }>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const navigateFromMountedAgent = useCallback(
    (to: To, options?: NavigateOptions) => {
      if (mounted.current) void navigate(to, options);
    },
    [navigate],
  );

  const resolvedThreadId =
    mode === "thread" ? (threadId ?? params.threadId ?? null) : threadId;
  const askComposer =
    mode === "home" ||
    (mode === "thread" && (Boolean(askBinding) || !resolvedThreadId));
  const [source, setSource] = useState<{ id: string; title: string } | null>(
    null,
  );
  const ask = useAskThreadAdmission({
    binding: askBinding,
    mode: homeIntent ?? "ask",
    goToThread: navigateFromMountedAgent,
    sourceId: source?.id,
  });
  const engineReadiness = useAgentEngineConfigured();
  const setupNotice = (
    <div
      role="status"
      className="relative mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3 text-sm"
    >
      <span className="min-w-0 flex-1 basis-48">
        {t("analytics.ask.connectAiMessage")}
      </span>
      {canConnectAi ? (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to={buildSettingsRoute("model")}>
            {t("analytics.ask.connectAi")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
  const threadDisplayProps = {
    queuedComposerPlaceholder: t("analytics.ask.queuedPlaceholder"),
    stopButtonLabel: t("analytics.ask.stop"),
    workingLabel: t("analytics.ask.working"),
    resolveToolStepLabel: (tool: Parameters<typeof askToolLabel>[1]) =>
      askToolLabel(t, tool),
    renderToolStepDetails: renderAskToolStepDetails,
    formatWorkedForDuration: (durationMs: number) => {
      const count = Math.floor(durationMs / 1000);
      return t(
        count === 1
          ? "analytics.ask.durationSecond"
          : "analytics.ask.durationSeconds",
        { count },
      );
    },
    composerToolbarSlot: (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("analytics.ask.approvalMode.trigger", {
              mode: t(
                ask.approval === "ask"
                  ? "analytics.ask.approvalMode.ask.button"
                  : "analytics.ask.approvalMode.act.button",
              ),
            })}
          >
            {t(
              ask.approval === "ask"
                ? "analytics.ask.approvalMode.ask.button"
                : "analytics.ask.approvalMode.act.button",
            )}
            <IconChevronDown size={14} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem
            className="flex-col items-start gap-0.5"
            onSelect={() => ask.setApproval("ask")}
          >
            <span className="font-medium">
              {t("analytics.ask.approvalMode.ask.label")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("analytics.ask.approvalMode.ask.description")}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex-col items-start gap-0.5"
            onSelect={() => ask.setApproval("skip")}
          >
            <span className="font-medium">
              {t("analytics.ask.approvalMode.act.label")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("analytics.ask.approvalMode.act.description")}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  };

  const askProps = askComposer
    ? {
        ...threadDisplayProps,
        admitComposerMessage: ask.admit,
        onComposerAttachmentsChange: ask.onAttachmentsChange,
        composerSlot: (
          <>
            {ask.starting || ask.uploading ? (
              <p role="status" className="mb-2 text-sm text-muted-foreground">
                {t(
                  ask.uploading
                    ? "analytics.ask.uploading"
                    : "analytics.ask.startingThread",
                )}
              </p>
            ) : null}
            {ask.failedFile ? (
              <div
                role="alert"
                className="mb-2 flex flex-wrap items-center gap-2 text-sm text-destructive"
              >
                <span>
                  {t("analytics.ask.uploadFailed", {
                    file: ask.failedFile.name,
                  })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void ask
                      .retryUpload()
                      .catch((error: unknown) =>
                        console.warn(
                          "[analytics] Ask upload retry failed",
                          error,
                        ),
                      )
                  }
                >
                  {t("analytics.ask.retryUpload")}
                </Button>
              </div>
            ) : null}
          </>
        ),
      }
    : threadDisplayProps;

  const onThreadSurfaceReadyChange = useCallback(
    (ready: boolean) => {
      if (resolvedThreadId)
        setThreadSubmissionSurfaceReady(resolvedThreadId, orgId, ready);
    },
    [orgId, resolvedThreadId],
  );

  const scope = useMemo(() => agentScope(orgId, projectId), [orgId, projectId]);
  const storageKey = useMemo(() => agentStorageKey(orgId), [orgId]);
  const hiddenComposerContextItemKeys = useMemo(
    () => (scope.contextKey ? [scope.contextKey] : []),
    [scope.contextKey],
  );

  const homeUrlSync = useMemo(
    () => ({
      routeThreadId: null,
      getPath: (id: string | null) =>
        id ? agentThreadPath(id) : AGENT_HOME_PATH,
      navigate: navigateFromMountedAgent,
    }),
    [navigateFromMountedAgent],
  );

  const notebookSelection =
    resolvedThreadId ?? notebookThreadId(location.search);
  const notebookStateKey =
    mode === "notebook" && projectId
      ? `notebook-agent-thread:${encodeURIComponent(orgId)}:${encodeURIComponent(projectId)}`
      : null;
  const notebookState = useRef<{
    key: string;
    selection: string | null;
    resolved: boolean;
  } | null>(null);
  const hasHandedOffQuestion = (() => {
    const state = location.state as { askQuestion?: unknown } | null;
    return (
      typeof state?.askQuestion === "string" &&
      state.askQuestion.trim().length > 0
    );
  })();
  const notebookRoute = useMemo(
    () => ({
      key: notebookStateKey,
      selection: notebookSelection,
      location,
      handoff: hasHandedOffQuestion,
    }),
    [notebookStateKey, notebookSelection, location, hasHandedOffQuestion],
  );
  const currentNotebookRoute = useRef(notebookRoute);
  currentNotebookRoute.current = notebookRoute;

  useEffect(() => {
    const { key, selection, location, handoff } = notebookRoute;
    if (key === null) {
      notebookState.current = null;
      return;
    }
    let state = notebookState.current;
    if (state?.key !== key) {
      state = { key, selection: null, resolved: false };
      notebookState.current = state;
    }
    if (state.selection !== selection) {
      state.selection = selection;
      state.resolved = true;
      void setClientAppState(
        key,
        selection ? { threadId: selection } : null,
      ).catch(() => toast.error(t("error.genericTitle")));
      return;
    }
    if (state.resolved || handoff) return;

    let active = true;
    const isCurrent = () =>
      active && currentNotebookRoute.current === notebookRoute;
    void readClientAppState(key)
      .then((saved) => {
        if (!isCurrent()) return;
        state.resolved = true;
        if (saved === null) return;
        if (notebookThreadId(window.location.search)) return;
        if (
          typeof saved !== "object" ||
          !("threadId" in saved) ||
          typeof saved.threadId !== "string" ||
          !saved.threadId
        ) {
          toast.error(t("error.genericTitle"));
          return;
        }
        navigateFromMountedAgent(notebookThreadPath(location, saved.threadId), {
          replace: true,
        });
      })
      .catch(() => {
        if (isCurrent()) toast.error(t("error.genericTitle"));
      });
    return () => {
      active = false;
    };
  }, [navigateFromMountedAgent, notebookRoute, t]);

  const notebookUrlSync = useMemo(
    () => ({
      paramName: NOTEBOOK_THREAD_PARAM,
      routeThreadId: notebookSelection,
      getPath: (id: string | null) => {
        const base =
          typeof window !== "undefined" &&
          window.location.pathname.endsWith(location.pathname) &&
          new URLSearchParams(window.location.search).get("notebookView") ===
            "agent" &&
          new URLSearchParams(location.search).get("notebookView") !== "agent"
            ? withNotebookAgentView(location)
            : location;
        return notebookThreadPath(base, id);
      },
      navigate: navigateFromMountedAgent,
    }),
    [
      location.pathname,
      location.search,
      location.hash,
      navigateFromMountedAgent,
      notebookSelection,
    ],
  );

  const threadUrlSync = useMemo(
    () => ({
      routeThreadId: resolvedThreadId,
      getPath: (id: string | null) => agentThreadPath(id),
      navigate: navigateFromMountedAgent,
    }),
    [navigateFromMountedAgent, resolvedThreadId],
  );

  if (mode === "home") {
    return (
      <HomeIntentContext.Provider
        value={{
          homeIntent,
          onClearHomeIntent,
          source,
          onSourceChange: setSource,
        }}
      >
        <AgentChatHome
          {...askProps}
          key={storageKey}
          className={["ws-agent ws-agent-home", className]
            .filter(Boolean)
            .join(" ")}
          contentClassName="ws-agent-home-content"
          showHeader={false}
          showTabBar={false}
          showPageHeader={false}
          showPageNewChatButton={false}
          composerProviderSetupSlot={
            engineReadiness.missing ? setupNotice : undefined
          }
          composerContextProvider={HomeIntentProvider}
          showModelSelector
          preferEngineDefaultModel
          chatOnly
          scope={scope}
          isolateHistoryByScope
          collapseHistoryEdits
          storageKey={storageKey}
          contextNamespace={storageKey}
          hiddenComposerContextItemKeys={hiddenComposerContextItemKeys}
          restoreActiveThread={false}
          threadUrlSync={homeUrlSync}
          composerAutoFocus
          dynamicSuggestions={false}
          emptyStateDisplay="hidden"
          suggestionPlacement="hidden"
          composerPlaceholder={t("analytics.ask.composerPlaceholder")}
        />
      </HomeIntentContext.Provider>
    );
  }

  if (mode === "notebook") {
    const notebookStorageKey = scope.contextKey ?? storageKey;
    const activeThread = notebookUrlSync.routeThreadId;
    return (
      <NotebookProjectContext.Provider value={{ projectId, notebook }}>
        <NotebookReviewContext.Provider value={notebook?.review ?? null}>
          <div className="flex h-full min-h-0 flex-col">
            {notebook && projectId ? (
              <NotebookThreadPicker
                projectId={projectId}
                threadId={activeThread}
                notebook={notebook}
              />
            ) : null}
            <div className="min-h-0 flex-1">
              <AgentChatSurface
                key={notebookStorageKey}
                mode="panel"
                onReadyChange={onThreadSurfaceReadyChange}
                className={["ws-agent ws-agent-notebook h-full", className]
                  .filter(Boolean)
                  .join(" ")}
                {...(style === undefined ? {} : { style })}
                showHeader={false}
                showTabBar={false}
                showPageHeader={false}
                showPageNewChatButton={false}
                showModelSelector={false}
                preferEngineDefaultModel
                chatOnly
                scope={scope}
                isolateHistoryByScope
                collapseHistoryEdits
                storageKey={notebookStorageKey}
                contextNamespace={notebookStorageKey}
                hiddenComposerContextItemKeys={hiddenComposerContextItemKeys}
                restoreActiveThread={false}
                threadUrlSync={notebookUrlSync}
                composerAutoFocus={false}
                composerContextProvider={NotebookContextProvider}
                dynamicSuggestions={false}
                suggestionPlacement="hidden"
                composerContextBannerSlot={<NotebookComposerTip />}
                composerProviderSetupSlot={
                  engineReadiness.missing ? setupNotice : undefined
                }
                composerToolbarSlot={
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" size="sm" variant="ghost">
                        {t("analytics.ask.approvalMode.ask.button")}
                        <IconChevronDown size={14} aria-hidden="true" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      aria-label={t("analytics.ask.approvalMode.trigger", {
                        mode: t("analytics.ask.approvalMode.ask.button"),
                      })}
                      className="text-sm"
                    >
                      {t("analytics.ask.approvalMode.ask.label")}
                    </PopoverContent>
                  </Popover>
                }
                emptyStateDisplay="hidden"
                emptyStateFooter={
                  <div className="max-w-xs text-center">
                    <h2 className="text-lg font-medium">
                      {t("notebook.reviewAgentWelcome")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t("notebook.reviewAgentHelp")}{" "}
                      <Link className="underline" to="/context-studio/setup">
                        {t("notebook.reviewAgentLearnMore")}
                      </Link>
                    </p>
                  </div>
                }
                composerSubmissionDisabled={
                  notebook ? !notebook.editable : false
                }
                composerPlaceholder={t(
                  notebook?.aiMode
                    ? "notebook.reviewAiPlaceholder"
                    : "notebook.reviewAgentPlaceholder",
                )}
              />
            </div>
          </div>
        </NotebookReviewContext.Provider>
      </NotebookProjectContext.Provider>
    );
  }

  return (
    <HomeIntentContext.Provider
      value={{ homeIntent: null, source, onSourceChange: setSource }}
    >
      <AgentChatSurface
        {...askProps}
        key={storageKey}
        mode="page"
        onReadyChange={onThreadSurfaceReadyChange}
        chatViewTransition
        className={["ws-agent ws-agent-thread h-full", className]
          .filter(Boolean)
          .join(" ")}
        {...(style === undefined ? {} : { style })}
        defaultMode="chat"
        showHeader={false}
        showTabBar={false}
        showPageHeader={false}
        showPageNewChatButton={false}
        showModelSelector={askComposer}
        preferEngineDefaultModel
        chatOnly
        scope={scope}
        isolateHistoryByScope
        collapseHistoryEdits
        storageKey={storageKey}
        contextNamespace={storageKey}
        hiddenComposerContextItemKeys={hiddenComposerContextItemKeys}
        restoreActiveThread={false}
        threadUrlSync={threadUrlSync}
        composerAutoFocus={!resolvedThreadId}
        dynamicSuggestions={false}
        suggestionPlacement="hidden"
        emptyStateText={t("analytics.ask.title")}
        composerPlaceholder={t("analytics.ask.composerPlaceholder")}
        composerProviderSetupSlot={
          engineReadiness.missing ? setupNotice : undefined
        }
        {...(askComposer
          ? { composerContextProvider: HomeIntentProvider }
          : {})}
        {...(onStopAsk ? { onStop: onStopAsk } : {})}
      />
    </HomeIntentContext.Provider>
  );
}
