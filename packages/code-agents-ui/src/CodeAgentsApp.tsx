import {
  AssistantChat,
  ChatHistoryList,
  PromptComposer,
  buildRepositoryFromCodeAgentTranscript,
  codeAgentTranscriptHasPendingApproval,
  createCodeAgentChatAdapter,
  isCodeAgentRunActive,
  isCredentialGapCodeAgentEvent,
  mergeCodeAgentTranscriptEvents,
  readAgentPromptAttachment,
  type ChatHistoryItem,
  type CodeAgentChatController,
  type PromptComposerFile,
  type SlashCommand,
  type TiptapComposerHandle,
} from "@agent-native/core/client";
import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconClock,
  IconCode,
  IconBrandChrome,
  IconCopy,
  IconDeviceMobile,
  IconDeviceDesktop,
  IconFolder,
  IconFolderPlus,
  IconLink,
  IconLockAccess,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconQrcode,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconScreenShare,
  IconTerminal2,
} from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { toast } from "sonner";

import {
  CODE_AGENT_GOALS,
  DEFAULT_CODE_AGENT_PERMISSION_MODE,
  getCodeAgentAppConfig,
  getCodeAgentGoal,
  getCodeAgentPermissionMode,
  getDefaultCodeAgentGoal,
  type CodeAgentGoalDefinition,
  type CodeAgentGoalId,
  type CodeAgentPermissionMode,
} from "./code-agents.js";
import type {
  CodeAgentCodePack,
  CodeAgentCodePackResult,
  CodeAgentControlCommand,
  CodeAgentControlResult,
  CodeAgentCreateRunRequest,
  CodeAgentCreateRunResult,
  CodeAgentFollowUpMode,
  CodeAgentFollowUpRequest,
  CodeAgentFollowUpResult,
  CodeAgentMigrationRun,
  CodeAgentModelListResult,
  CodeAgentModelOption,
  CodeAgentModelSelection,
  CodeAgentProviderConnectResult,
  CodeAgentPromptAttachment,
  CodeAgentProjectFolder,
  CodeAgentProjectListResult,
  CodeAgentProjectSelectResult,
  CodeAgentReasoningEffort,
  CodeAgentRemoteConnectorControlResult,
  CodeAgentRemoteConnectorPairRequest,
  CodeAgentRemoteConnectorPairResult,
  CodeAgentRemoteConnectorStatus,
  CodeAgentRerunRequest,
  CodeAgentRerunResult,
  CodeAgentRetryRunRequest,
  CodeAgentRetryRunResult,
  CodeAgentRun,
  CodeAgentRunDetail,
  CodeAgentRunListResult,
  CodeAgentTerminalRequest,
  CodeAgentTerminalResult,
  CodeAgentTranscriptEvent,
  CodeAgentTranscriptRequest,
  CodeAgentTranscriptResult,
  CodeAgentTranscriptSubscriptionBatch,
  CodeAgentUpdateRunRequest,
  CodeAgentUpdateRunResult,
  CodeAgentsOpenRequest,
} from "./types.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";

export interface CodeAgentsHost {
  listRuns(goalId?: string): Promise<CodeAgentRunListResult>;
  listModels?(): Promise<CodeAgentModelListResult>;
  getHostMetadata?(): Promise<CodeAgentHostMetadata>;
  runComputerSetupAction?(
    action: CodeAgentComputerSetupAction,
  ): Promise<CodeAgentComputerSetupResult>;
  listCodePacks?(cwd?: string): Promise<CodeAgentCodePackResult>;
  listProjects?(): Promise<CodeAgentProjectListResult>;
  selectProject?(cwd: string): Promise<CodeAgentProjectSelectResult>;
  chooseProject?(): Promise<CodeAgentProjectSelectResult>;
  createRun(
    request: CodeAgentCreateRunRequest,
  ): Promise<CodeAgentCreateRunResult>;
  readTranscript(
    request: CodeAgentTranscriptRequest,
  ): Promise<CodeAgentTranscriptResult>;
  subscribeTranscript?(
    request: CodeAgentTranscriptRequest,
    callback: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
  ): () => void;
  appendFollowUp(
    request: CodeAgentFollowUpRequest,
  ): Promise<CodeAgentFollowUpResult>;
  updateRun(
    request: CodeAgentUpdateRunRequest,
  ): Promise<CodeAgentUpdateRunResult>;
  retryRun?(
    request: CodeAgentRetryRunRequest,
  ): Promise<CodeAgentRetryRunResult>;
  rerunRun?(request: CodeAgentRerunRequest): Promise<CodeAgentRerunResult>;
  controlRun(
    goalId: string,
    runId: string,
    command: CodeAgentControlCommand,
    permissionMode?: CodeAgentPermissionMode,
  ): Promise<CodeAgentControlResult>;
  openTerminal?(
    request?: CodeAgentTerminalRequest,
  ): Promise<CodeAgentTerminalResult>;
  getRemoteConnectorStatus?(): Promise<CodeAgentRemoteConnectorStatus>;
  setRemoteConnectorEnabled?(
    enabled: boolean,
  ): Promise<CodeAgentRemoteConnectorControlResult>;
  pairRemoteConnector?(
    request?: CodeAgentRemoteConnectorPairRequest,
  ): Promise<CodeAgentRemoteConnectorPairResult>;
  connectBuilderProvider?(): Promise<CodeAgentProviderConnectResult>;
}

export type CodeAgentsRenderAppSurface = (input: {
  goal: CodeAgentGoalDefinition;
  app: AppConfig;
  urlParams?: Record<string, string>;
  refreshKey: number;
}) => React.ReactNode;

export interface CodeAgentsAppProps {
  apps: AppConfig[];
  host: CodeAgentsHost;
  /** Whether the host surface is currently visible to the user. */
  isActive?: boolean;
  openRequest?: CodeAgentsOpenRequest;
  refreshKey?: number;
  brandIconUrl?: string;
  onOpenSettings?: () => void;
  renderAppSurface?: CodeAgentsRenderAppSurface;
}

type RunListStatus = CodeAgentRunListResult["status"];
type CodeAgentRunMode = "plan" | "auto";

interface CodeAgentSearchResult {
  run: CodeAgentRun;
  match: string;
  matchType: "Recent" | "Chat" | "Transcript";
  rank: number;
}

interface CodeAgentHostMetadata {
  status: "ok" | "unavailable";
  llmProvider?: {
    configured: boolean;
    label?: string;
    configuredProviders?: string[];
    missingEnvVars?: string[];
  };
  computerControl?: {
    available: boolean;
    desktop: { accessibility: boolean; screenRecording: string };
    browser: {
      nativeHostInstalled: boolean;
      extensionBundled: boolean;
      connected: boolean;
    };
  };
  error?: string;
}

export type CodeAgentComputerSetupAction =
  | "request-accessibility"
  | "request-screen-recording"
  | "open-accessibility-settings"
  | "open-screen-recording-settings"
  | "open-chrome-setup"
  | "restart";

export interface CodeAgentComputerSetupResult {
  ok: boolean;
  action: CodeAgentComputerSetupAction;
  message: string;
  restartRecommended?: boolean;
  error?: string;
}

const CODE_AGENT_RUN_MODES: Array<{
  id: CodeAgentRunMode;
  label: string;
  description: string;
}> = [
  {
    id: "plan",
    label: "Plan",
    description:
      "Inspect the workspace and connected apps, then propose a plan without taking actions.",
  },
  {
    id: "auto",
    label: "Auto",
    description:
      "Edit, run checks, and operate connected apps; pause for destructive or sensitive actions.",
  },
];

const CODE_AGENT_REASONING_EFFORTS: Array<{
  id: CodeAgentReasoningEffort;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
];

const DEFAULT_CODE_AGENT_MODEL_OPTIONS: CodeAgentModelOption[] = [
  {
    engine: "auto",
    engineLabel: "Auto",
    model: "auto",
    label: "Default model",
    description: "Use the connected provider and saved default.",
  },
];

const CODE_AGENT_MODEL_SELECTION_KEY = "agent-native-code:model-selection";
const CODE_AGENT_VIEWED_RUN_IDS_KEY = "agent-native-code:viewed-run-ids";
const CODE_AGENT_PINNED_AT_METADATA_KEY = "pinnedAt";
const DEFAULT_REMOTE_RELAY_URL = "https://dispatch.agent-native.com";

function appUrlForRemotePairing(app: AppConfig): string {
  if ((app.mode ?? "prod") === "dev") {
    return app.devUrl || (app.devPort ? `http://localhost:${app.devPort}` : "");
  }
  return app.url || app.devUrl || "";
}

function defaultRemoteRelayUrl(apps: AppConfig[]): string {
  const app =
    apps.find((item) => item.id === "dispatch" && Boolean(item.url)) ??
    apps.find((item) => Boolean(item.url)) ??
    apps.find((item) => Boolean(item.devUrl || item.devPort));
  const relayUrl = app ? appUrlForRemotePairing(app) : "";
  return relayUrl || DEFAULT_REMOTE_RELAY_URL;
}

const codeAgentComposerAreaStyle = {
  alignSelf: "stretch",
  width: "100%",
  inlineSize: "100%",
  maxWidth: "none",
  boxSizing: "border-box",
} satisfies CSSProperties;

const codeAgentComposerRootStyle = {
  width: "100%",
  inlineSize: "100%",
  maxWidth: "none",
  boxSizing: "border-box",
} satisfies CSSProperties;

