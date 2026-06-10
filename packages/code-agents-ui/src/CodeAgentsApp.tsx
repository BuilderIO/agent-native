import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  IconAlertCircle,
  IconBan,
  IconBrain,
  IconCheck,
  IconClock,
  IconCode,
  IconCopy,
  IconDeviceMobile,
  IconDots,
  IconExternalLink,
  IconFolder,
  IconFolderPlus,
  IconLink,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconQrcode,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconTerminal2,
} from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import {
  AssistantChat,
  PromptComposer,
  buildRepositoryFromCodeAgentTranscript,
  createCodeAgentChatAdapter,
  isCodeAgentRunActive,
  mergeCodeAgentTranscriptEvents,
  readAgentPromptAttachment,
  type CodeAgentChatController,
  type PromptComposerFile,
  type SlashCommand,
  type TiptapComposerHandle,
} from "@agent-native/core/client";
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
import type { AppConfig } from "@agent-native/shared-app-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";
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

export interface CodeAgentsHost {
  listRuns(goalId?: string): Promise<CodeAgentRunListResult>;
  listModels?(): Promise<CodeAgentModelListResult>;
  getHostMetadata?(): Promise<CodeAgentHostMetadata>;
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
  matchType: "Recent" | "Session" | "Transcript";
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
    description: "Read the workspace and propose a plan before editing.",
  },
  {
    id: "auto",
    label: "Auto",
    description:
      "Edit, run checks, and only pause for destructive file, git, or data operations.",
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
  const [updatingPermissionMode, setUpdatingPermissionMode] = useState(false);
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

  useEffect(() => {
    if (!host.getHostMetadata) return;
    let cancelled = false;
    void host
      .getHostMetadata()
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
    return () => {
      cancelled = true;
    };
  }, [host, refreshKey]);

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
          description: "Code can now use Builder credits.",
        });
      } else {
        toast("Builder.io connect did not finish", {
          description: message,
        });
      }
      await loadHostMetadata();
      const modelResult = await host.listModels?.();
      if (modelResult?.status === "ok" && modelResult.models.length > 0) {
        setModelOptions(modelResult.models);
        if (!modelSelection.model && modelResult.selected) {
          setModelSelection(modelResult.selected);
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
  }, [host, loadHostMetadata, loadRuns, modelSelection.model, onOpenSettings]);

  useEffect(() => {
    if (!host.getRemoteConnectorStatus) return;
    void loadRemoteConnectorStatus();
    const timer = window.setInterval(
      () => void loadRemoteConnectorStatus(),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [host.getRemoteConnectorStatus, loadRemoteConnectorStatus]);

  useEffect(() => {
    if (refreshKey <= 0) return;
    void loadRuns(true);
  }, [loadRuns, refreshKey]);

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
  }, [host, modelSelection.model, refreshKey]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
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
  }, [host, selectedProjectPath]);

  useEffect(() => {
    writeStoredModelSelection(selectedModelSelection);
  }, [selectedModelSelection]);

  useEffect(() => {
    void loadRuns();
    const interval = window.setInterval(
      () => void loadRuns(),
      hasActiveRuns ? 2_000 : 10_000,
    );
    return () => window.clearInterval(interval);
  }, [hasActiveRuns, loadRuns]);

  useEffect(() => {
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
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key?.toLowerCase() !== "n") return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      openSelectedGoalRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
      toast("Select a session first", { duration: 1800 });
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
      toast("Could not control the session", {
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

  async function retrySelectedRun() {
    if (!selectedRunId || !host.retryRun) {
      toast("Retry is not available here", { duration: 2200 });
      return;
    }
    try {
      const result = await host.retryRun({
        goalId: selectedGoal.id,
        runId: selectedRunId,
        permissionMode: selectedPermissionMode,
        engine: selectedModelSelection.engine,
        model: selectedModelSelection.model,
        effort: selectedModelSelection.effort,
      });
      if (result.run) {
        setRuns((current) =>
          current.map((run) => (run.id === result.run!.id ? result.run! : run)),
        );
      }
      await loadRuns(true);
      await loadTranscript(selectedRunId, true);
      toast(result.message, {
        duration: result.ok ? 2200 : 3600,
        description: result.error,
      });
    } catch (err) {
      toast("Could not retry the session", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    }
  }

  async function rerunSelectedRun() {
    if (!selectedRunId || !host.rerunRun) {
      toast("Re-run is not available here", { duration: 2200 });
      return;
    }
    try {
      const result = await host.rerunRun({
        goalId: selectedGoal.id,
        runId: selectedRunId,
        permissionMode: selectedPermissionMode,
        engine: selectedModelSelection.engine,
        model: selectedModelSelection.model,
        effort: selectedModelSelection.effort,
      });
      if (result.run) {
        setRuns((current) => [result.run!, ...current]);
        setSelectedRunId(result.run.id);
        setWorkbenchOpen(false);
        setSearchPanelOpen(false);
        setMobilePanelOpen(false);
        if (result.event) setTranscriptEvents([result.event]);
      }
      await loadRuns(true);
      if (result.run) await loadTranscript(result.run.id, true);
      toast(result.message, {
        duration: result.ok ? 2200 : 3600,
        description: result.error,
      });
    } catch (err) {
      toast("Could not re-run the session", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    }
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
      toast("Enter a coding task first", { duration: 1800 });
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
      toast("Could not start the session", {
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

    setUpdatingPermissionMode(true);
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
    } finally {
      setUpdatingPermissionMode(false);
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
      toast(pinned ? "Session unpinned" : "Session pinned", {
        duration: 1600,
      });
    } catch (err) {
      setRuns((current) =>
        current.map((item) => (item.id === run.id ? run : item)),
      );
      toast(pinned ? "Could not unpin session" : "Could not pin session", {
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
      toast("Session renamed", { duration: 1600 });
    } catch (err) {
      setRuns((current) =>
        current.map((item) => (item.id === run.id ? run : item)),
      );
      toast("Could not rename session", {
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
    <section className="code-agents-surface" aria-label="Agent-Native Code">
      <aside
        className="code-agents-rail"
        aria-label="Agent-Native Code goals and sessions"
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
            <h1>Code</h1>
          </div>
        </div>

        <div className="code-agents-nav-list" aria-label="Code navigation">
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
        </div>

        <div className="code-agents-run-list">
          <p className="code-agents-rail-label">Sessions</p>
          {loading ? (
            <RunListSkeleton />
          ) : runs.length === 0 ? (
            <div className="code-agents-empty-rail">
              <IconClock size={18} strokeWidth={1.7} />
              <p>No sessions yet.</p>
            </div>
          ) : (
            <GroupedRunList
              runs={runs}
              selectedRunId={selectedRunId}
              viewedRunIds={viewedRunIds}
              onSelect={(run) => {
                markRunsViewed([run.id]);
                setSelectedRunId(run.id);
                setSearchPanelOpen(false);
                setMobilePanelOpen(false);
              }}
              onOpen={(run) => {
                markRunsViewed([run.id]);
                setSelectedRunId(run.id);
                setWorkbenchOpen(true);
                setSearchPanelOpen(false);
                setMobilePanelOpen(false);
              }}
              onTogglePin={toggleRunPinned}
              onRename={renameRun}
            />
          )}
        </div>
      </aside>

      <main className="code-agents-main">
        {workbenchOpen ? (
          <div className="code-agents-workbench">
            <div className="code-agents-workbench__toolbar">
              <div>
                <p className="code-agents-kicker">Session</p>
                <h2>
                  {getRunTitle(selectedRun) ??
                    (selectedRunId
                      ? `Session ${selectedRunId}`
                      : selectedGoal.primaryActionLabel)}
                </h2>
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
                {status !== "ok" && (
                  <div
                    className={`code-agents-callout code-agents-callout--${status}`}
                  >
                    <IconAlertCircle size={17} strokeWidth={1.8} />
                    <span>
                      {status === "unauthorized"
                        ? `Open ${selectedGoal.surfaceLabel} and sign in to see sessions.`
                        : (error ??
                          `${selectedGoal.surfaceLabel} is not reporting sessions yet.`)}
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
                    updatingPermissionMode={updatingPermissionMode}
                    onPermissionModeChange={changeSelectedPermissionMode}
                    onModelSelectionChange={setModelSelection}
                    onOpenWorkbench={() => setWorkbenchOpen(true)}
                    onOpenTerminal={canOpenTerminal ? openTerminal : undefined}
                    onResume={() => controlRun("resume")}
                    onStop={() => controlRun("stop")}
                    onApprove={() => controlRun("approve")}
                    onApproveAlways={() => controlRun("approve-always")}
                    onDeny={() => controlRun("deny")}
                    onRetry={host.retryRun ? retrySelectedRun : undefined}
                    onRerun={host.rerunRun ? rerunSelectedRun : undefined}
                    builderConnecting={builderConnecting}
                    builderConnectMessage={builderConnectMessage}
                    onConnectBuilder={connectBuilderProvider}
                    onOpenSettings={onOpenSettings}
                    onConnectProvider={connectBuilderProvider}
                  />
                ) : (
                  <div className="code-agents-start">
                    <h2>What should we build?</h2>
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
                    <div className="code-agents-suggestions">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGoalId("task");
                          seedNewPrompt("Review the current changes");
                        }}
                      >
                        Review the current changes
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </section>
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
            aria-label="Select coding folder"
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
  const composerModelGroups = useMemo(
    () => modelOptionsToComposerGroups(modelOptions),
    [modelOptions],
  );
  const normalizedModel = normalizeModelSelection(modelSelection, modelOptions);
  const selectedModel = normalizedModel.model ?? "auto";
  const selectedEngine = normalizedModel.engine ?? "auto";
  const selectedEffort = normalizeReasoningEffort(
    normalizedModel.effort ?? "auto",
  );

  const handleModelChange = useCallback(
    (model: string, engine: string) => {
      if (engine === "auto" && model === "auto") {
        onModelSelectionChange({ effort: selectedEffort });
        return;
      }
      onModelSelectionChange({
        engine,
        model,
        effort: selectedEffort,
      });
    },
    [onModelSelectionChange, selectedEffort],
  );

  const handleEffortChange = useCallback(
    (effort: CodeAgentReasoningEffort) => {
      onModelSelectionChange({
        ...normalizedModel,
        effort: normalizeReasoningEffort(effort),
      });
    },
    [normalizedModel, onModelSelectionChange],
  );

  const readPromptFiles = useCallback(
    async (files: PromptComposerFile[]) =>
      Promise.all(files.map((file) => readAgentPromptAttachment(file))),
    [],
  );

  const modeControl = (
    <div className="code-agents-composer-mode-slot">
      <RunModeSelect
        value={permissionMode}
        onChange={onPermissionModeChange}
        compact
      />
    </div>
  );

  const stopButton =
    stopActive && onStop ? (
      <button
        type="button"
        onClick={onStop}
        className="code-agents-composer-stop-button"
        aria-label="Stop session"
        title="Stop session (Esc)"
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
      toolbarSlot={modeControl}
      actionButton={stopButton}
      availableModels={composerModelGroups}
      selectedModel={selectedModel}
      selectedEngine={selectedEngine}
      selectedEffort={selectedEffort}
      onModelChange={handleModelChange}
      onEffortChange={handleEffortChange}
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

function modelOptionsToComposerGroups(models: CodeAgentModelOption[]): Array<{
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
}> {
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
    const label = providerLabelForModel(option);
    const key = `${option.engine}:${label}`;
    const configured = option.configured !== false;
    const group = groups.get(key) ?? {
      engine: option.engine,
      label,
      models: [],
      configured,
    };
    if (!group.models.includes(option.model)) {
      group.models.push(option.model);
    }
    group.configured = group.configured || configured;
    groups.set(key, group);
  }

  return [...groups.values()];
}

function providerLabelForModel(option: CodeAgentModelOption): string {
  const model = option.model.toLowerCase();
  if (option.engine === "auto" || model === "auto") return option.engineLabel;
  if (model.startsWith("claude-")) return "Anthropic";
  if (model.startsWith("gpt-") || model.startsWith("o")) return "OpenAI";
  if (model.startsWith("gemini-")) return "Gemini";
  return option.engineLabel === "Builder.io" ? "More" : option.engineLabel;
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
        "Connect Builder.io to start with free credits, or add your own API key instead.",
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
      secondaryActionLabel="Settings"
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

function GroupedRunList({
  runs,
  selectedRunId,
  viewedRunIds,
  onSelect,
  onOpen,
  onTogglePin,
  onRename,
}: {
  runs: CodeAgentRun[];
  selectedRunId: string | null;
  viewedRunIds: Set<string>;
  onSelect: (run: CodeAgentRun) => void;
  onOpen: (run: CodeAgentRun) => void;
  onTogglePin: (run: CodeAgentRun) => void;
  onRename: (run: CodeAgentRun, newTitle: string) => void;
}) {
  const sortedRuns = sortRunsForRail(runs);
  return (
    <div className="code-agents-run-group code-agents-run-group--flat">
      {sortedRuns.map((run) => (
        <RunRailItem
          key={run.id}
          run={run}
          selected={run.id === selectedRunId}
          unread={!viewedRunIds.has(run.id) && !isRunActive(run)}
          onSelect={() => onSelect(run)}
          onOpen={() => onOpen(run)}
          onTogglePin={() => onTogglePin(run)}
          onRename={(newTitle) => onRename(run, newTitle)}
        />
      ))}
    </div>
  );
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
          matchType: transcriptMatch ? "Transcript" : "Session",
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

function getSessionMeta(run: CodeAgentRun, sourceLabel: string | null): string {
  return [sourceLabel, getRunStatusText(run), formatRelativeTime(run.updatedAt)]
    .filter(Boolean)
    .join(" · ");
}

function runControlButtons({
  goal,
  onRetry,
  onRerun,
  onOpenWorkbench,
  onOpenTerminal,
}: {
  goal: CodeAgentGoalDefinition;
  onRetry?: () => void;
  onRerun?: () => void;
  onOpenWorkbench: () => void;
  onOpenTerminal?: () => void;
}): Array<{
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}> {
  return [
    ...(onRetry
      ? [
          {
            key: "retry",
            label: "Retry",
            icon: <IconRefresh size={14} strokeWidth={1.8} />,
            onClick: onRetry,
          },
        ]
      : []),
    ...(onRerun
      ? [
          {
            key: "rerun",
            label: "Re-run",
            icon: <IconRoute size={14} strokeWidth={1.8} />,
            onClick: onRerun,
          },
        ]
      : []),
    {
      key: "workbench",
      label: `Open ${goal.surfaceLabel}`,
      icon: <IconExternalLink size={14} strokeWidth={1.8} />,
      onClick: onOpenWorkbench,
    },
    ...(onOpenTerminal
      ? [
          {
            key: "terminal",
            label: "Terminal",
            icon: <IconTerminal2 size={14} strokeWidth={1.8} />,
            onClick: onOpenTerminal,
          },
        ]
      : []),
  ];
}

function renderControlButton(button: {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      key={button.key}
      type="button"
      className="code-agents-button"
      onClick={button.onClick}
    >
      {button.icon}
      {button.label}
    </button>
  );
}

function RunRailItem({
  run,
  selected,
  unread,
  onSelect,
  onOpen,
  onTogglePin,
  onRename,
}: {
  run: CodeAgentRun;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
  onRename: (newTitle: string) => void;
}) {
  const pinned = isRunPinned(run);
  const active = isRunActive(run);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  function startRename() {
    setRenameValue(getRunTitle(run) ?? "");
    setRenaming(true);
    window.requestAnimationFrame(() => {
      renameInputRef.current?.select();
    });
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed && trimmed !== getRunTitle(run)) {
      onRename(trimmed);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(false);
    }
  }

  return (
    <div
      className={`code-agents-run-row${
        selected ? " code-agents-run-row--active" : ""
      }${pinned ? " code-agents-run-row--pinned" : ""}${
        renaming ? " code-agents-run-row--renaming" : ""
      }`}
    >
      {renaming ? (
        <div className="code-agents-run code-agents-run--rename">
          <input
            ref={renameInputRef}
            className="code-agents-run__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            autoFocus
            aria-label="Rename session"
          />
        </div>
      ) : (
        <button
          type="button"
          className="code-agents-run"
          onClick={onSelect}
          onDoubleClick={onOpen}
          title={getRunTitle(run) ?? undefined}
        >
          <div className="code-agents-run__topline">
            <span className="code-agents-run__name">{getRunTitle(run)}</span>
            <span className="code-agents-run__time">
              {active ? (
                <span
                  className="code-agents-run-status-spinner"
                  aria-label="Running"
                  title="Running"
                />
              ) : unread ? (
                <span
                  className="code-agents-run-status-dot"
                  aria-label="Done — unread"
                  title="Done"
                />
              ) : (
                formatRelativeTime(run.updatedAt)
              )}
            </span>
          </div>
        </button>
      )}
      {!renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`code-agents-run-menu${
                pinned ? " code-agents-run-menu--pinned" : ""
              }`}
              aria-label="Session options"
              title="Session options"
            >
              {pinned ? (
                <IconPinned size={13} strokeWidth={1.8} />
              ) : (
                <IconDots size={14} strokeWidth={1.8} />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="right" sideOffset={8}>
            <DropdownMenuItem onSelect={startRename}>
              <IconPencil size={14} strokeWidth={1.8} />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTogglePin}>
              {pinned ? (
                <IconPinnedOff size={14} strokeWidth={1.8} />
              ) : (
                <IconPinned size={14} strokeWidth={1.8} />
              )}
              <span>{pinned ? "Unpin from top" : "Pin to top"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
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
        ) : results.length === 0 ? (
          <div className="code-agents-detail code-agents-detail--empty">
            <IconSearch size={30} strokeWidth={1.5} />
            <h3>{hasQuery ? "No chats found" : "No chats yet"}</h3>
            <p>
              {hasQuery
                ? "Try a title, folder, command, or phrase from the conversation."
                : "Start a chat and it will show up here."}
            </p>
          </div>
        ) : (
          results.map((result) => (
            <button
              key={result.run.id}
              type="button"
              className="code-agents-search-result"
              onClick={() => onSelectRun(result.run)}
            >
              <div className="code-agents-search-result__topline">
                <span>{getRunTitle(result.run)}</span>
                <em>{formatRelativeTime(result.run.updatedAt)}</em>
              </div>
              <div className="code-agents-search-result__meta">
                <span>{result.matchType}</span>
                <span>{getSearchResultMeta(result.run)}</span>
              </div>
              <p>{result.match}</p>
            </button>
          ))
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
          Scan the QR code to open Sessions on your phone, then pair this Mac to
          start and continue local Code work from mobile.
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
              title="Open Agent Native mobile Sessions"
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
  updatingPermissionMode,
  onPermissionModeChange,
  onModelSelectionChange,
  onOpenWorkbench,
  onOpenTerminal,
  onResume,
  onStop,
  onApprove,
  onApproveAlways,
  onDeny,
  onRetry,
  onRerun,
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
  updatingPermissionMode: boolean;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onOpenWorkbench: () => void;
  onOpenTerminal?: () => void;
  onResume: () => void;
  onStop: () => void;
  onApprove: () => void;
  onApproveAlways: () => void;
  onDeny: () => void;
  onRetry?: () => void;
  onRerun?: () => void;
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
        <h3>{selectedRunId ? "Session link ready" : "No session selected"}</h3>
        <p>
          {selectedRunId
            ? `Open ${goal.surfaceLabel} to load the linked slash-command session.`
            : `Start ${goal.slashCommand} or select a session to review transcript events, artifacts, and follow-ups.`}
        </p>
        <button
          type="button"
          className="code-agents-button code-agents-button--primary"
          onClick={onOpenWorkbench}
        >
          <IconExternalLink size={14} strokeWidth={1.8} />
          Open {goal.surfaceLabel}
        </button>
      </div>
    );
  }

  const progress = getRunProgressPercent(run);
  const details = getRunDetails(run, goal);
  const sourceLabel = getRunSourceLabel(run);
  const hasCredentialGap = hasMissingCredentialSignal(run, transcriptEvents);
  const pendingApproval = hasCredentialGap ? null : getPendingApproval(run);
  const controlButtons = runControlButtons({
    goal,
    onRetry,
    onRerun,
    onOpenWorkbench,
    onOpenTerminal,
  });

  return (
    <div className="code-agents-detail code-agents-detail--chat">
      <div className="code-agents-chat-header">
        <div>
          <h3>{getRunTitle(run)}</h3>
          <p>{getSessionMeta(run, sourceLabel)}</p>
        </div>
        <details className="code-agents-session-details">
          <summary>
            <IconDots size={15} strokeWidth={1.8} />
            <span>Details</span>
          </summary>
          <div className="code-agents-session-details__body">
            <div className="code-agents-session-details__header">
              <span>{getRunStatusText(run)}</span>
            </div>

            <div className="code-agents-progress">
              <div className="code-agents-progress__label">
                <span>{run.progress?.label ?? "Progress"}</span>
                <span>{progress}%</span>
              </div>
              <div className="code-agents-progress__track">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="code-agents-detail-grid">
              {details.map((detail) => (
                <Field
                  key={detail.label}
                  label={detail.label}
                  value={detail.value}
                />
              ))}
            </div>

            <RunModeSelect
              value={permissionMode}
              onChange={onPermissionModeChange}
              disabled={updatingPermissionMode}
              title="Mode"
            />

            <div className="code-agents-detail__footer">
              {controlButtons.map(renderControlButton)}
            </div>
          </div>
        </details>
      </div>

      {hasCredentialGap && (
        <CodeProviderNotice
          className="code-agents-credential-callout"
          title="Provider needed"
          description={
            builderConnectMessage ??
            "Connect Builder.io for free credits, or add your own API key."
          }
          primaryActionLabel={
            builderConnecting ? "Waiting..." : "Connect Builder.io"
          }
          primaryDisabled={builderConnecting}
          onPrimaryAction={onConnectBuilder}
          secondaryActionLabel="Settings"
          onOpenSettings={onOpenSettings}
        />
      )}

      {pendingApproval && (
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

      {!pendingApproval &&
        (run.status === "paused" || run.phase === "paused") && (
          <div className="code-agents-approval-callout">
            <IconPlayerPlay size={16} strokeWidth={1.8} />
            <div>
              <strong>Session paused</strong>
              <span>Resume when you are ready for Code to continue.</span>
            </div>
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              onClick={onResume}
            >
              <IconPlayerPlay size={14} strokeWidth={1.8} />
              Resume
            </button>
          </div>
        )}

      <TokenUsageMeter run={run} />

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
        hideCredentialMessages={hasCredentialGap}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelectionChange={onModelSelectionChange}
        onStop={onStop}
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
  onConnectProvider?: () => void;
}) {
  const normalizedModel = normalizeModelSelection(modelSelection, modelOptions);
  const selectedModel = normalizedModel.model ?? "auto";
  const selectedEngine = normalizedModel.engine ?? "auto";
  const selectedEffort = normalizeReasoningEffort(
    normalizedModel.effort ?? "auto",
  );
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
    () => createHostCodeAgentChatController(host, goal.id),
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
  const loadHistoryRepository = useCallback(
    async () =>
      buildRepositoryFromCodeAgentTranscript(eventsRef.current, {
        hideCredentialMessages: hideCredentialMessagesRef.current,
      }),
    [],
  );
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
  const composerGroups = useMemo(
    () => modelOptionsToComposerGroups(modelOptions),
    [modelOptions],
  );

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
          composerAreaClassName="code-agents-standard-composer"
          composerToolbarSlot={
            <CodeAgentChatComposerSlot
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
            />
          }
          composerExtraActionButton={
            runIsActive ? <CodeAgentStopButton onStop={onStop} /> : undefined
          }
          selectedModel={selectedModel}
          selectedEngine={selectedEngine}
          selectedEffort={selectedEffort}
          availableModels={composerGroups}
          onModelChange={(model, engine) => {
            if (engine === "auto" && model === "auto") {
              onModelSelectionChange({ effort: selectedEffort });
              return;
            }
            onModelSelectionChange({ engine, model, effort: selectedEffort });
          }}
          onEffortChange={(effort) => {
            onModelSelectionChange({
              ...normalizedModel,
              effort: normalizeReasoningEffort(effort),
            });
          }}
          onConnectProvider={onConnectProvider}
        />
      )}
    </div>
  );
}

// --------------- Token / context meter ---------------

/**
 * Context window size (in tokens) keyed by model-name substring.
 * Used to compute approximate context-used % when the model is known.
 * This is a local approximation; a more precise table can replace it later.
 */
const MODEL_CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/claude-3-7|claude-sonnet-4|claude-opus-4/i, 200_000],
  [/claude-3-5|claude-3-opus|claude-3-haiku/i, 200_000],
  [/claude-2|claude-instant/i, 100_000],
  [/gpt-4o|gpt-4-turbo|gpt-4\.1/i, 128_000],
  [/gpt-4/i, 8_192],
  [/gpt-3\.5/i, 16_385],
  [/gemini-1\.5|gemini-2/i, 1_000_000],
  [/gemini-pro/i, 32_760],
];

function contextWindowForModel(model: string | undefined): number | null {
  if (!model) return null;
  for (const [pattern, size] of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(model)) return size;
  }
  return null;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function TokenUsageMeter({ run }: { run: CodeAgentRun }) {
  const usage = run.metadata?.tokenUsage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const u = usage as Record<string, unknown>;
  const input = typeof u.inputTokens === "number" ? u.inputTokens : 0;
  const output = typeof u.outputTokens === "number" ? u.outputTokens : 0;
  if (input + output === 0) return null;

  const model =
    typeof run.metadata?.model === "string" ? run.metadata.model : undefined;
  const contextWindow = contextWindowForModel(model);
  const contextPct =
    contextWindow && input > 0
      ? Math.min(100, Math.round((input / contextWindow) * 100))
      : null;

  return (
    <div className="code-agents-token-meter">
      <IconBrain
        size={12}
        strokeWidth={1.8}
        className="code-agents-token-meter__icon"
      />
      <span className="code-agents-token-meter__label">
        {formatTokenCount(input + output)} tokens
      </span>
      {contextPct !== null && (
        <span
          className="code-agents-token-meter__ctx"
          title={`~${contextPct}% of ${formatTokenCount(contextWindow!)} context window used`}
        >
          {contextPct}% ctx
        </span>
      )}
      <span className="code-agents-token-meter__detail">
        {formatTokenCount(input)} in / {formatTokenCount(output)} out
      </span>
    </div>
  );
}

function CodeAgentChatComposerSlot({
  permissionMode,
  onPermissionModeChange,
}: {
  permissionMode: CodeAgentPermissionMode;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
}) {
  return (
    <div className="code-agents-chat-composer-slot">
      <RunModeSelect
        value={permissionMode}
        onChange={onPermissionModeChange}
        compact
      />
    </div>
  );
}

function CodeAgentStopButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      className="code-agents-composer-stop-button"
      aria-label="Stop session"
      title="Stop session (Esc)"
    >
      <IconPlayerStop size={14} strokeWidth={1.9} />
    </button>
  );
}

function createHostCodeAgentChatController(
  host: CodeAgentsHost,
  goalId: string,
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
      const result = await host.controlRun(goalId, input.runId, "stop");
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="code-agents-field">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
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

function getRunProgressPercent(run: CodeAgentRun): number {
  if (typeof run.progress?.percent === "number") {
    return Math.max(0, Math.min(100, Math.round(run.progress.percent)));
  }
  if (isMigrationRun(run) && run.taskCount > 0) {
    return Math.round((run.passedTaskCount / run.taskCount) * 100);
  }
  return run.status === "completed" || run.phase === "complete" ? 100 : 0;
}

function hasMissingCredentialSignal(
  run: CodeAgentRun,
  transcriptEvents: CodeAgentTranscriptEvent[],
): boolean {
  if (run.phase === "missing-credentials") return true;
  return transcriptEvents.some((event) =>
    /No LLM provider key was found|Missing credentials/i.test(event.text),
  );
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
  return run.goalId ? `${run.goalId} session` : "Agent-Native Code session";
}

function getRunDetails(
  run: CodeAgentRun,
  goal: CodeAgentGoalDefinition,
): CodeAgentRunDetail[] {
  const sourceDetail = getRunSourceDetail(run);
  const details =
    run.details?.filter(
      (detail) => detail.value.length > 0 && !isPermissionDetail(detail.label),
    ) ?? [];
  if (details.length > 0) {
    return [
      ...(sourceDetail ? [sourceDetail] : []),
      ...details,
      { label: "Updated", value: formatRelativeTime(run.updatedAt) },
    ];
  }
  if (isMigrationRun(run)) {
    return [
      ...(sourceDetail ? [sourceDetail] : []),
      { label: "Source", value: run.sourceRoot },
      { label: "Output", value: run.outputRoot },
      { label: "Target", value: run.target },
      { label: "Updated", value: formatRelativeTime(run.updatedAt) },
    ];
  }
  return [
    ...(sourceDetail ? [sourceDetail] : []),
    { label: "Goal", value: goal.slashCommand },
    { label: "Status", value: run.status },
    { label: "Updated", value: formatRelativeTime(run.updatedAt) },
  ];
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
  if (normalized === "local" || normalized === "code") return "Local Code";
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