export default function CodeAgentsApp({
  apps,
  host,
  isActive = true,
  openRequest,
  refreshKey = 0,
  brandIconUrl,
  onOpenSettings,
  renderAppSurface,
}: CodeAgentsAppProps) {
  const [selectedGoalId, setSelectedGoalId] = useState<CodeAgentGoalId>("task");
  const selectedGoal =
    getCodeAgentGoal(selectedGoalId) ?? getDefaultCodeAgentGoal();
  const [runs, setRuns] = useState<CodeAgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const selectedRunUsesAppSurface = selectedRun
    ? isMigrationRun(selectedRun)
    : false;
  const selectedGoalApp = useMemo(
    () =>
      selectedGoal.surfaceKind === "app" && selectedRunUsesAppSurface
        ? getCodeAgentAppConfig(selectedGoal, apps)
        : null,
    [apps, selectedGoal, selectedRunUsesAppSurface],
  );
  const [status, setStatus] = useState<RunListStatus>("unavailable");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newPromptSeed, setNewPromptSeed] = useState(0);
  const [creatingRun, setCreatingRun] = useState(false);
  const [transcriptEvents, setTranscriptEvents] = useState<
    CodeAgentTranscriptEvent[]
  >([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [newRunPermissionMode, setNewRunPermissionMode] =
    useState<CodeAgentPermissionMode>(DEFAULT_CODE_AGENT_PERMISSION_MODE);
  const [selectedPermissionMode, setSelectedPermissionMode] =
    useState<CodeAgentPermissionMode>(DEFAULT_CODE_AGENT_PERMISSION_MODE);
  const [modelOptions, setModelOptions] = useState<CodeAgentModelOption[]>(
    DEFAULT_CODE_AGENT_MODEL_OPTIONS,
  );
  const [projects, setProjects] = useState<CodeAgentProjectFolder[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [codePack, setCodePack] = useState<CodeAgentCodePack | null>(null);
  const [modelSelection, setModelSelection] = useState<CodeAgentModelSelection>(
    () => readStoredModelSelection(),
  );
  const [remoteConnectorStatus, setRemoteConnectorStatus] =
    useState<CodeAgentRemoteConnectorStatus | null>(null);
  const [remoteConnectorError, setRemoteConnectorError] = useState<
    string | null
  >(null);
  const [remoteConnectorMessage, setRemoteConnectorMessage] = useState<
    string | null
  >(null);
  const [remoteConnectorPairing, setRemoteConnectorPairing] = useState(false);
  const [remoteConnectorUpdating, setRemoteConnectorUpdating] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRuns, setSearchRuns] = useState<CodeAgentRun[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTranscriptLoading, setSearchTranscriptLoading] = useState(false);
  const [searchTranscriptVersion, setSearchTranscriptVersion] = useState(0);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [hostMetadata, setHostMetadata] =
    useState<CodeAgentHostMetadata | null>(null);
  const [computerSetupOpen, setComputerSetupOpen] = useState(false);
  const [computerSetupAction, setComputerSetupAction] =
    useState<CodeAgentComputerSetupAction | null>(null);
  const [computerSetupRestartRecommended, setComputerSetupRestartRecommended] =
    useState(false);
  const [accessibilityPrompted, setAccessibilityPrompted] = useState(false);
  const [screenRecordingPrompted, setScreenRecordingPrompted] = useState(false);
  const [builderConnecting, setBuilderConnecting] = useState(false);
  const [builderConnectMessage, setBuilderConnectMessage] = useState<
    string | null
  >(null);
  const selectedModelSelection = useMemo(
    () => normalizeModelSelection(modelSelection, modelOptions),
    [modelOptions, modelSelection],
  );
  const remoteRelayUrl = useMemo(
    () => remoteConnectorStatus?.relayUrl ?? defaultRemoteRelayUrl(apps),
    [apps, remoteConnectorStatus?.relayUrl],
  );
  const newPromptRef = useRef<TiptapComposerHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTranscriptCacheRef = useRef(
    new Map<string, CodeAgentTranscriptEvent[]>(),
  );
  const initialViewedRunIdsRef = useRef<{
    initialized: boolean;
    ids: Set<string>;
  } | null>(null);
  if (initialViewedRunIdsRef.current === null) {
    initialViewedRunIdsRef.current = readStoredViewedRunIds();
  }
  const viewedRunIdsInitializedRef = useRef(
    initialViewedRunIdsRef.current.initialized,
  );
  const [viewedRunIds, setViewedRunIds] = useState<Set<string>>(
    () => new Set(initialViewedRunIdsRef.current!.ids),
  );
  const railItems = useMemo<ChatHistoryItem[]>(
    () =>
      sortRunsForRail(runs).map((run) => ({
        id: run.id,
        title: getRunTitle(run),
        titleText: getRunTitle(run) ?? undefined,
        pinned: isRunPinned(run),
        timestamp: isRunActive(run) ? (
          <span
            className="code-agents-run-status-spinner"
            aria-label="Running"
            title="Running"
          />
        ) : !viewedRunIds.has(run.id) ? (
          <span
            className="code-agents-run-status-dot"
            aria-label="Done — unread"
            title="Done"
          />
        ) : (
          formatRelativeTime(run.updatedAt)
        ),
      })),
    [runs, viewedRunIds],
  );

  const markRunsViewed = useCallback((runIds: string[]) => {
    const ids = runIds.filter(Boolean);
    setViewedRunIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      if (next.size === current.size) return current;
      writeStoredViewedRunIds(next);
      return next;
    });
  }, []);

  const seedNewPrompt = useCallback((value: string) => {
    setNewPrompt(value);
    setNewPromptSeed((seed) => seed + 1);
    window.requestAnimationFrame(() => {
      newPromptRef.current?.focus();
    });
  }, []);

  const loadRuns = useCallback(
    async (_busy = false) => {
      try {
        const result = await host.listRuns(selectedGoal.id);
        setStatus(result.status);
        setError(result.error ?? null);
        setRuns(result.runs);
        if (result.status === "ok" && !viewedRunIdsInitializedRef.current) {
          const initialIds = result.runs.map((run) => run.id);
          viewedRunIdsInitializedRef.current = true;
          setViewedRunIds(new Set(initialIds));
          writeStoredViewedRunIds(new Set(initialIds));
        }
      } catch (err) {
        setStatus("unavailable");
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
      } finally {
        setLoading(false);
      }
    },
    [host, selectedGoal.id],
  );

  const loadSearchRuns = useCallback(async () => {
    setSearchLoading(true);
    setSearchError(null);
    searchTranscriptCacheRef.current.clear();
    setSearchTranscriptVersion((version) => version + 1);
    try {
      const results = await Promise.all(
        CODE_AGENT_GOALS.map(async (goal): Promise<CodeAgentRunListResult> => {
          try {
            return await host.listRuns(goal.id);
          } catch (err) {
            return {
              status: "unavailable",
              goalId: goal.id,
              runs: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      const runsById = new Map<string, CodeAgentRun>();
      for (const result of results) {
        for (const run of result.runs) runsById.set(run.id, run);
      }
      setSearchRuns(sortRunsForRail([...runsById.values()]));
      const firstError = results.find((result) => result.status !== "ok");
      setSearchError(firstError?.error ?? null);
    } finally {
      setSearchLoading(false);
    }
  }, [host]);

  const loadTranscript = useCallback(
    async (runId: string | null = selectedRunId, busy = false) => {
      if (!runId) {
        setTranscriptEvents([]);
        setTranscriptError(null);
        setTranscriptLoading(false);
        return;
      }
      if (busy) setTranscriptLoading(true);
      try {
        const result = await host.readTranscript({
          goalId: selectedGoal.id,
          runId,
        });
        setTranscriptEvents(result.events);
        setTranscriptError(result.error ?? null);
      } catch (err) {
        setTranscriptEvents([]);
        setTranscriptError(err instanceof Error ? err.message : String(err));
      } finally {
        setTranscriptLoading(false);
      }
    },
    [host, selectedGoal.id, selectedRunId],
  );

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const result = await host.listProjects?.();
      if (!result || result.status !== "ok") {
        setProjects([]);
        return;
      }
      setProjects(result.projects);
      setSelectedProjectPath(
        (current) => current || result.selectedPath || result.defaultPath || "",
      );
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, [host]);

  const loadRemoteConnectorStatus = useCallback(async () => {
    if (!host.getRemoteConnectorStatus) return;
    try {
      const result = await host.getRemoteConnectorStatus();
      setRemoteConnectorStatus(result);
      setRemoteConnectorError(null);
    } catch (err) {
      setRemoteConnectorError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  const loadHostMetadata = useCallback(async () => {
    if (!host.getHostMetadata) return;
    try {
      const result = await host.getHostMetadata();
      setHostMetadata(result);
    } catch (err) {
      setHostMetadata({
        status: "unavailable",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [host]);

  const runComputerSetupAction = useCallback(
    async (action: CodeAgentComputerSetupAction) => {
      if (!host.runComputerSetupAction) {
        toast("Computer access setup is not available here");
        return;
      }
      setComputerSetupAction(action);
      try {
        const result = await host.runComputerSetupAction(action);
        if (action === "request-accessibility") {
          setAccessibilityPrompted(true);
        }
        if (action === "request-screen-recording") {
          setScreenRecordingPrompted(true);
        }
        if (result.restartRecommended) {
          setComputerSetupRestartRecommended(true);
        }
        toast(result.ok ? result.message : "Could not update computer access", {
          description: result.ok ? undefined : (result.error ?? result.message),
          duration: 3200,
        });
        if (action !== "restart") await loadHostMetadata();
      } catch (err) {
        toast("Could not update computer access", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setComputerSetupAction(null);
      }
    },
    [host, loadHostMetadata],
  );

  useEffect(() => {
    if (!isActive || !host.getHostMetadata) return;
    let cancelled = false;
    const refresh = () => {
      void host.getHostMetadata!()
        .then((result) => {
          if (!cancelled) setHostMetadata(result);
        })
        .catch((err) => {
          if (!cancelled) {
            setHostMetadata({
              status: "unavailable",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [host, isActive, refreshKey]);

  const connectBuilderProvider = useCallback(async () => {
    setBuilderConnectMessage(null);
    if (!host.connectBuilderProvider) {
      onOpenSettings?.();
      return;
    }

    setBuilderConnecting(true);
    try {
      const result = await host.connectBuilderProvider();
      const message = result.error ?? result.message;
      setBuilderConnectMessage(result.ok ? null : message);
      if (result.ok) {
        toast("Builder.io connected", {
          description: "Agent can now use Builder credits.",
        });
      } else {
        toast("Builder.io connect did not finish", {
          description: message,
        });
      }
      await loadHostMetadata();
      const modelResult = await host.listModels?.();
      let retrySelection = selectedModelSelection;
      if (modelResult?.status === "ok" && modelResult.models.length > 0) {
        setModelOptions(modelResult.models);
        if (
          modelResult.selected &&
          (!modelSelection.model || modelSelection.model === "auto")
        ) {
          setModelSelection(modelResult.selected);
          retrySelection = {
            ...modelResult.selected,
            effort: selectedModelSelection.effort,
          };
        }
      }
      if (
        result.ok &&
        selectedRun &&
        hasMissingCredentialSignal(selectedRun, transcriptEvents) &&
        host.retryRun
      ) {
        const retryResult = await host.retryRun({
          goalId: selectedGoal.id,
          runId: selectedRun.id,
          permissionMode: selectedPermissionMode,
          engine: retrySelection.engine,
          model: retrySelection.model,
          effort: retrySelection.effort,
        });
        if (retryResult.run) {
          setRuns((current) => [
            retryResult.run!,
            ...current.filter((run) => run.id !== retryResult.run!.id),
          ]);
          setSelectedRunId(retryResult.run.id);
          await loadTranscript(retryResult.run.id, true);
        }
      }
      await loadRuns(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBuilderConnectMessage(message);
      toast("Builder.io connect did not finish", { description: message });
    } finally {
      setBuilderConnecting(false);
    }
  }, [
    host,
    loadHostMetadata,
    loadRuns,
    loadTranscript,
    modelSelection.model,
    onOpenSettings,
    selectedGoal.id,
    selectedModelSelection,
    selectedPermissionMode,
    selectedRun,
    transcriptEvents,
  ]);

  useEffect(() => {
    if (!isActive || !host.getRemoteConnectorStatus) return;
    void loadRemoteConnectorStatus();
    const timer = window.setInterval(
      () => void loadRemoteConnectorStatus(),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [host.getRemoteConnectorStatus, isActive, loadRemoteConnectorStatus]);

  useEffect(() => {
    if (!isActive || refreshKey <= 0) return;
    void loadRuns(true);
  }, [isActive, loadRuns, refreshKey]);

  useEffect(() => {
    if (!openRequest) return;
    const nextGoal = getCodeAgentGoal(openRequest.goalId);
    if (nextGoal) setSelectedGoalId(nextGoal.id);
    setSelectedRunId(openRequest.runId ?? null);
    setWorkbenchOpen(true);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    void loadRuns(true);
  }, [loadRuns, openRequest]);

  const hasActiveRuns = useMemo(() => runs.some(isRunActive), [runs]);
  const selectedRunIsActive = selectedRun ? isRunActive(selectedRun) : false;
  const workbenchUrlParams = selectedRunId ? { run: selectedRunId } : undefined;
  const selectedRunStoredPermissionMode = selectedRun
    ? getRunPermissionMode(selectedRun)
    : DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const slashCommands = useMemo(
    () => buildCodeAgentSlashCommands(codePack),
    [codePack],
  );
  const canOpenTerminal = Boolean(host.openTerminal);
  const canChooseProjectFolder = Boolean(host.chooseProject);
  const providerGate = useMemo(
    () => getProviderGate(hostMetadata),
    [hostMetadata],
  );
  const normalizedSearchQuery = searchQuery.trim();
  const searchResults = useMemo(
    () =>
      buildSearchRunResults(
        searchRuns,
        searchQuery,
        searchTranscriptCacheRef.current,
      ),
    [searchRuns, searchQuery, searchTranscriptVersion],
  );

  useEffect(() => {
    setSelectedPermissionMode(selectedRunStoredPermissionMode);
  }, [selectedRunId, selectedRunStoredPermissionMode]);

  useEffect(() => {
    if (selectedRunId) markRunsViewed([selectedRunId]);
  }, [markRunsViewed, selectedRunId]);

  useEffect(() => {
    if (!searchPanelOpen) return;
    void loadSearchRuns();
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [loadSearchRuns, refreshKey, searchPanelOpen]);

  useEffect(() => {
    if (
      !searchPanelOpen ||
      normalizedSearchQuery.length < 2 ||
      searchRuns.length === 0
    ) {
      setSearchTranscriptLoading(false);
      return;
    }

    const missingRuns = searchRuns.filter(
      (run) => !searchTranscriptCacheRef.current.has(run.id),
    );
    if (missingRuns.length === 0) {
      setSearchTranscriptLoading(false);
      return;
    }

    let cancelled = false;
    setSearchTranscriptLoading(true);
    void Promise.all(
      missingRuns.map(async (run) => {
        try {
          const result = await host.readTranscript({
            goalId: run.goalId,
            runId: run.id,
          });
          if (!cancelled) {
            searchTranscriptCacheRef.current.set(
              run.id,
              result.status === "ok" ? result.events : [],
            );
          }
        } catch {
          if (!cancelled) searchTranscriptCacheRef.current.set(run.id, []);
        }
      }),
    ).finally(() => {
      if (cancelled) return;
      setSearchTranscriptLoading(false);
      setSearchTranscriptVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [host, normalizedSearchQuery, searchPanelOpen, searchRuns]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void host
      .listModels?.()
      .then((result) => {
        if (cancelled || result.status !== "ok" || result.models.length === 0) {
          return;
        }
        setModelOptions(result.models);
        if (!modelSelection.model && result.selected) {
          setModelSelection(result.selected);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [host, isActive, modelSelection.model, refreshKey]);

  useEffect(() => {
    if (!isActive) return;
    void loadProjects();
  }, [isActive, loadProjects]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void host
      .listCodePacks?.(selectedProjectPath || undefined)
      .then((result) => {
        if (cancelled || result.status !== "ok") return;
        setCodePack(result.pack ?? null);
        if (!selectedProjectPath && result.pack?.root) {
          setSelectedProjectPath(result.pack.root);
        }
      })
      .catch(() => {
        if (!cancelled) setCodePack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [host, isActive, selectedProjectPath]);

  useEffect(() => {
    writeStoredModelSelection(selectedModelSelection);
  }, [selectedModelSelection]);

  useEffect(() => {
    if (!isActive) return;
    void loadRuns();
    const interval = window.setInterval(
      () => void loadRuns(),
      hasActiveRuns ? 2_000 : 10_000,
    );
    return () => window.clearInterval(interval);
  }, [hasActiveRuns, isActive, loadRuns]);

  useEffect(() => {
    if (!isActive) return;
    void loadTranscript(selectedRunId, true);
    if (!selectedRunId) return;
    const unsubscribe = host.subscribeTranscript?.(
      { goalId: selectedGoal.id, runId: selectedRunId },
      (batch) => {
        if (batch.runId && batch.runId !== selectedRunId) return;
        if (batch.error) setTranscriptError(batch.error);
        if (batch.status === "ok" && batch.events.length > 0) {
          setTranscriptError(null);
          setTranscriptEvents((current) =>
            mergeTranscriptEvents(current, batch.events),
          );
        }
      },
    );
    // When the push subscription is active it delivers events as they arrive.
    // Keep a long-interval fallback poll so we reconcile any gaps (e.g. if the
    // file watch fires before the write is fully flushed, or on first load).
    const pollMs = unsubscribe
      ? selectedRunIsActive
        ? 10_000
        : 30_000
      : selectedRunIsActive
        ? 1_000
        : 5_000;
    const interval = window.setInterval(
      () => void loadTranscript(selectedRunId),
      pollMs,
    );
    return () => {
      unsubscribe?.();
      window.clearInterval(interval);
    };
  }, [
    host,
    isActive,
    loadTranscript,
    selectedGoal.id,
    selectedRunId,
    selectedRunIsActive,
  ]);

  // Cmd+N / Ctrl+N — start a new chat from anywhere in the Code tab.
  // Use a ref so the effect is stable and doesn't re-register on every render.
  const openSelectedGoalRef = useRef(openSelectedGoal);
  openSelectedGoalRef.current = openSelectedGoal;
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key?.toLowerCase() !== "n") return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      openSelectedGoalRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive]);

  async function selectProjectFolder(pathValue: string) {
    if (!pathValue) return;
    setSelectedProjectPath(pathValue);
    try {
      const result = await host.selectProject?.(pathValue);
      if (result?.ok) {
        setProjects(result.projects);
        setSelectedProjectPath(result.selectedPath ?? pathValue);
      }
    } catch {
      // Local selection still works; host persistence is best-effort.
    }
  }

  async function chooseProjectFolder() {
    if (!host.chooseProject) {
      toast("Folder picker is not available here", {
        description:
          "Open Agent-Native Desktop to choose folders from the native picker.",
        duration: 3200,
      });
      return;
    }
    try {
      const result = await host.chooseProject();
      if (!result.ok || !result.selectedPath) {
        if (result.error && result.error !== "No folder selected.") {
          toast("Could not choose folder", {
            description: result.error,
            duration: 3200,
          });
        }
        return;
      }
      setProjects(result.projects);
      setSelectedProjectPath(result.selectedPath);
    } catch (err) {
      toast("Could not choose folder", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  function handleSlashCommand(commandName: string) {
    const normalized = commandName.replace(/^\/+/, "").toLowerCase();
    const matchingGoal = CODE_AGENT_GOALS.find(
      (goal) => goal.slashCommand?.replace(/^\/+/, "") === normalized,
    );
    if (matchingGoal) {
      setSelectedGoalId(matchingGoal.id);
      setSelectedRunId(null);
      setWorkbenchOpen(false);
      setSearchPanelOpen(false);
      setMobilePanelOpen(false);
      seedNewPrompt(
        matchingGoal.id === "task" ? "" : `${matchingGoal.slashCommand} `,
      );
      return;
    }
    const matchingSkill = codePack?.skills.find(
      (skill) => skill.name.toLowerCase() === normalized,
    );
    setSelectedGoalId("task");
    setSelectedRunId(null);
    setWorkbenchOpen(false);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    seedNewPrompt(
      matchingSkill
        ? `Use the ${matchingSkill.name} skill to `
        : `/${normalized} `,
    );
  }

  async function openTerminal() {
    if (!host.openTerminal) {
      toast("Terminal is not available here", {
        description: "Open Agent-Native Desktop to launch a native terminal.",
        duration: 3200,
      });
      return;
    }
    const terminalRequest = selectedRun
      ? getRunTerminalRequest(selectedRun)
      : selectedProjectPath
        ? { cwd: selectedProjectPath }
        : undefined;
    let result: CodeAgentTerminalResult | undefined;
    try {
      result = await host.openTerminal?.(terminalRequest);
    } catch (err) {
      toast("Terminal was not opened", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
      return;
    }
    if (result?.ok) {
      toast("Terminal opened", { duration: 1600 });
      return;
    }
    toast("Terminal was not opened", {
      description: result?.error ?? "This platform has no terminal launcher.",
      duration: 3200,
    });
  }

  function openSearchPanel() {
    setSearchPanelOpen(true);
    setMobilePanelOpen(false);
    setWorkbenchOpen(false);
  }

  function openSearchResult(run: CodeAgentRun) {
    const goal = getCodeAgentGoal(run.goalId) ?? getDefaultCodeAgentGoal();
    setSelectedGoalId(goal.id);
    setRuns((current) =>
      current.some((item) => item.id === run.id) ? current : [run, ...current],
    );
    setSelectedRunId(run.id);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    setWorkbenchOpen(false);
  }

  function openMobilePanel() {
    setSearchPanelOpen(false);
    setMobilePanelOpen(true);
    setWorkbenchOpen(false);
  }

  async function pairRemoteConnector(relayUrl: string) {
    if (!host.pairRemoteConnector) {
      toast("Mobile pairing is not available here", {
        description: "Open Agent-Native Desktop to pair this Mac.",
        duration: 3200,
      });
      return;
    }
    const trimmedRelayUrl = relayUrl.trim();
    if (!trimmedRelayUrl) {
      toast("Choose a relay first", {
        description: "A Dispatch relay URL is needed before pairing.",
        duration: 3200,
      });
      return;
    }
    setRemoteConnectorPairing(true);
    setRemoteConnectorMessage(null);
    try {
      const result = await host.pairRemoteConnector({
        relayUrl: trimmedRelayUrl,
        label: "Agent Native Desktop",
      });
      setRemoteConnectorStatus(result.status);
      setRemoteConnectorMessage(result.error ?? result.message ?? null);
      toast(result.ok ? "Mobile pairing ready" : "Mobile pairing failed", {
        description: result.error ?? result.message,
        duration: result.ok ? 2200 : 3600,
      });
      if (result.ok) void loadRemoteConnectorStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRemoteConnectorMessage(message);
      toast("Mobile pairing failed", {
        description: message,
        duration: 3600,
      });
    } finally {
      setRemoteConnectorPairing(false);
    }
  }

  async function setRemoteConnectorEnabled(enabled: boolean) {
    if (!host.setRemoteConnectorEnabled) {
      toast("Mobile pairing controls are not available here", {
        description: "Open Agent-Native Desktop to manage mobile pairing.",
        duration: 3200,
      });
      return;
    }
    setRemoteConnectorUpdating(true);
    setRemoteConnectorMessage(null);
    try {
      const result = await host.setRemoteConnectorEnabled(enabled);
      setRemoteConnectorStatus(result.status);
      setRemoteConnectorMessage(result.error ?? null);
      toast(enabled ? "Mobile pairing resumed" : "Mobile pairing paused", {
        description: result.error,
        duration: result.ok ? 1800 : 3600,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRemoteConnectorMessage(message);
      toast("Could not update mobile pairing", {
        description: message,
        duration: 3600,
      });
    } finally {
      setRemoteConnectorUpdating(false);
    }
  }

  async function copyMobileLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast("Mobile link copied", { duration: 1600 });
    } catch (err) {
      toast("Could not copy mobile link", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  function openSelectedGoal() {
    setSelectedGoalId("task");
    setSelectedRunId(null);
    setWorkbenchOpen(false);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    setTranscriptEvents([]);
    setTranscriptError(null);
    seedNewPrompt("");
  }

  async function controlRun(command: CodeAgentControlCommand) {
    if (!selectedRunId) {
      toast("Select a chat first", { duration: 1800 });
      return;
    }
    if (command === "resume" && selectedRunUsesAppSurface) {
      setWorkbenchOpen(true);
    }

    let result: CodeAgentControlResult;
    try {
      result = await host.controlRun(
        selectedGoal.id,
        selectedRunId,
        command,
        selectedPermissionMode,
      );
    } catch (err) {
      toast("Could not control the response", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
      return;
    }
    if (result.action === "open-ui") setWorkbenchOpen(true);
    if (result.action === "refresh") await loadRuns(true);
    toast(result.message, {
      duration: result.ok ? 2200 : 3600,
      description: result.error,
    });
  }

  async function createRunFromPrompt(
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) {
    if (providerGate.blocked) {
      toast("Connect a model provider first", {
        description: providerGate.description,
        duration: 3600,
      });
      return;
    }
    const typedGoal =
      CODE_AGENT_GOALS.find(
        (goal) =>
          goal.id !== "task" &&
          preparedPrompt.trim().startsWith(goal.slashCommand),
      ) ?? selectedGoal;
    const prompt = normalizePromptForSelectedGoal(typedGoal, preparedPrompt);
    if (!prompt) {
      toast("Describe an outcome first", { duration: 1800 });
      return;
    }
    setCreatingRun(true);
    try {
      const result = await host.createRun({
        goalId: typedGoal.id,
        prompt,
        cwd: selectedProjectPath || undefined,
        permissionMode: newRunPermissionMode,
        engine: selectedModelSelection.engine,
        model: selectedModelSelection.model,
        effort: selectedModelSelection.effort,
        attachments,
      });
      if (!result.ok || !result.run) {
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      setNewPrompt("");
      setNewPromptSeed((seed) => seed + 1);
      setRuns((current) => [result.run!, ...current]);
      setSelectedRunId(result.run.id);
      if (typedGoal.id !== selectedGoal.id) {
        setSelectedGoalId(typedGoal.id);
      }
      setWorkbenchOpen(false);
      setSearchPanelOpen(false);
      setMobilePanelOpen(false);
      if (result.event) setTranscriptEvents([result.event]);
      if (typedGoal.id === selectedGoal.id) {
        await loadRuns(true);
      } else {
        const refreshed = await host.listRuns(typedGoal.id);
        setStatus(refreshed.status);
        setError(refreshed.error ?? null);
        setRuns(refreshed.runs);
      }
      await loadTranscript(result.run.id, true);
    } catch (err) {
      toast("Could not start the chat", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    } finally {
      setCreatingRun(false);
    }
  }

  async function changeSelectedPermissionMode(
    nextMode: CodeAgentPermissionMode,
  ) {
    if (!selectedRun) {
      setSelectedPermissionMode(nextMode);
      return;
    }
    const previousMode = selectedPermissionMode;
    setSelectedPermissionMode(nextMode);
    setRuns((current) =>
      current.map((run) =>
        run.id === selectedRun.id ? withRunPermissionMode(run, nextMode) : run,
      ),
    );

    try {
      const result = await host.updateRun({
        goalId: selectedGoal.id,
        runId: selectedRun.id,
        permissionMode: nextMode,
      });
      if (!result.ok) {
        setSelectedPermissionMode(previousMode);
        setRuns((current) =>
          current.map((run) =>
            run.id === selectedRun.id
              ? withRunPermissionMode(run, previousMode)
              : run,
          ),
        );
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      if (result.run) {
        setRuns((current) =>
          current.map((run) =>
            run.id === result.run!.id
              ? withRunPermissionMode(result.run!, nextMode)
              : run,
          ),
        );
      }
      toast("Mode updated", { duration: 1600 });
    } catch (err) {
      setSelectedPermissionMode(previousMode);
      setRuns((current) =>
        current.map((run) =>
          run.id === selectedRun.id
            ? withRunPermissionMode(run, previousMode)
            : run,
        ),
      );
      toast("Could not update mode", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    }
  }

  async function toggleRunPinned(run: CodeAgentRun) {
    const pinned = isRunPinned(run);
    const nextPinnedAt = pinned ? null : new Date().toISOString();
    const optimisticRun = withRunPinnedAt(run, nextPinnedAt);
    setRuns((current) =>
      current.map((item) => (item.id === run.id ? optimisticRun : item)),
    );

    try {
      const result = await host.updateRun({
        goalId: selectedGoal.id,
        runId: run.id,
        metadata: {
          [CODE_AGENT_PINNED_AT_METADATA_KEY]: nextPinnedAt,
        },
      });
      if (!result.ok) {
        setRuns((current) =>
          current.map((item) => (item.id === run.id ? run : item)),
        );
        toast(result.message, {
          description: result.error,
          duration: 3200,
        });
        return;
      }
      if (result.run) {
        setRuns((current) =>
          current.map((item) =>
            item.id === result.run!.id ? result.run! : item,
          ),
        );
      }
      toast(pinned ? "Chat unpinned" : "Chat pinned", {
        duration: 1600,
      });
    } catch (err) {
      setRuns((current) =>
        current.map((item) => (item.id === run.id ? run : item)),
      );
      toast(pinned ? "Could not unpin chat" : "Could not pin chat", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  async function renameRun(run: CodeAgentRun, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === getRunTitle(run)) return;
    const optimisticRun: CodeAgentRun = { ...run, title: trimmed };
    setRuns((current) =>
      current.map((item) => (item.id === run.id ? optimisticRun : item)),
    );
    try {
      const result = await host.updateRun({
        goalId: selectedGoal.id,
        runId: run.id,
        title: trimmed,
      });
      if (!result.ok) {
        setRuns((current) =>
          current.map((item) => (item.id === run.id ? run : item)),
        );
        toast(result.message, { description: result.error, duration: 3200 });
        return;
      }
      if (result.run) {
        setRuns((current) =>
          current.map((item) =>
            item.id === result.run!.id ? result.run! : item,
          ),
        );
      }
      toast("Chat renamed", { duration: 1600 });
    } catch (err) {
      setRuns((current) =>
        current.map((item) => (item.id === run.id ? run : item)),
      );
      toast("Could not rename chat", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  const showingSelectedRunDetail =
    !workbenchOpen &&
    !mobilePanelOpen &&
    !searchPanelOpen &&
    Boolean(selectedRun);

  return (
    <section className="code-agents-surface" aria-label="Agent workspace">
      <aside
        className="code-agents-rail"
        aria-label="Agent chats and navigation"
      >
        <div className="code-agents-rail__header">
          <div className="code-agents-title-block">
            {brandIconUrl && (
              <img
                src={brandIconUrl}
                alt=""
                aria-hidden="true"
                className="code-agents-title-icon"
              />
            )}
            <h1>Agent</h1>
          </div>
        </div>

        <div className="code-agents-nav-list" aria-label="Agent navigation">
          <button
            type="button"
            className={`code-agents-nav-link${
              !searchPanelOpen && !mobilePanelOpen && !selectedRunId
                ? " code-agents-nav-link--active"
                : ""
            }`}
            onClick={openSelectedGoal}
            aria-pressed={
              !searchPanelOpen && !mobilePanelOpen && !selectedRunId
            }
          >
            <IconPlus size={15} strokeWidth={1.8} />
            <span>New chat</span>
          </button>
          <button
            type="button"
            className={`code-agents-nav-link${
              searchPanelOpen ? " code-agents-nav-link--active" : ""
            }`}
            onClick={openSearchPanel}
            aria-pressed={searchPanelOpen}
          >
            <IconSearch size={15} strokeWidth={1.8} />
            <span>Search</span>
          </button>
          {host.getRemoteConnectorStatus && (
            <MobileRailItem
              status={remoteConnectorStatus}
              error={remoteConnectorError}
              active={mobilePanelOpen}
              onOpen={openMobilePanel}
            />
          )}
          {hostMetadata?.computerControl && (
            <ComputerAccessRailItem
              metadata={hostMetadata}
              onOpen={() => setComputerSetupOpen(true)}
            />
          )}
        </div>

        <div className="code-agents-run-list">
          <p className="code-agents-rail-label">Chats</p>
          {loading ? (
            <RunListSkeleton />
          ) : runs.length === 0 ? (
            <div className="code-agents-empty-rail">
              <IconClock size={18} strokeWidth={1.7} />
              <p>No chats yet.</p>
            </div>
          ) : (
            <ChatHistoryList
              items={railItems}
              activeId={selectedRunId}
              onSelect={(id) => {
                markRunsViewed([id]);
                setSelectedRunId(id);
                setSearchPanelOpen(false);
                setMobilePanelOpen(false);
              }}
              onOpen={(id) => {
                markRunsViewed([id]);
                setSelectedRunId(id);
                setWorkbenchOpen(true);
                setSearchPanelOpen(false);
                setMobilePanelOpen(false);
              }}
              onTogglePin={(id) => {
                const run = runs.find((item) => item.id === id);
                if (run) toggleRunPinned(run);
              }}
              onRename={(id, nextTitle) => {
                const run = runs.find((item) => item.id === id);
                if (run) renameRun(run, nextTitle);
              }}
              variant="rail"
            />
          )}
        </div>
      </aside>

      <main className="code-agents-main">
        {workbenchOpen ? (
          <div className="code-agents-workbench">
            <div className="code-agents-workbench__toolbar">
              <div>
                <p className="code-agents-kicker">Chat</p>
                <h2>
                  {getRunTitle(selectedRun) ??
                    (selectedRunId
                      ? `Chat ${selectedRunId}`
                      : selectedGoal.primaryActionLabel)}
                </h2>
                <AgentCapabilitySummary
                  metadata={hostMetadata}
                  onOpenComputerSetup={() => setComputerSetupOpen(true)}
                />
              </div>
              <div className="code-agents-toolbar-actions">
                {canOpenTerminal && (
                  <button
                    type="button"
                    className="code-agents-button"
                    onClick={openTerminal}
                  >
                    <IconTerminal2 size={14} strokeWidth={1.8} />
                    Open Terminal
                  </button>
                )}
                <button
                  type="button"
                  className="code-agents-button"
                  onClick={() => setWorkbenchOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="code-agents-workbench-frame">
              {selectedGoalApp && renderAppSurface ? (
                renderAppSurface({
                  goal: selectedGoal,
                  app: selectedGoalApp,
                  urlParams: workbenchUrlParams,
                  refreshKey,
                })
              ) : (
                <NativeGoalSurface
                  goal={selectedGoal}
                  onOpenTerminal={canOpenTerminal ? openTerminal : undefined}
                />
              )}
            </div>
          </div>
        ) : (
          <div
            className={`code-agents-overview${
              showingSelectedRunDetail ? " code-agents-overview--chat" : ""
            }`}
          >
            {mobilePanelOpen ? (
              <MobileConnectorPanel
                status={remoteConnectorStatus}
                error={remoteConnectorError}
                message={remoteConnectorMessage}
                relayUrl={remoteRelayUrl}
                brandIconUrl={brandIconUrl}
                pairing={remoteConnectorPairing}
                updating={remoteConnectorUpdating}
                canPair={Boolean(host.pairRemoteConnector)}
                canToggle={Boolean(host.setRemoteConnectorEnabled)}
                onPair={pairRemoteConnector}
                onSetEnabled={setRemoteConnectorEnabled}
                onRefresh={loadRemoteConnectorStatus}
                onCopyLink={copyMobileLink}
                onOpenSettings={onOpenSettings}
              />
            ) : searchPanelOpen ? (
              <SearchChatsPanel
                query={searchQuery}
                results={searchResults}
                totalRuns={searchRuns.length}
                loading={searchLoading}
                transcriptLoading={searchTranscriptLoading}
                error={searchError}
                inputRef={searchInputRef}
                onQueryChange={setSearchQuery}
                onSelectRun={openSearchResult}
                onRefresh={loadSearchRuns}
              />
            ) : (
              <>
                {loading ? (
                  <OverviewSkeleton />
                ) : (
                  <>
                    {status !== "ok" && (
                      <div
                        className={`code-agents-callout code-agents-callout--${status}`}
                      >
                        <IconAlertCircle size={17} strokeWidth={1.8} />
                        <span>
                          {status === "unauthorized"
                            ? `Open ${selectedGoal.surfaceLabel} and sign in to see chats.`
                            : (error ??
                              `${selectedGoal.surfaceLabel} is not reporting chats yet.`)}
                        </span>
                      </div>
                    )}

                    {selectedRun ? (
                      <RunDetailCard
                        host={host}
                        run={selectedRun}
                        selectedRunId={selectedRunId}
                        goal={selectedGoal}
                        transcriptEvents={transcriptEvents}
                        transcriptLoading={transcriptLoading}
                        transcriptError={transcriptError}
                        permissionMode={selectedPermissionMode}
                        modelSelection={selectedModelSelection}
                        modelOptions={modelOptions}
                        onPermissionModeChange={changeSelectedPermissionMode}
                        onModelSelectionChange={setModelSelection}
                        onStop={() => controlRun("stop")}
                        onApprove={() => controlRun("approve")}
                        onApproveAlways={() => controlRun("approve-always")}
                        onDeny={() => controlRun("deny")}
                        providerBlocked={providerGate.blocked}
                        builderConnecting={builderConnecting}
                        builderConnectMessage={builderConnectMessage}
                        onConnectBuilder={connectBuilderProvider}
                        onOpenSettings={onOpenSettings}
                        onConnectProvider={connectBuilderProvider}
                      />
                    ) : (
                      <div className="code-agents-start">
                        <h2>What outcome do you want?</h2>
                        {providerGate.blocked && (
                          <ProviderGateNotice
                            description={providerGate.description}
                            connecting={builderConnecting}
                            message={builderConnectMessage}
                            onConnectBuilder={connectBuilderProvider}
                            onOpenSettings={onOpenSettings}
                          />
                        )}
                        <NewSessionComposer
                          prompt={newPrompt}
                          promptSeed={newPromptSeed}
                          inputRef={newPromptRef}
                          creating={creatingRun}
                          permissionMode={newRunPermissionMode}
                          modelSelection={selectedModelSelection}
                          modelOptions={modelOptions}
                          slashCommands={slashCommands}
                          disabled={providerGate.blocked}
                          onPromptChange={setNewPrompt}
                          onPermissionModeChange={setNewRunPermissionMode}
                          onModelSelectionChange={setModelSelection}
                          onSlashCommand={handleSlashCommand}
                          onSubmit={createRunFromPrompt}
                          onConnectProvider={connectBuilderProvider}
                        />
                        {(projects.length > 0 || canChooseProjectFolder) && (
                          <ProjectFolderPicker
                            variant="bar"
                            projects={projects}
                            selectedPath={selectedProjectPath}
                            loading={loadingProjects}
                            canChoose={canChooseProjectFolder}
                            onSelect={selectProjectFolder}
                            onChoose={chooseProjectFolder}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </main>
      <ComputerAccessDialog
        open={computerSetupOpen}
        onOpenChange={setComputerSetupOpen}
        metadata={hostMetadata}
        activeAction={computerSetupAction}
        accessibilityPrompted={accessibilityPrompted}
        screenRecordingPrompted={screenRecordingPrompted}
        restartRecommended={computerSetupRestartRecommended}
        onAction={runComputerSetupAction}
      />
    </section>
  );
}

function AgentCapabilitySummary({
  metadata,
  onOpenComputerSetup,
}: {
  metadata: CodeAgentHostMetadata | null;
  onOpenComputerSetup: () => void;
}) {
  const control = metadata?.computerControl;
  const desktopReady = Boolean(
    control?.available &&
    control.desktop.accessibility &&
    control.desktop.screenRecording === "granted",
  );
  const chromeReady = Boolean(
    control?.available &&
    control.browser.nativeHostInstalled &&
    control.browser.extensionBundled &&
    control.browser.connected,
  );
  return (
    <div
      className="code-agents-capabilities"
      aria-label="Agent capabilities"
      title="Auto can operate connected apps. Stop immediately releases control."
    >
      <span className="code-agents-capability code-agents-capability--ready">
        <IconCode size={13} strokeWidth={1.8} />
        Code ready
      </span>
      <button
        type="button"
        className={`code-agents-capability${chromeReady ? " code-agents-capability--ready" : ""}`}
        title={
          chromeReady
            ? "The Chrome extension is connected and ready."
            : "Load the bundled Chrome extension to enable browser control."
        }
        onClick={onOpenComputerSetup}
      >
        <IconBrandChrome size={13} strokeWidth={1.8} />
        {chromeReady ? "Chrome available" : "Chrome setup"}
      </button>
      <button
        type="button"
        className={`code-agents-capability${desktopReady ? " code-agents-capability--ready" : ""}`}
        title={
          desktopReady
            ? "Desktop Accessibility and Screen Recording permissions are ready."
            : "Enable Accessibility and Screen Recording for Agent Native in System Settings."
        }
        onClick={onOpenComputerSetup}
      >
        <IconDeviceDesktop size={13} strokeWidth={1.8} />
        {desktopReady ? "Desktop ready" : "Desktop setup"}
      </button>
    </div>
  );
}

function computerAccessReadiness(metadata: CodeAgentHostMetadata | null) {
  const control = metadata?.computerControl;
  const accessibilityReady = Boolean(control?.desktop.accessibility);
  const screenRecordingReady = control?.desktop.screenRecording === "granted";
  const chromeReady = Boolean(
    control?.browser.nativeHostInstalled &&
    control.browser.extensionBundled &&
    control.browser.connected,
  );
  return {
    accessibilityReady,
    screenRecordingReady,
    chromeReady,
    allReady: accessibilityReady && screenRecordingReady && chromeReady,
  };
}

function ComputerAccessRailItem({
  metadata,
  onOpen,
}: {
  metadata: CodeAgentHostMetadata;
  onOpen: () => void;
}) {
  const { allReady } = computerAccessReadiness(metadata);
  return (
    <button type="button" className="code-agents-nav-link" onClick={onOpen}>
      <IconDeviceDesktop size={15} strokeWidth={1.8} />
      <span>Computer access</span>
      <span
        className={`code-agents-mobile-indicator ${
          allReady
            ? "code-agents-mobile-indicator--connected"
            : "code-agents-mobile-indicator--attention"
        }`}
        aria-label={allReady ? "Ready" : "Setup needed"}
      />
    </button>
  );
}

function ComputerAccessDialog({
  open,
  onOpenChange,
  metadata,
  activeAction,
  accessibilityPrompted,
  screenRecordingPrompted,
  restartRecommended,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadata: CodeAgentHostMetadata | null;
  activeAction: CodeAgentComputerSetupAction | null;
  accessibilityPrompted: boolean;
  screenRecordingPrompted: boolean;
  restartRecommended: boolean;
  onAction: (action: CodeAgentComputerSetupAction) => void;
}) {
  const readiness = computerAccessReadiness(metadata);
  const actionButton = (
    action: CodeAgentComputerSetupAction,
    label: string,
  ) => (
    <button
      type="button"
      className="code-agents-button code-agents-computer-step__action"
      disabled={Boolean(activeAction)}
      onClick={() => onAction(action)}
    >
      {activeAction === action && (
        <IconRefresh
          className="code-agents-spinner"
          size={14}
          strokeWidth={1.8}
        />
      )}
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="computer-access-description">
        <div className="code-agents-computer-dialog__hero">
          <span className="code-agents-computer-dialog__hero-icon">
            <IconShieldCheck size={21} strokeWidth={1.7} />
          </span>
          <div>
            <DialogTitle>Computer access</DialogTitle>
            <DialogDescription id="computer-access-description">
              Agent Native only controls Chrome or your desktop while Agent is
              working. Stop releases control immediately.
            </DialogDescription>
          </div>
        </div>

        {readiness.allReady && (
          <div className="code-agents-computer-ready" role="status">
            <IconCheck size={17} strokeWidth={2} />
            <div>
              <strong>Computer access is ready</strong>
              <span>
                Chrome and desktop control are available in Auto mode.
              </span>
            </div>
          </div>
        )}

        <div className="code-agents-computer-steps">
          <ComputerAccessStep
            icon={<IconLockAccess size={18} strokeWidth={1.7} />}
            title="Accessibility"
            description="Lets the agent click, type, and use keyboard shortcuts."
            ready={readiness.accessibilityReady}
            action={
              readiness.accessibilityReady
                ? null
                : accessibilityPrompted
                  ? actionButton("open-accessibility-settings", "Open Settings")
                  : actionButton("request-accessibility", "Enable")
            }
          />
          <ComputerAccessStep
            icon={<IconScreenShare size={18} strokeWidth={1.7} />}
            title="Screen Recording"
            description="Lets the agent see what is on screen while it works."
            ready={readiness.screenRecordingReady}
            action={
              readiness.screenRecordingReady
                ? null
                : screenRecordingPrompted
                  ? actionButton(
                      "open-screen-recording-settings",
                      "Open Settings",
                    )
                  : actionButton("request-screen-recording", "Enable")
            }
          />
          <ComputerAccessStep
            icon={<IconBrandChrome size={18} strokeWidth={1.7} />}
            title="Chrome"
            description={
              readiness.chromeReady
                ? "The Agent Native extension is connected."
                : "Opens Chrome Extensions and reveals the bundled extension folder. Turn on Developer mode, choose Load unpacked, then select that folder."
            }
            ready={readiness.chromeReady}
            action={
              readiness.chromeReady
                ? null
                : actionButton("open-chrome-setup", "Open Chrome setup")
            }
          />
        </div>

        {restartRecommended &&
          (!readiness.accessibilityReady ||
            !readiness.screenRecordingReady) && (
            <div className="code-agents-computer-restart">
              <div>
                <strong>Changed a macOS permission?</strong>
                <span>
                  Restart once after enabling it so the new access takes effect.
                </span>
              </div>
              {actionButton("restart", "Restart Agent Native")}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

function ComputerAccessStep({
  icon,
  title,
  description,
  ready,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ready: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="code-agents-computer-step">
      <span className="code-agents-computer-step__icon">{icon}</span>
      <div className="code-agents-computer-step__body">
        <div className="code-agents-computer-step__title-row">
          <strong>{title}</strong>
          <span
            className={`code-agents-computer-step__status${ready ? " code-agents-computer-step__status--ready" : ""}`}
          >
            {ready ? "Ready" : "Needs setup"}
          </span>
        </div>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function isMigrationRun(run: CodeAgentRun): run is CodeAgentMigrationRun {
  return (
    typeof (run as Partial<CodeAgentMigrationRun>).sourceRoot === "string" &&
    typeof (run as Partial<CodeAgentMigrationRun>).outputRoot === "string" &&
    typeof (run as Partial<CodeAgentMigrationRun>).target === "string" &&
    typeof (run as Partial<CodeAgentMigrationRun>).phase === "string"
  );
}

function ProjectFolderPicker({
  variant = "rail",
  projects,
  selectedPath,
  loading,
  canChoose,
  onSelect,
  onChoose,
}: {
  variant?: "rail" | "bar";
  projects: CodeAgentProjectFolder[];
  selectedPath: string;
  loading: boolean;
  canChoose: boolean;
  onSelect: (path: string) => void;
  onChoose: () => void;
}) {
  const active = projects.find((project) => project.path === selectedPath);

  return (
    <div
      className={`code-agents-project-picker code-agents-project-picker--${variant}`}
    >
      <p className="code-agents-rail-label">Folder</p>
      <div className="code-agents-project-picker__row">
        <Select
          value={selectedPath || ""}
          disabled={loading || projects.length === 0}
          onValueChange={(value) => {
            if (value === "__choose__") {
              onChoose();
              return;
            }
            onSelect(value);
          }}
        >
          <SelectTrigger
            className="code-agents-project-select"
            aria-label="Select working folder"
          >
            <SelectValue
              placeholder={loading ? "Loading folders..." : "Choose folder"}
            />
          </SelectTrigger>
          <SelectContent className="code-agents-select-content">
            <SelectGroup>
              {projects.map((project) => (
                <SelectItem key={project.path} value={project.path}>
                  <span className="code-agents-project-select__item">
                    <IconFolder size={14} strokeWidth={1.8} />
                    <span>{project.name}</span>
                  </span>
                </SelectItem>
              ))}
              {canChoose && (
                <SelectItem value="__choose__">
                  <span className="code-agents-project-select__item">
                    <IconFolderPlus size={14} strokeWidth={1.8} />
                    <span>Add folder...</span>
                  </span>
                </SelectItem>
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
        {canChoose && (
          <button
            type="button"
            className="code-agents-icon-button"
            onClick={onChoose}
            title="Add folder"
            aria-label="Add folder"
          >
            <IconFolderPlus size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <p className="code-agents-project-path" title={active?.path}>
        {active?.path ?? "Runs use the selected folder as cwd."}
      </p>
    </div>
  );
}

function NewSessionComposer({
  prompt,
  promptSeed,
  inputRef,
  creating,
  permissionMode,
  modelSelection,
  modelOptions,
  slashCommands,
  disabled,
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSlashCommand,
  onSubmit,
  onConnectProvider,
}: {
  prompt: string;
  promptSeed: number;
  inputRef: React.RefObject<TiptapComposerHandle | null>;
  creating: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  slashCommands: SlashCommand[];
  disabled?: boolean;
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSlashCommand: (command: string) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) => void;
  onConnectProvider?: () => void;
}) {
  return (
    <CodeAgentComposer
      prompt={prompt}
      promptSeed={promptSeed}
      inputRef={inputRef}
      submitting={creating}
      permissionMode={permissionMode}
      modelSelection={modelSelection}
      modelOptions={modelOptions}
      slashCommands={slashCommands}
      placeholder="Describe a task or ask a question"
      variant="hero"
      disabled={disabled}
      onPromptChange={onPromptChange}
      onPermissionModeChange={onPermissionModeChange}
      onModelSelectionChange={onModelSelectionChange}
      onSlashCommand={onSlashCommand}
      onSubmit={onSubmit}
      onConnectProvider={onConnectProvider}
    />
  );
}

function CodeAgentComposer({
  prompt,
  promptSeed,
  inputRef,
  submitting,
  permissionMode,
  modelSelection,
  modelOptions,
  slashCommands = [],
  placeholder,
  variant = "compact",
  disabled = false,
  stopActive = false,
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSlashCommand,
  onSubmit,
  onStop,
  onConnectProvider,
}: {
  prompt: string;
  promptSeed?: string | number;
  inputRef?: React.RefObject<TiptapComposerHandle | null>;
  submitting: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  slashCommands?: SlashCommand[];
  placeholder: string;
  variant?: "hero" | "compact";
  disabled?: boolean;
  stopActive?: boolean;
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSlashCommand?: (command: string) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
    followUpMode?: CodeAgentFollowUpMode,
  ) => void;
  onStop?: () => void;
  onConnectProvider?: () => void;
}) {
  const normalizedModel = normalizeModelSelection(modelSelection, modelOptions);
  const availableModels = groupCodeAgentModelOptions(modelOptions);

  const readPromptFiles = useCallback(
    async (files: PromptComposerFile[]) =>
      Promise.all(files.map((file) => readAgentPromptAttachment(file))),
    [],
  );

  const modeControl = (
    <RunModeSelect
      value={permissionMode}
      onChange={onPermissionModeChange}
      compact
    />
  );

  const stopButton =
    stopActive && onStop ? (
      <button
        type="button"
        onClick={onStop}
        className="code-agents-composer-stop-button"
        aria-label="Stop response"
        title="Stop response (Esc)"
      >
        <IconPlayerStop size={14} strokeWidth={1.9} />
      </button>
    ) : undefined;

  return (
    <PromptComposer
      className="code-agents-standard-composer code-agents-composer-shell"
      style={codeAgentComposerAreaStyle}
      rootStyle={codeAgentComposerRootStyle}
      layoutVariant={variant}
      composerRef={inputRef}
      disabled={submitting || disabled}
      placeholder={placeholder}
      draftScope={
        variant === "hero"
          ? "agent-native-code:new-session"
          : "agent-native-code:follow-up"
      }
      initialText={
        promptSeed !== undefined && Number(promptSeed) > 0 ? prompt : undefined
      }
      initialTextKey={promptSeed}
      modeControl={modeControl}
      actionButton={stopButton}
      availableModels={availableModels}
      selectedModel={normalizedModel.model ?? "auto"}
      selectedEngine={normalizedModel.engine ?? "auto"}
      selectedEffort={normalizedModel.effort}
      onModelChange={(model, engine) =>
        onModelSelectionChange({
          engine,
          model,
          effort: normalizedModel.effort,
        })
      }
      onEffortChange={(effort) =>
        onModelSelectionChange({ ...normalizedModel, effort })
      }
      modelStatusChecksEnabled={false}
      onTextChange={onPromptChange}
      slashCommands={slashCommands}
      includeDefaultSlashSkills={false}
      onSlashCommand={onSlashCommand}
      onSubmit={async (text, files, _references, options) => {
        const attachments = await readPromptFiles(files);
        onSubmit(
          text,
          attachments,
          options.intent === "queued" ? "queued" : "immediate",
        );
      }}
      attachmentsEnabled
      voiceEnabled
      preserveDraftOnSubmit={false}
      onConnectProvider={onConnectProvider}
    />
  );
}

function buildCodeAgentSlashCommands(
  pack: CodeAgentCodePack | null,
): SlashCommand[] {
  const commands: SlashCommand[] = [
    ...CODE_AGENT_GOALS.filter(
      (goal) => goal.id !== "task" && goal.slashCommand,
    ).map((goal) => ({
      name: goal.slashCommand.replace(/^\/+/, ""),
      description: goal.description,
      icon: "terminal",
    })),
  ];
  for (const command of pack?.commands ?? []) {
    if (command.reserved) continue;
    commands.push({
      name: command.name,
      description: command.description ?? "Project command",
      icon: "terminal",
    });
  }
  for (const skill of pack?.skills ?? []) {
    commands.push({
      name: skill.name,
      description: skill.description ?? "Project skill",
      icon: "skill",
    });
  }
  return commands;
}

function getProviderGate(metadata: CodeAgentHostMetadata | null): {
  blocked: boolean;
  description: string;
} {
  if (metadata?.llmProvider?.configured === false) {
    return {
      blocked: true,
      description:
        "Connect Builder.io, run codex login for Codex CLI, or add your own API key.",
    };
  }
  return {
    blocked: false,
    description: "",
  };
}

function ProviderGateNotice({
  description,
  connecting,
  message,
  onConnectBuilder,
  onOpenSettings,
}: {
  description: string;
  connecting: boolean;
  message: string | null;
  onConnectBuilder: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <CodeProviderNotice
      className="code-agents-provider-gate"
      title="Connect a provider to chat"
      description={message ?? description}
      primaryActionLabel={connecting ? "Waiting..." : "Connect Builder.io"}
      primaryDisabled={connecting}
      onPrimaryAction={onConnectBuilder}
      secondaryActionLabel="API keys"
      onOpenSettings={onOpenSettings}
    />
  );
}

function CodeProviderNotice({
  className,
  title,
  description,
  primaryActionLabel,
  primaryDisabled,
  onPrimaryAction,
  secondaryActionLabel,
  onOpenSettings,
}: {
  className: string;
  title: string;
  description: string;
  primaryActionLabel?: string;
  primaryDisabled?: boolean;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onOpenSettings?: () => void;
}) {
  return (
    <div className={className}>
      <IconAlertCircle size={16} strokeWidth={1.8} />
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="code-agents-provider-actions">
        {onPrimaryAction && primaryActionLabel && (
          <button
            type="button"
            className="code-agents-button--primary"
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
          >
            {primaryActionLabel}
          </button>
        )}
        {onOpenSettings && secondaryActionLabel && (
          <button
            type="button"
            className="code-agents-button"
            onClick={onOpenSettings}
          >
            {secondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function normalizeModelSelection(
  value: CodeAgentModelSelection,
  models: CodeAgentModelOption[],
): CodeAgentModelSelection {
  const first = models[0] ?? DEFAULT_CODE_AGENT_MODEL_OPTIONS[0];
  const selected =
    models.find(
      (model) => model.engine === value.engine && model.model === value.model,
    ) ?? first;
  if (selected.engine === "auto" && selected.model === "auto") {
    return {
      effort: normalizeReasoningEffort(value.effort ?? "auto"),
    };
  }
  return {
    engine: selected.engine,
    model: selected.model,
    effort: normalizeReasoningEffort(value.effort ?? "auto"),
  };
}

function groupCodeAgentModelOptions(models: CodeAgentModelOption[]) {
  const groups = new Map<
    string,
    {
      engine: string;
      label: string;
      models: string[];
      configured: boolean;
    }
  >();
  for (const option of models) {
    const configured = option.configured !== false;
    const key = `${option.engine}:${configured ? "ready" : "setup"}`;
    const group = groups.get(key) ?? {
      engine: option.engine,
      label: option.engineLabel,
      models: [],
      configured,
    };
    if (!group.models.includes(option.model)) group.models.push(option.model);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function normalizeReasoningEffort(value: unknown): CodeAgentReasoningEffort {
  return CODE_AGENT_REASONING_EFFORTS.some((effort) => effort.id === value)
    ? (value as CodeAgentReasoningEffort)
    : "auto";
}

function readStoredModelSelection(): CodeAgentModelSelection {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CODE_AGENT_MODEL_SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      engine: typeof parsed.engine === "string" ? parsed.engine : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      effort: normalizeReasoningEffort(parsed.effort),
    };
  } catch {
    return {};
  }
}

function writeStoredModelSelection(value: CodeAgentModelSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_AGENT_MODEL_SELECTION_KEY,
      JSON.stringify(value),
    );
  } catch {
    // Ignore private-mode storage failures.
  }
}

function readStoredViewedRunIds(): {
  initialized: boolean;
  ids: Set<string>;
} {
  if (typeof window === "undefined") {
    return { initialized: true, ids: new Set() };
  }
  try {
    const raw = window.localStorage.getItem(CODE_AGENT_VIEWED_RUN_IDS_KEY);
    if (!raw) return { initialized: false, ids: new Set() };
    const parsed = JSON.parse(raw) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { ids?: unknown }).ids)
        ? (parsed as { ids: unknown[] }).ids
        : [];
    return {
      initialized: true,
      ids: new Set(ids.filter((id): id is string => typeof id === "string")),
    };
  } catch {
    return { initialized: false, ids: new Set() };
  }
}

function writeStoredViewedRunIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_AGENT_VIEWED_RUN_IDS_KEY,
      JSON.stringify({ version: 1, ids: [...ids].slice(-1000) }),
    );
  } catch {
    // Ignore private-mode storage failures.
  }
}

function RunModeSelect({
  value,
  onChange,
  disabled = false,
  title = "Mode",
  compact = false,
}: {
  value: CodeAgentPermissionMode;
  onChange: (value: CodeAgentPermissionMode) => void;
  disabled?: boolean;
  title?: string;
  compact?: boolean;
}) {
  const selectedMode = runModeFromPermissionMode(value);
  const selected = getRunModeDefinition(selectedMode);
  return (
    <fieldset
      className={`code-agents-permission${
        compact ? " code-agents-permission--compact" : ""
      }`}
    >
      {!compact && (
        <legend className="code-agents-permission__header">
          <span>{title}</span>
          <em>{selected.description}</em>
        </legend>
      )}
      <Select
        value={selectedMode}
        disabled={disabled}
        onValueChange={(nextMode) =>
          onChange(permissionModeFromRunMode(nextMode))
        }
      >
        <SelectTrigger
          className="code-agents-mode-select"
          aria-label={title}
          title={selected.description}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="code-agents-mode-menu">
          <SelectGroup>
            {CODE_AGENT_RUN_MODES.map((mode) => (
              <SelectItem
                key={mode.id}
                value={mode.id}
                description={mode.description}
              >
                {mode.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </fieldset>
  );
}

function runModeFromPermissionMode(
  permissionMode: CodeAgentPermissionMode,
): CodeAgentRunMode {
  return permissionMode === "read-only" ? "plan" : "auto";
}

function permissionModeFromRunMode(value: string): CodeAgentPermissionMode {
  return value === "plan" ? "read-only" : "full-auto";
}

function getRunModeDefinition(mode: CodeAgentRunMode) {
  return (
    CODE_AGENT_RUN_MODES.find((definition) => definition.id === mode) ??
    CODE_AGENT_RUN_MODES[1]
  );
}

function NativeGoalSurface({
  goal,
  onOpenTerminal,
}: {
  goal: CodeAgentGoalDefinition;
  onOpenTerminal?: () => void;
}) {
  return (
    <div className="code-agents-native-surface">
      <div className="code-agents-detail code-agents-detail--empty">
        <IconCode size={30} strokeWidth={1.5} />
        <h3>{goal.label}</h3>
        <p>{goal.description}</p>
        <div className="code-agents-command-line">
          {exampleCommandForGoal(goal)}
        </div>
        {onOpenTerminal && (
          <button
            type="button"
            className="code-agents-button code-agents-button--primary"
            onClick={onOpenTerminal}
          >
            <IconTerminal2 size={14} strokeWidth={1.8} />
            Open Terminal
          </button>
        )}
      </div>
    </div>
  );
}

function exampleCommandForGoal(goal: CodeAgentGoalDefinition): string {
  if (goal.id === "task") {
    return 'agent-native code "Implement the settings polish"';
  }
  if (goal.id === "migrate") {
    return "agent-native code /migrate ./legacy-app --out ../migrated-app";
  }
  return `agent-native code ${goal.slashCommand} --url https://example.com`;
}

function normalizePromptForSelectedGoal(
  goal: CodeAgentGoalDefinition,
  prompt: string,
): string {
  const trimmed = prompt.trim();
  if (!trimmed || goal.id === "task") return trimmed;
  if (trimmed.startsWith(goal.slashCommand)) return trimmed;
  return `${goal.slashCommand} ${trimmed}`.trim();
}

function isRunActive(run: CodeAgentRun): boolean {
  return isCodeAgentRunActive(run);
}

function sortRunsForRail(runs: CodeAgentRun[]): CodeAgentRun[] {
  const pinned = sortPinnedRuns(runs.filter(isRunPinned));
  const unpinned = [...runs]
    .filter((run) => !isRunPinned(run))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...pinned, ...unpinned];
}

function buildSearchRunResults(
  runs: CodeAgentRun[],
  query: string,
  transcriptCache: Map<string, CodeAgentTranscriptEvent[]>,
): CodeAgentSearchResult[] {
  const tokens = getSearchTokens(query);
  const sortedRuns = sortRunsForRail(runs);
  if (tokens.length === 0) {
    return sortedRuns.map((run, index) => ({
      run,
      match: getRunSubtitle(run),
      matchType: "Recent",
      rank: index,
    }));
  }

  return sortedRuns
    .flatMap((run): CodeAgentSearchResult[] => {
      const runText = getRunSearchText(run);
      const sessionMatch = textMatchesSearch(runText, tokens);
      const transcriptMatch = findTranscriptSearchMatch(
        transcriptCache.get(run.id) ?? [],
        tokens,
      );

      if (!sessionMatch && !transcriptMatch) return [];

      const title = getRunTitle(run) ?? "";
      const titleMatch = textMatchesSearch(title, tokens);
      return [
        {
          run,
          match: transcriptMatch ?? getSearchMatchSnippet(runText, tokens),
          matchType: transcriptMatch ? "Transcript" : "Chat",
          rank: titleMatch ? 0 : sessionMatch ? 1 : 2,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.rank - b.rank || b.run.updatedAt.localeCompare(a.run.updatedAt),
    );
}

function getSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function textMatchesSearch(text: string, tokens: string[]): boolean {
  const normalized = normalizeSearchText(text);
  return tokens.every((token) => normalized.includes(token));
}

function getRunSearchText(run: CodeAgentRun): string {
  const details =
    run.details?.map((detail) => `${detail.label} ${detail.value}`).join(" ") ??
    "";
  const metadata = run.metadata
    ? Object.values(run.metadata)
        .filter(
          (value) =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean",
        )
        .join(" ")
    : "";
  const goalLabel = getCodeAgentGoal(run.goalId)?.label ?? run.goalId;
  return [
    run.id,
    run.title,
    run.subtitle,
    run.source,
    run.sourceLabel,
    run.kind,
    run.status,
    run.phase,
    goalLabel,
    details,
    metadata,
  ]
    .filter(Boolean)
    .join(" ");
}

function findTranscriptSearchMatch(
  events: CodeAgentTranscriptEvent[],
  tokens: string[],
): string | null {
  const event = events.find((item) => textMatchesSearch(item.text, tokens));
  return event ? getSearchMatchSnippet(event.text, tokens) : null;
}

function mergeTranscriptEvents(
  current: CodeAgentTranscriptEvent[],
  incoming: CodeAgentTranscriptEvent[],
): CodeAgentTranscriptEvent[] {
  return mergeCodeAgentTranscriptEvents(current, incoming);
}

function getSearchMatchSnippet(text: string, tokens: string[]): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  const lower = compact.toLowerCase();
  const firstMatch = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const anchor = firstMatch ?? 0;
  const start = Math.max(0, anchor - 44);
  const end = Math.min(compact.length, anchor + 136);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${
    end < compact.length ? "..." : ""
  }`;
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function getSearchResultMeta(run: CodeAgentRun): string {
  return [
    getCodeAgentGoal(run.goalId)?.label,
    getRunSourceLabel(run),
    getRunStatusText(run),
  ]
    .filter(Boolean)
    .join(" · ");
}

function getRunStatusText(run: CodeAgentRun): string {
  if (run.status === "completed" || run.phase === "complete") return "Done";
  if (run.phase === "missing-credentials") return "Needs provider";
  if (hasPendingApproval(run)) return "Approval needed";
  if (run.status === "paused" || run.phase === "paused") return "Paused";
  if (run.phase === "stopped") return "Stopped";
  if (isRunActive(run)) return "Running";
  return run.phase ?? run.status;
}

function SearchChatsPanel({
  query,
  results,
  totalRuns,
  loading,
  transcriptLoading,
  error,
  inputRef,
  onQueryChange,
  onSelectRun,
  onRefresh,
}: {
  query: string;
  results: CodeAgentSearchResult[];
  totalRuns: number;
  loading: boolean;
  transcriptLoading: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onSelectRun: (run: CodeAgentRun) => void;
  onRefresh: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const statusText = loading
    ? "Loading chats..."
    : transcriptLoading && hasQuery
      ? "Searching transcripts..."
      : hasQuery
        ? `${results.length} matches`
        : `${Math.min(results.length, totalRuns)} recent chats`;
  const historyItems = useMemo<ChatHistoryItem[]>(
    () =>
      results.map((result) => ({
        id: result.run.id,
        title: getRunTitle(result.run),
        timestamp: formatRelativeTime(result.run.updatedAt),
        subtitle: (
          <span className="code-agents-search-result__meta">
            <span>{result.matchType}</span>
            <span>{getSearchResultMeta(result.run)}</span>
          </span>
        ),
        detail: result.match,
      })),
    [results],
  );

  return (
    <div className="code-agents-search-panel">
      <div className="code-agents-search-header">
        <div>
          <p className="code-agents-kicker">Search</p>
          <h2>Search chats</h2>
        </div>
        <button
          type="button"
          className="code-agents-button"
          onClick={onRefresh}
          disabled={loading}
        >
          <IconRefresh size={14} strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      <label className="code-agents-search-box">
        <IconSearch size={16} strokeWidth={1.8} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </label>

      <div className="code-agents-search-meta">
        <span>{statusText}</span>
        {totalRuns > 0 && <span>{totalRuns} total</span>}
      </div>

      {error && (
        <div className="code-agents-transcript__error">
          <IconAlertCircle size={15} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}

      <div className="code-agents-search-results">
        {loading && results.length === 0 ? (
          <>
            <div className="code-agents-run-skeleton" />
            <div className="code-agents-run-skeleton" />
            <div className="code-agents-run-skeleton" />
          </>
        ) : (
          <ChatHistoryList
            items={historyItems}
            searchValue={query}
            onSelect={(id) => {
              const result = results.find((item) => item.run.id === id);
              if (result) onSelectRun(result.run);
            }}
            emptyLabel={
              <div className="code-agents-detail code-agents-detail--empty">
                <IconSearch size={30} strokeWidth={1.5} />
                <h3>No chats yet</h3>
                <p>Start a chat and it will show up here.</p>
              </div>
            }
            emptySearchLabel={
              <div className="code-agents-detail code-agents-detail--empty">
                <IconSearch size={30} strokeWidth={1.5} />
                <h3>No chats found</h3>
                <p>
                  Try a title, folder, command, or phrase from the conversation.
                </p>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function MobileRailItem({
  status,
  error,
  active,
  onOpen,
}: {
  status: CodeAgentRemoteConnectorStatus | null;
  error: string | null;
  active: boolean;
  onOpen: () => void;
}) {
  const copy = mobileConnectorCopy(status, error);
  return (
    <button
      type="button"
      className={`code-agents-nav-link code-agents-mobile-link${
        active ? " code-agents-nav-link--active" : ""
      }`}
      onClick={onOpen}
      aria-pressed={active}
      title={copy.description}
    >
      <IconDeviceMobile size={15} strokeWidth={1.8} />
      <span>Mobile</span>
    </button>
  );
}

function mobileConnectorCopy(
  status: CodeAgentRemoteConnectorStatus | null,
  error: string | null,
): {
  description: string;
  tone: "connected" | "pending" | "idle" | "attention";
} {
  if (error) {
    return { description: "Mobile setup needs attention", tone: "attention" };
  }
  if (!status) {
    return {
      description: "Checking mobile setup",
      tone: "pending",
    };
  }
  if (!status.configured) {
    return {
      description: "Set up mobile pairing",
      tone: "idle",
    };
  }
  if (!status.enabled) {
    return {
      description: "Mobile pairing is paused",
      tone: "idle",
    };
  }
  if (status.state === "error") {
    return {
      description: "Mobile setup needs attention",
      tone: "attention",
    };
  }
  if (status.state === "running") {
    return {
      description: `Mobile connected through ${hostForDisplay(status.relayUrl)}`,
      tone: "connected",
    };
  }
  if (status.state === "starting") {
    return {
      description: "Connecting mobile",
      tone: "pending",
    };
  }
  return {
    description: "Set up mobile pairing",
    tone: "idle",
  };
}

function hostForDisplay(url: string | undefined): string {
  if (!url) return "relay";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function mobileDeepLinkForRelay(
  relayUrl: string,
  platform: "ios" | "android",
): string {
  const url = relayUrl || DEFAULT_REMOTE_RELAY_URL;
  return `agentnative:///sessions?relayUrl=${encodeURIComponent(
    url,
  )}&platform=${platform}`;
}

function connectorStatusTitle(
  status: CodeAgentRemoteConnectorStatus | null,
  error: string | null,
): string {
  if (error || status?.state === "error") return "Needs attention";
  if (!status) return "Checking connector";
  if (!status.configured) return "Pair this Mac";
  if (!status.enabled) return "Pairing paused";
  if (status.state === "running") return "Connected";
  if (status.state === "starting") return "Connecting";
  return "Ready to pair";
}

function MobileConnectorPanel({
  status,
  error,
  message,
  relayUrl,
  brandIconUrl,
  pairing,
  updating,
  canPair,
  canToggle,
  onPair,
  onSetEnabled,
  onRefresh,
  onCopyLink,
  onOpenSettings,
}: {
  status: CodeAgentRemoteConnectorStatus | null;
  error: string | null;
  message: string | null;
  relayUrl: string;
  brandIconUrl?: string;
  pairing: boolean;
  updating: boolean;
  canPair: boolean;
  canToggle: boolean;
  onPair: (relayUrl: string) => Promise<void>;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCopyLink: (link: string) => Promise<void>;
  onOpenSettings?: () => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const copy = mobileConnectorCopy(status, error);
  const mobileLink = mobileDeepLinkForRelay(relayUrl, platform);
  const needsPairing =
    !status?.configured || Boolean(error) || status?.state === "error";
  const paused = Boolean(status?.configured && !status.enabled);
  const busy = pairing || updating;
  const primaryLabel = needsPairing
    ? pairing
      ? "Pairing..."
      : "Pair this Mac"
    : paused
      ? updating
        ? "Turning on..."
        : "Resume pairing"
      : "Copy mobile link";
  const primaryDisabled =
    busy || !relayUrl || (needsPairing && !canPair) || (paused && !canToggle);
  const statusMessage = error ?? status?.error ?? message;
  const statusTitle = connectorStatusTitle(status, error);

  function handlePrimaryAction() {
    if (needsPairing) {
      void onPair(relayUrl);
      return;
    }
    if (paused) {
      void onSetEnabled(true);
      return;
    }
    void onCopyLink(mobileLink);
  }

  return (
    <section className="code-agents-mobile-panel" aria-label="Mobile pairing">
      <div className="code-agents-mobile-panel__header">
        <p className="code-agents-mobile-panel__eyebrow">
          <IconQrcode size={15} strokeWidth={1.8} />
          Mobile
        </p>
        <h2>Agent Native mobile</h2>
        <p>
          Scan the QR code to open chats on your phone, then pair this Mac to
          start and continue local Agent work from mobile.
        </p>
      </div>

      <div className="code-agents-mobile-panel__layout">
        <div className="code-agents-mobile-qr-card">
          <div
            className="code-agents-mobile-platform-tabs"
            role="tablist"
            aria-label="Mobile platform"
          >
            <button
              type="button"
              role="tab"
              aria-selected={platform === "ios"}
              className={
                platform === "ios"
                  ? "code-agents-mobile-platform-tab code-agents-mobile-platform-tab--active"
                  : "code-agents-mobile-platform-tab"
              }
              onClick={() => setPlatform("ios")}
            >
              iOS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={platform === "android"}
              className={
                platform === "android"
                  ? "code-agents-mobile-platform-tab code-agents-mobile-platform-tab--active"
                  : "code-agents-mobile-platform-tab"
              }
              onClick={() => setPlatform("android")}
            >
              Android
            </button>
          </div>

          <div className="code-agents-mobile-qr-shell">
            <QRCodeSVG
              value={mobileLink}
              size={224}
              level="H"
              marginSize={3}
              title="Open Agent Native mobile chats"
              bgColor="#ffffff"
              fgColor="#111111"
            />
            {brandIconUrl && (
              <span className="code-agents-mobile-qr-badge" aria-hidden="true">
                <img src={brandIconUrl} alt="" />
              </span>
            )}
          </div>

          <div className="code-agents-mobile-link-row">
            <IconLink size={14} strokeWidth={1.8} />
            <span>{hostForDisplay(relayUrl)}</span>
          </div>
        </div>

        <div className="code-agents-mobile-side">
          <div
            className={`code-agents-mobile-status-card code-agents-mobile-status-card--${copy.tone}`}
          >
            <span
              className={`code-agents-mobile-indicator code-agents-mobile-indicator--${copy.tone}`}
              aria-hidden="true"
            />
            <div>
              <strong>{statusTitle}</strong>
              <span>{copy.description}</span>
            </div>
          </div>

          {statusMessage && (
            <div className="code-agents-mobile-message">{statusMessage}</div>
          )}

          <div className="code-agents-mobile-actions">
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              disabled={primaryDisabled}
              onClick={handlePrimaryAction}
            >
              {needsPairing ? (
                <IconDeviceMobile size={14} strokeWidth={1.8} />
              ) : paused ? (
                <IconCheck size={14} strokeWidth={1.8} />
              ) : (
                <IconCopy size={14} strokeWidth={1.8} />
              )}
              {primaryLabel}
            </button>
            <button
              type="button"
              className="code-agents-button"
              onClick={() => void onRefresh()}
            >
              <IconRefresh size={14} strokeWidth={1.8} />
              Refresh
            </button>
            {onOpenSettings && (
              <button
                type="button"
                className="code-agents-button"
                onClick={onOpenSettings}
              >
                <IconSettings size={14} strokeWidth={1.8} />
                Manage
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function RunDetailCard({
  host,
  run,
  selectedRunId,
  goal,
  transcriptEvents,
  transcriptLoading,
  transcriptError,
  permissionMode,
  modelSelection,
  modelOptions,
  onPermissionModeChange,
  onModelSelectionChange,
  onStop,
  onApprove,
  onApproveAlways,
  onDeny,
  providerBlocked,
  builderConnecting,
  builderConnectMessage,
  onConnectBuilder,
  onOpenSettings,
  onConnectProvider,
}: {
  host: CodeAgentsHost;
  run: CodeAgentRun | null;
  selectedRunId: string | null;
  goal: CodeAgentGoalDefinition;
  transcriptEvents: CodeAgentTranscriptEvent[];
  transcriptLoading: boolean;
  transcriptError: string | null;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onStop: () => void;
  onApprove: () => void;
  onApproveAlways: () => void;
  onDeny: () => void;
  providerBlocked: boolean;
  builderConnecting: boolean;
  builderConnectMessage: string | null;
  onConnectBuilder: () => void;
  onOpenSettings?: () => void;
  onConnectProvider?: () => void;
}) {
  const runIsActive = run ? isRunActive(run) : false;

  useEffect(() => {
    if (!runIsActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onStop();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onStop, runIsActive]);

  if (!run) {
    return (
      <div className="code-agents-detail code-agents-detail--empty">
        <IconRoute size={30} strokeWidth={1.5} />
        <h3>{selectedRunId ? "Chat link ready" : "No chat selected"}</h3>
        <p>
          {selectedRunId
            ? `Open ${goal.surfaceLabel} to load the linked chat.`
            : "Start a new chat or choose one from the sidebar."}
        </p>
      </div>
    );
  }

  const hasCredentialHistory = hasMissingCredentialSignal(
    run,
    transcriptEvents,
  );
  const hasCredentialGap = providerBlocked && hasCredentialHistory;
  const pendingApproval = hasCredentialGap ? null : getPendingApproval(run);
  // The inline per-tool-call approval affordance (rendered by AssistantChat /
  // ToolCallDisplay via the tool-call's `approval` field) already covers this
  // pending approval when the transcript join succeeds. Keep this standalone
  // banner only as a fallback for transcripts where that join is missing
  // (legacy runs, or a pending approval whose bash result isn't present in
  // the rendered window) so the two affordances don't double up.
  const hasInlineApprovalAffordance = pendingApproval
    ? codeAgentTranscriptHasPendingApproval(transcriptEvents)
    : false;
  const showApprovalBanner =
    Boolean(pendingApproval) && !hasInlineApprovalAffordance;

  return (
    <div className="code-agents-detail code-agents-detail--chat">
      {hasCredentialGap && (
        <CodeProviderNotice
          className="code-agents-credential-callout"
          title="Provider needed"
          description={
            builderConnectMessage ??
            "Connect Builder.io, run codex login for Codex CLI, or add your own API key."
          }
          primaryActionLabel={
            builderConnecting ? "Waiting..." : "Connect Builder.io"
          }
          primaryDisabled={builderConnecting}
          onPrimaryAction={onConnectBuilder}
          secondaryActionLabel="API keys"
          onOpenSettings={onOpenSettings}
        />
      )}

      {showApprovalBanner && pendingApproval && (
        <div className="code-agents-approval-callout">
          <IconAlertCircle size={16} strokeWidth={1.8} />
          <div>
            <strong>Approval pending</strong>
            <span>{pendingApproval.reason}</span>
            {pendingApproval.command && <code>{pendingApproval.command}</code>}
          </div>
          <div className="code-agents-approval-actions">
            <button
              type="button"
              className="code-agents-button code-agents-button--ghost code-agents-button--danger"
              onClick={onDeny}
              title="Deny — model will adapt its plan"
            >
              <IconBan size={14} strokeWidth={1.8} />
              Deny
            </button>
            <button
              type="button"
              className="code-agents-button"
              onClick={onApproveAlways}
              title="Approve and always allow this exact command"
            >
              <IconShieldCheck size={14} strokeWidth={1.8} />
              Always allow
            </button>
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              onClick={onApprove}
            >
              <IconPlayerPlay size={14} strokeWidth={1.8} />
              Approve
            </button>
          </div>
        </div>
      )}

      <TranscriptPanel
        host={host}
        goal={goal}
        run={run}
        events={transcriptEvents}
        loading={transcriptLoading}
        error={transcriptError}
        runIsActive={runIsActive}
        permissionMode={permissionMode}
        modelSelection={modelSelection}
        modelOptions={modelOptions}
        hideCredentialMessages={hasCredentialHistory}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelectionChange={onModelSelectionChange}
        onStop={onStop}
        onDeny={onDeny}
        onApproveAlways={onApproveAlways}
        onConnectProvider={onConnectProvider}
      />
    </div>
  );
}

function TranscriptPanel({
  host,
  goal,
  run,
  events,
  loading,
  error,
  runIsActive,
  permissionMode,
  modelSelection,
  modelOptions,
  hideCredentialMessages = false,
  onPermissionModeChange,
  onModelSelectionChange,
  onStop,
  onDeny,
  onApproveAlways,
  onConnectProvider,
}: {
  host: CodeAgentsHost;
  goal: CodeAgentGoalDefinition;
  run: CodeAgentRun;
  events: CodeAgentTranscriptEvent[];
  loading: boolean;
  error: string | null;
  runIsActive: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  hideCredentialMessages?: boolean;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onStop: () => void;
  /** Resolves the run's pending approval as denied — same command the standalone approval banner uses. */
  onDeny?: () => void;
  /** Resolves the run's pending approval as approved and allowlists the exact command — same command the banner uses. */
  onApproveAlways?: () => void;
  onConnectProvider?: () => void;
}) {
  const normalizedModel = normalizeModelSelection(modelSelection, modelOptions);
  const selectedModel = normalizedModel.model ?? "auto";
  const selectedEngine = normalizedModel.engine ?? "auto";
  const selectedEffort = normalizeReasoningEffort(
    normalizedModel.effort ?? "auto",
  );
  const availableModels = groupCodeAgentModelOptions(modelOptions);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const hideCredentialMessagesRef = useRef(hideCredentialMessages);
  hideCredentialMessagesRef.current = hideCredentialMessages;
  const runIdRef = useRef<string | null>(run.id);
  runIdRef.current = run.id;
  const permissionModeRef = useRef<string | undefined>(permissionMode);
  permissionModeRef.current = permissionMode;
  const modelRef = useRef<string | undefined>(selectedModel);
  modelRef.current = selectedModel === "auto" ? undefined : selectedModel;
  const engineRef = useRef<string | undefined>(selectedEngine);
  engineRef.current = selectedEngine === "auto" ? undefined : selectedEngine;
  const effortRef = useRef<CodeAgentReasoningEffort | undefined>(
    selectedEffort,
  );
  effortRef.current = selectedEffort;
  const followUpModeRef = useRef<CodeAgentFollowUpMode | undefined>(undefined);
  const attachOnlyRef = useRef(false);
  attachOnlyRef.current = false;

  const controller = useMemo(
    () => createHostCodeAgentChatController(host, goal.id, permissionModeRef),
    [goal.id, host],
  );
  const createAdapter = useCallback(
    () =>
      createCodeAgentChatAdapter({
        controller,
        runIdRef,
        permissionModeRef,
        modelRef,
        engineRef,
        effortRef,
        followUpModeRef,
        attachOnlyRef,
        tabId: `code-agent:${run.id}`,
      }),
    [controller, run.id],
  );
  const loadHistoryRepository = useCallback(async () => {
    const eventsToRender = hideCredentialMessagesRef.current
      ? eventsRef.current.filter((event) => !isCredentialTranscriptEvent(event))
      : eventsRef.current;
    return buildRepositoryFromCodeAgentTranscript(eventsToRender, {
      hideCredentialMessages: hideCredentialMessagesRef.current,
    });
  }, []);
  const historyReloadKey = useMemo(() => {
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    return [
      run.id,
      events.length,
      lastEvent?.id ?? "",
      lastEvent?.createdAt ?? "",
      hideCredentialMessages ? "hide" : "show",
    ].join(":");
  }, [events, hideCredentialMessages, run.id]);
  return (
    <div className="code-agents-transcript">
      {error && (
        <div className="code-agents-transcript__error">
          <IconAlertCircle size={15} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}
      {loading && events.length === 0 ? (
        <div className="code-agents-transcript__empty">
          Loading transcript...
        </div>
      ) : (
        <AssistantChat
          key={run.id}
          className="code-agents-transcript__assistant"
          tabId={`code-agent:${run.id}`}
          showHeader={false}
          emptyStateText="No messages yet."
          suggestions={[]}
          dynamicSuggestions={false}
          plusMenuMode="upload-only"
          providerStatusChecksEnabled={false}
          createAdapter={createAdapter}
          adapterReloadKey={controller}
          loadHistoryRepository={loadHistoryRepository}
          historyReloadKey={historyReloadKey}
          externalStreaming={runIsActive}
          approvalActions={
            onDeny || onApproveAlways
              ? { onDeny, onAlwaysAllow: onApproveAlways }
              : undefined
          }
          availableModels={availableModels}
          selectedModel={selectedModel}
          selectedEngine={selectedEngine}
          selectedEffort={selectedEffort}
          onModelChange={(model, engine) =>
            onModelSelectionChange({
              engine,
              model,
              effort: selectedEffort,
            })
          }
          onEffortChange={(effort) =>
            onModelSelectionChange({ ...normalizedModel, effort })
          }
          composerAreaClassName="code-agents-standard-composer"
          composerToolbarSlot={
            <div className="code-agents-chat-composer-slot">
              <RunModeSelect
                value={permissionMode}
                onChange={onPermissionModeChange}
                compact
              />
            </div>
          }
          composerExtraActionButton={
            runIsActive ? <CodeAgentStopButton onStop={onStop} /> : undefined
          }
          onConnectProvider={onConnectProvider}
        />
      )}
    </div>
  );
}

function CodeAgentStopButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      className="code-agents-composer-stop-button"
      aria-label="Stop response"
      title="Stop response (Esc)"
    >
      <IconPlayerStop size={14} strokeWidth={1.9} />
    </button>
  );
}

function createHostCodeAgentChatController(
  host: CodeAgentsHost,
  goalId: string,
  permissionModeRef?: { current: string | undefined },
): CodeAgentChatController {
  return {
    async get(runId) {
      const result = await host.listRuns(goalId);
      return result.runs.find((run) => run.id === runId) ?? null;
    },
    async transcript(runId) {
      const result = await host.readTranscript({ goalId, runId });
      return result.status === "ok" ? result.events : [];
    },
    async sendFollowUp(input) {
      const result = await host.appendFollowUp({
        goalId,
        runId: input.runId,
        prompt: input.prompt,
        followUpMode: input.mode,
        permissionMode: input.permissionMode as
          | CodeAgentPermissionMode
          | undefined,
        engine: input.engine,
        model: input.model,
        effort: input.reasoningEffort as CodeAgentReasoningEffort | undefined,
        attachments: normalizePromptAttachmentsForHost(input.metadata),
      });
      return {
        ok: result.ok,
        message: result.message,
        error: result.error,
      };
    },
    async control(input) {
      const result = await host.controlRun(
        goalId,
        input.runId,
        input.command,
        permissionModeRef?.current as CodeAgentPermissionMode | undefined,
      );
      return {
        ok: result.ok,
        run: result.run ?? null,
        message: result.message,
        error: result.error,
      };
    },
  };
}

function normalizePromptAttachmentsForHost(
  metadata: Record<string, unknown> | undefined,
): CodeAgentPromptAttachment[] | undefined {
  const raw = metadata?.attachments;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((item): item is CodeAgentPromptAttachment => {
    return Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as CodeAgentPromptAttachment).name === "string",
    );
  });
}

function RunListSkeleton() {
  return (
    <>
      <div className="code-agents-run-skeleton" />
      <div className="code-agents-run-skeleton" />
      <div className="code-agents-run-skeleton" />
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div
      className="code-agents-overview-skeleton"
      role="status"
      aria-label="Loading agent workspace"
    >
      <div className="code-agents-overview-skeleton__title" />
      <div className="code-agents-overview-skeleton__composer" />
    </div>
  );
}

function hasMissingCredentialSignal(
  run: CodeAgentRun,
  transcriptEvents: CodeAgentTranscriptEvent[],
): boolean {
  if (run.phase === "missing-credentials") return true;
  return transcriptEvents.some(isCredentialTranscriptEvent);
}

// Delegates to the shared core helper so this surface and the server-side
// transcript builders (thread-data-builder.ts, code-agent-transcript.ts)
// agree on one definition instead of each keeping its own regex. The helper
// prefers the structured `signal` field and only falls back to matching the
// legacy hint text for transcripts persisted before that field existed.
function isCredentialTranscriptEvent(event: CodeAgentTranscriptEvent): boolean {
  return isCredentialGapCodeAgentEvent(event);
}

function hasPendingApproval(run: CodeAgentRun): boolean {
  return Boolean(run.needsApproval || getPendingApproval(run));
}

function getPendingApproval(
  run: CodeAgentRun,
): { reason: string; command?: string } | null {
  const value = run.metadata?.pendingApproval;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return run.needsApproval ? { reason: "Review the pending action." } : null;
  }

  const record = value as Record<string, unknown>;
  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : "Review the pending action.";
  const command =
    typeof record.command === "string" && record.command.trim()
      ? record.command.trim()
      : undefined;
  return { reason, command };
}

function getRunTitle(run: CodeAgentRun | null): string | null {
  if (!run) return null;
  if (isMigrationRun(run)) return run.name;
  return run.title || run.id;
}

function getRunPinnedAt(run: CodeAgentRun): string | null {
  const value = run.metadata?.[CODE_AGENT_PINNED_AT_METADATA_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRunPinned(run: CodeAgentRun): boolean {
  return Boolean(getRunPinnedAt(run));
}

function withRunPinnedAt(
  run: CodeAgentRun,
  pinnedAt: string | null,
): CodeAgentRun {
  return {
    ...run,
    metadata: {
      ...(run.metadata ?? {}),
      [CODE_AGENT_PINNED_AT_METADATA_KEY]: pinnedAt,
    },
  };
}

function sortPinnedRuns(runs: CodeAgentRun[]): CodeAgentRun[] {
  return [...runs].sort((a, b) => {
    const aPinnedAt = getRunPinnedAt(a) ?? a.updatedAt;
    const bPinnedAt = getRunPinnedAt(b) ?? b.updatedAt;
    return bPinnedAt.localeCompare(aPinnedAt);
  });
}

function getRunSubtitle(run: CodeAgentRun): string {
  if (run.subtitle) return run.subtitle;
  if (isMigrationRun(run)) return run.sourceRoot;
  return run.goalId && run.goalId !== "task"
    ? `${run.goalId} chat`
    : "Agent chat";
}

function getRunPermissionMode(run: CodeAgentRun): CodeAgentPermissionMode {
  const metadataMode = getCodeAgentPermissionMode(
    getStringMetadata(run, "permissionMode"),
  );
  if (metadataMode) return metadataMode;

  const detailMode = getCodeAgentPermissionMode(
    run.details?.find((detail) => isPermissionDetail(detail.label))?.value,
  );
  return detailMode ?? DEFAULT_CODE_AGENT_PERMISSION_MODE;
}

function withRunPermissionMode(
  run: CodeAgentRun,
  permissionMode: CodeAgentPermissionMode,
): CodeAgentRun {
  return {
    ...run,
    metadata: {
      ...(run.metadata ?? {}),
      permissionMode,
    },
    details: withPermissionDetail(run.details ?? [], permissionMode),
  };
}

function withPermissionDetail(
  details: CodeAgentRunDetail[],
  permissionMode: CodeAgentPermissionMode,
): CodeAgentRunDetail[] {
  const displayValue = formatPermissionMode(permissionMode);
  let found = false;
  const next = details.map((detail) => {
    if (!isPermissionDetail(detail.label)) return detail;
    found = true;
    return { ...detail, label: "Mode", value: displayValue };
  });
  return found ? next : [...next, { label: "Mode", value: displayValue }];
}

function isPermissionDetail(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized.includes("permission") || normalized === "mode";
}

function formatPermissionMode(value: CodeAgentPermissionMode): string {
  return getRunModeDefinition(runModeFromPermissionMode(value)).label;
}

function getRunTerminalRequest(
  run: CodeAgentRun,
): CodeAgentTerminalRequest | undefined {
  if (isMigrationRun(run)) {
    return { sourceRoot: run.sourceRoot, outputRoot: run.outputRoot };
  }
  const sourceRoot = getStringMetadata(run, "sourceRoot");
  const outputRoot = getStringMetadata(run, "outputRoot");
  const cwd = getStringMetadata(run, "cwd");
  return sourceRoot || outputRoot || cwd
    ? { sourceRoot, outputRoot, cwd }
    : undefined;
}

function getRunSourceDetail(run: CodeAgentRun): CodeAgentRunDetail | null {
  const label = getRunSourceLabel(run);
  if (!label) return null;
  return { label: "Source", value: label };
}

function getRunSourceLabel(run: CodeAgentRun): string | null {
  const direct = cleanRunLabel(run.sourceLabel);
  if (direct) return direct;

  const metadataLabel = cleanRunLabel(getStringMetadata(run, "sourceLabel"));
  if (metadataLabel) return metadataLabel;

  const source = cleanRunLabel(run.source ?? getStringMetadata(run, "source"));
  if (source) return formatRunSourceLabel(source);

  const kind = cleanRunLabel(run.kind ?? getStringMetadata(run, "kind"));
  return kind ? formatRunSourceLabel(kind) : null;
}

function cleanRunLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatRunSourceLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "code") return "Local Agent";
  if (
    normalized === "agent-team" ||
    normalized === "agent-teams" ||
    normalized === "teams"
  ) {
    return "Agent Teams";
  }
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getStringMetadata(run: CodeAgentRun, key: string): string | undefined {
  const value = run.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "now";

  const abs = Math.abs(Date.now() - time);
  if (abs < 60_000) return "now";

  const units: Array<[string, number]> = [
    ["y", 31_536_000_000],
    ["mo", 2_592_000_000],
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      return `${Math.max(1, Math.floor(abs / ms))}${unit}`;
    }
  }
  return "now";
}
