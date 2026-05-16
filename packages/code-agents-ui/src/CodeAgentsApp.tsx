import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconClock,
  IconCode,
  IconDots,
  IconExternalLink,
  IconFolder,
  IconFolderPlus,
  IconListCheck,
  IconPinned,
  IconPinnedOff,
  IconPlus,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconTerminal2,
} from "@tabler/icons-react";
import {
  PromptComposer,
  type PromptComposerFile,
  type SlashCommand,
  type TiptapComposerHandle,
} from "@agent-native/core/client";
import { toast } from "sonner";
import { readCodeAgentPromptAttachment } from "./composer-primitives.js";
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
  CodeAgentPromptAttachment,
  CodeAgentProjectFolder,
  CodeAgentProjectListResult,
  CodeAgentProjectSelectResult,
  CodeAgentReasoningEffort,
  CodeAgentRemoteConnectorControlResult,
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
  CodeAgentTranscriptEventType,
  CodeAgentTranscriptRequest,
  CodeAgentTranscriptResult,
  CodeAgentUpdateRunRequest,
  CodeAgentUpdateRunResult,
  CodeAgentsOpenRequest,
} from "./types.js";

export interface CodeAgentsHost {
  listRuns(goalId?: string): Promise<CodeAgentRunListResult>;
  listModels?(): Promise<CodeAgentModelListResult>;
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
  onOpenSettings?: () => void;
  renderAppSurface?: CodeAgentsRenderAppSurface;
}

type RunListStatus = CodeAgentRunListResult["status"];
type CodeAgentRunMode = "plan" | "auto";

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
  {
    engine: "builder",
    engineLabel: "Builder.io",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced default through Builder.io",
  },
  {
    engine: "builder",
    engineLabel: "Builder.io",
    model: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    description: "Deeper reasoning for larger changes",
  },
  {
    engine: "ai-sdk:openai",
    engineLabel: "OpenAI",
    model: "gpt-5.5",
    label: "GPT-5.5",
    description: "OpenAI reasoning model",
  },
  {
    engine: "ai-sdk:google",
    engineLabel: "Gemini",
    model: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    description: "Gemini reasoning model",
  },
];

const CODE_AGENT_MODEL_SELECTION_KEY = "agent-native-code:model-selection";
const CODE_AGENT_PINNED_AT_METADATA_KEY = "pinnedAt";

export default function CodeAgentsApp({
  apps,
  host,
  openRequest,
  refreshKey = 0,
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
  const [refreshing, setRefreshing] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newPromptSeed, setNewPromptSeed] = useState(0);
  const [creatingRun, setCreatingRun] = useState(false);
  const [transcriptEvents, setTranscriptEvents] = useState<
    CodeAgentTranscriptEvent[]
  >([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);
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
  const [followUpMode, setFollowUpMode] =
    useState<CodeAgentFollowUpMode>("immediate");
  const [remoteConnectorStatus, setRemoteConnectorStatus] =
    useState<CodeAgentRemoteConnectorStatus | null>(null);
  const [remoteConnectorError, setRemoteConnectorError] = useState<
    string | null
  >(null);
  const selectedModelSelection = useMemo(
    () => normalizeModelSelection(modelSelection, modelOptions),
    [modelOptions, modelSelection],
  );
  const newPromptRef = useRef<TiptapComposerHandle | null>(null);

  const seedNewPrompt = useCallback((value: string) => {
    setNewPrompt(value);
    setNewPromptSeed((seed) => seed + 1);
    window.requestAnimationFrame(() => {
      newPromptRef.current?.focus();
    });
  }, []);

  const loadRuns = useCallback(
    async (busy = false) => {
      if (busy) setRefreshing(true);
      try {
        const result = await host.listRuns(selectedGoal.id);
        setStatus(result.status);
        setError(result.error ?? null);
        setRuns(result.runs);
      } catch (err) {
        setStatus("unavailable");
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [host, selectedGoal.id],
  );

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
        const fallbackRoot = codePack?.root;
        setProjects(
          fallbackRoot
            ? [
                {
                  id: fallbackRoot,
                  name: baseNameForPath(fallbackRoot),
                  path: fallbackRoot,
                },
              ]
            : [],
        );
        if (fallbackRoot) {
          setSelectedProjectPath((current) => current || fallbackRoot);
        }
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
  }, [codePack?.root, host]);

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

  useEffect(() => {
    setSelectedPermissionMode(selectedRunStoredPermissionMode);
  }, [selectedRunId, selectedRunStoredPermissionMode]);

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
  }, [host, modelSelection.model]);

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
    const interval = window.setInterval(
      () => void loadTranscript(selectedRunId),
      selectedRunIsActive ? 1_000 : 5_000,
    );
    return () => window.clearInterval(interval);
  }, [loadTranscript, selectedRunId, selectedRunIsActive]);

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
    seedNewPrompt(
      matchingSkill
        ? `Use the ${matchingSkill.name} skill to `
        : `/${normalized} `,
    );
  }

  async function openTerminal() {
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

  function openSelectedGoal() {
    setWorkbenchOpen(false);
    window.requestAnimationFrame(() => {
      newPromptRef.current?.focus();
    });
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
      if (result.event) setTranscriptEvents([result.event]);
      toast(result.message, { duration: 2200 });
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

  async function submitFollowUp(
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
    deliveryMode: CodeAgentFollowUpMode = "immediate",
  ) {
    if (!selectedRun) {
      toast("Select a session first", { duration: 1800 });
      return;
    }
    const prompt = preparedPrompt.trim();
    if (!prompt) {
      toast("Enter a follow-up prompt", { duration: 1800 });
      return;
    }
    const optimisticEvent: CodeAgentTranscriptEvent = {
      id: `pending-${Date.now()}`,
      runId: selectedRun.id,
      type: "user",
      title: "User prompt",
      text: prompt,
      createdAt: new Date().toISOString(),
      metadata: {
        source: "desktop",
        queued: true,
        pending: true,
        followUpMode: selectedRunIsActive ? deliveryMode : "immediate",
      },
    };
    setFollowUpPrompt("");
    setTranscriptEvents((current) => [...current, optimisticEvent]);
    setSubmittingFollowUp(true);
    try {
      const result = await host.appendFollowUp({
        goalId: selectedGoal.id,
        runId: selectedRun.id,
        prompt,
        followUpMode: selectedRunIsActive ? deliveryMode : "immediate",
        permissionMode: selectedPermissionMode,
        engine: selectedModelSelection.engine,
        model: selectedModelSelection.model,
        effort: selectedModelSelection.effort,
        attachments,
      });
      if (!result.ok) {
        setTranscriptEvents((current) =>
          current.filter((item) => item.id !== optimisticEvent.id),
        );
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      toast(result.message, { duration: 1800 });
      await loadRuns(true);
      await loadTranscript(selectedRun.id, true);
    } catch (err) {
      setTranscriptEvents((current) =>
        current.filter((item) => item.id !== optimisticEvent.id),
      );
      toast("Could not record the follow-up", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    } finally {
      setSubmittingFollowUp(false);
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

  return (
    <section className="code-agents-surface" aria-label="Agent-Native Code">
      <aside
        className="code-agents-rail"
        aria-label="Agent-Native Code goals and sessions"
      >
        <div className="code-agents-rail__header">
          <div className="code-agents-title-block">
            <h1>Agent-Native Code</h1>
            <p>{runs.length} sessions</p>
          </div>
          <button
            type="button"
            className="code-agents-icon-button"
            onClick={() => loadRuns(true)}
            title="Refresh sessions"
            aria-label="Refresh sessions"
          >
            <IconRefresh
              size={15}
              strokeWidth={1.8}
              className={refreshing ? "code-agents-spin" : undefined}
            />
          </button>
        </div>

        {host.getRemoteConnectorStatus && (
          <RemoteConnectorRailStatus
            status={remoteConnectorStatus}
            error={remoteConnectorError}
            onOpenSettings={onOpenSettings}
          />
        )}

        <button
          type="button"
          className="code-agents-new-session-link"
          onClick={openSelectedGoal}
        >
          <IconPlus size={15} strokeWidth={1.8} />
          New session
        </button>

        <div className="code-agents-goal-list" aria-label="Code commands">
          <p className="code-agents-rail-label">Commands</p>
          {CODE_AGENT_GOALS.map((goal) => (
            <button
              key={goal.id}
              type="button"
              className={`code-agents-goal${
                goal.id === selectedGoal.id ? " code-agents-goal--active" : ""
              }`}
              onClick={() => {
                setSelectedGoalId(goal.id);
                setSelectedRunId(null);
                setWorkbenchOpen(false);
              }}
            >
              <strong>{goal.label}</strong>
              <span>{goal.id === "task" ? "Prompt" : goal.slashCommand}</span>
            </button>
          ))}
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
              onSelect={(run) => setSelectedRunId(run.id)}
              onOpen={(run) => {
                setSelectedRunId(run.id);
                setWorkbenchOpen(true);
              }}
              onTogglePin={toggleRunPinned}
            />
          )}
        </div>
      </aside>

      <main className="code-agents-main">
        {workbenchOpen ? (
          <div className="code-agents-workbench">
            <div className="code-agents-workbench__toolbar">
              <div>
                <p className="code-agents-kicker">
                  {selectedGoal.surfaceKind === "app"
                    ? "App-backed detail surface"
                    : "Native feedback surface"}
                </p>
                <h2>
                  {getRunTitle(selectedRun) ??
                    (selectedRunId
                      ? `Session ${selectedRunId}`
                      : selectedGoal.primaryActionLabel)}
                </h2>
              </div>
              <div className="code-agents-toolbar-actions">
                <button
                  type="button"
                  className="code-agents-button"
                  onClick={openTerminal}
                >
                  <IconTerminal2 size={14} strokeWidth={1.8} />
                  Open Terminal
                </button>
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
                  onOpenTerminal={openTerminal}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="code-agents-overview">
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
                run={selectedRun}
                selectedRunId={selectedRunId}
                goal={selectedGoal}
                transcriptEvents={transcriptEvents}
                transcriptLoading={transcriptLoading}
                transcriptError={transcriptError}
                followUpPrompt={followUpPrompt}
                followUpMode={followUpMode}
                submittingFollowUp={submittingFollowUp}
                permissionMode={selectedPermissionMode}
                modelSelection={selectedModelSelection}
                modelOptions={modelOptions}
                updatingPermissionMode={updatingPermissionMode}
                onFollowUpPromptChange={setFollowUpPrompt}
                onFollowUpModeChange={setFollowUpMode}
                onPermissionModeChange={changeSelectedPermissionMode}
                onModelSelectionChange={setModelSelection}
                onSubmitFollowUp={submitFollowUp}
                onOpenWorkbench={() => setWorkbenchOpen(true)}
                onOpenTerminal={openTerminal}
                onResume={() => controlRun("resume")}
                onRefreshStatus={() => controlRun("status")}
                onStop={() => controlRun("stop")}
                onApprove={() => controlRun("approve")}
                onRetry={host.retryRun ? retrySelectedRun : undefined}
                onRerun={host.rerunRun ? rerunSelectedRun : undefined}
                onOpenSettings={onOpenSettings}
              />
            ) : (
              <div className="code-agents-start">
                <h2>
                  {selectedProjectPath
                    ? `What should we build in ${baseNameForPath(selectedProjectPath)}?`
                    : "What should we work on?"}
                </h2>
                <NewSessionComposer
                  prompt={newPrompt}
                  promptSeed={newPromptSeed}
                  inputRef={newPromptRef}
                  creating={creatingRun}
                  permissionMode={newRunPermissionMode}
                  modelSelection={selectedModelSelection}
                  modelOptions={modelOptions}
                  slashCommands={slashCommands}
                  onPromptChange={setNewPrompt}
                  onPermissionModeChange={setNewRunPermissionMode}
                  onModelSelectionChange={setModelSelection}
                  onSlashCommand={handleSlashCommand}
                  onSubmit={createRunFromPrompt}
                />
                <ProjectFolderPicker
                  variant="bar"
                  projects={projects}
                  selectedPath={selectedProjectPath}
                  loading={loadingProjects}
                  onSelect={selectProjectFolder}
                  onChoose={chooseProjectFolder}
                />
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
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGoalId("migrate");
                      seedNewPrompt("/migrate ");
                    }}
                  >
                    Migrate an existing app
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGoalId("audit");
                      seedNewPrompt("/audit ");
                    }}
                  >
                    Audit a web app
                  </button>
                </div>
              </div>
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
  onSelect,
  onChoose,
}: {
  variant?: "rail" | "bar";
  projects: CodeAgentProjectFolder[];
  selectedPath: string;
  loading: boolean;
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
          value={selectedPath || undefined}
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
              <SelectItem value="__choose__">
                <span className="code-agents-project-select__item">
                  <IconFolderPlus size={14} strokeWidth={1.8} />
                  <span>Add folder...</span>
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <button
          type="button"
          className="code-agents-icon-button"
          onClick={onChoose}
          title="Add folder"
          aria-label="Add folder"
        >
          <IconFolderPlus size={15} strokeWidth={1.8} />
        </button>
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
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSlashCommand,
  onSubmit,
}: {
  prompt: string;
  promptSeed: number;
  inputRef: React.RefObject<TiptapComposerHandle | null>;
  creating: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  slashCommands: SlashCommand[];
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSlashCommand: (command: string) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) => void;
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
      onPromptChange={onPromptChange}
      onPermissionModeChange={onPermissionModeChange}
      onModelSelectionChange={onModelSelectionChange}
      onSlashCommand={onSlashCommand}
      onSubmit={onSubmit}
    />
  );
}

function CodeAgentComposer({
  prompt,
  promptSeed,
  inputRef,
  submitting,
  permissionMode,
  followUpMode = "immediate",
  showFollowUpMode = false,
  modelSelection,
  modelOptions,
  slashCommands = [],
  placeholder,
  variant = "compact",
  onPromptChange,
  onPermissionModeChange,
  onFollowUpModeChange,
  onModelSelectionChange,
  onSlashCommand,
  onSubmit,
}: {
  prompt: string;
  promptSeed?: string | number;
  inputRef?: React.RefObject<TiptapComposerHandle | null>;
  submitting: boolean;
  permissionMode: CodeAgentPermissionMode;
  followUpMode?: CodeAgentFollowUpMode;
  showFollowUpMode?: boolean;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  slashCommands?: SlashCommand[];
  placeholder: string;
  variant?: "hero" | "compact";
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onFollowUpModeChange?: (value: CodeAgentFollowUpMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSlashCommand?: (command: string) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
    followUpMode?: CodeAgentFollowUpMode,
  ) => void;
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
      Promise.all(files.map((file) => readCodeAgentPromptAttachment(file))),
    [],
  );

  const modeControl = (
    <div className="code-agents-composer-mode-slot">
      <RunModeSelect
        value={permissionMode}
        onChange={onPermissionModeChange}
        compact
      />
      {showFollowUpMode && onFollowUpModeChange && (
        <FollowUpModeSelect
          value={followUpMode}
          onChange={onFollowUpModeChange}
        />
      )}
    </div>
  );

  return (
    <PromptComposer
      className="code-agents-standard-composer code-agents-composer-shell"
      layoutVariant={variant}
      composerRef={inputRef}
      disabled={submitting}
      placeholder={placeholder}
      draftScope={
        variant === "hero"
          ? "agent-native-code:new-session"
          : "agent-native-code:follow-up"
      }
      initialText={promptSeed !== undefined ? prompt : undefined}
      initialTextKey={promptSeed}
      toolbarSlot={modeControl}
      availableModels={composerModelGroups}
      selectedModel={selectedModel}
      selectedEngine={selectedEngine}
      selectedEffort={selectedEffort}
      onModelChange={handleModelChange}
      onEffortChange={handleEffortChange}
      onTextChange={onPromptChange}
      slashCommands={slashCommands}
      includeDefaultSlashSkills={false}
      onSlashCommand={onSlashCommand}
      onSubmit={async (text, files) => {
        const attachments = await readPromptFiles(files);
        onSubmit(text, attachments, followUpMode);
      }}
      attachmentsEnabled
      voiceEnabled
      preserveDraftOnSubmit={false}
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
    const key = `${option.engine}:${option.engineLabel}`;
    const group = groups.get(key) ?? {
      engine: option.engine,
      label: option.engineLabel,
      models: [],
      configured: true,
    };
    if (!group.models.includes(option.model)) {
      group.models.push(option.model);
    }
    groups.set(key, group);
  }

  return [...groups.values()];
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

function baseNameForPath(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
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

function FollowUpModeSelect({
  value,
  onChange,
}: {
  value: CodeAgentFollowUpMode;
  onChange: (value: CodeAgentFollowUpMode) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) =>
        onChange(nextValue === "queued" ? "queued" : "immediate")
      }
    >
      <SelectTrigger
        className="code-agents-follow-up-mode-select"
        aria-label="Follow-up delivery"
        title="Choose how this follow-up reaches the active run"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem
            value="immediate"
            description="Send to the active run at its next safe steering point."
          >
            Send now
          </SelectItem>
          <SelectItem
            value="queued"
            description="Run after the current turn finishes."
          >
            Queue
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
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
  onOpenTerminal: () => void;
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
        <button
          type="button"
          className="code-agents-button code-agents-button--primary"
          onClick={onOpenTerminal}
        >
          <IconTerminal2 size={14} strokeWidth={1.8} />
          Open Terminal
        </button>
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
  return !(
    run.status === "completed" ||
    run.status === "errored" ||
    run.status === "paused" ||
    run.phase === "complete" ||
    run.phase === "error" ||
    run.phase === "paused" ||
    run.phase === "missing-credentials" ||
    run.phase === "stopped"
  );
}

function GroupedRunList({
  runs,
  selectedRunId,
  onSelect,
  onOpen,
  onTogglePin,
}: {
  runs: CodeAgentRun[];
  selectedRunId: string | null;
  onSelect: (run: CodeAgentRun) => void;
  onOpen: (run: CodeAgentRun) => void;
  onTogglePin: (run: CodeAgentRun) => void;
}) {
  const groups = groupRunsForRail(runs);
  return (
    <>
      {groups.map((group) => (
        <div className="code-agents-run-group" key={group.label}>
          <p className="code-agents-run-group__label">{group.label}</p>
          {group.runs.map((run) => (
            <RunRailItem
              key={run.id}
              run={run}
              selected={run.id === selectedRunId}
              onSelect={() => onSelect(run)}
              onOpen={() => onOpen(run)}
              onTogglePin={() => onTogglePin(run)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function groupRunsForRail(runs: CodeAgentRun[]): Array<{
  label: string;
  runs: CodeAgentRun[];
}> {
  const pinned = sortPinnedRuns(runs.filter(isRunPinned));
  const unpinned = runs.filter((run) => !isRunPinned(run));
  const needsInput = unpinned.filter(runNeedsInput);
  const running = unpinned.filter(
    (run) => !runNeedsInput(run) && isRunActive(run),
  );
  const recent = unpinned.filter(
    (run) => !runNeedsInput(run) && !isRunActive(run),
  );
  return [
    { label: "Pinned", runs: pinned },
    { label: "Needs input", runs: needsInput },
    { label: "Running", runs: running },
    { label: "Recent", runs: recent },
  ].filter((group) => group.runs.length > 0);
}

function runNeedsInput(run: CodeAgentRun): boolean {
  return Boolean(
    run.needsApproval ||
    run.status === "needs-approval" ||
    run.phase === "approval-required" ||
    run.phase === "missing-credentials",
  );
}

function RunRailItem({
  run,
  selected,
  onSelect,
  onOpen,
  onTogglePin,
}: {
  run: CodeAgentRun;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const progress = getRunProgressPercent(run);
  const progressLabel = getRunProgressLabel(run);
  const pinned = isRunPinned(run);
  return (
    <div
      className={`code-agents-run-row${
        selected ? " code-agents-run-row--active" : ""
      }${pinned ? " code-agents-run-row--pinned" : ""}`}
    >
      <button
        type="button"
        className="code-agents-run"
        onClick={onSelect}
        onDoubleClick={onOpen}
        title={getRunTitle(run) ?? undefined}
      >
        <div className="code-agents-run__topline">
          <span className="code-agents-run__name">{getRunTitle(run)}</span>
          <PhasePill run={run} />
        </div>
        <p className="code-agents-run__path">{getRunSubtitle(run)}</p>
        <div className="code-agents-run__meta">
          <span>{progressLabel}</span>
          <span>{progress}%</span>
          <span>{formatRelativeTime(run.updatedAt)}</span>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`code-agents-run-menu${
              pinned ? " code-agents-run-menu--pinned" : ""
            }`}
            aria-label={pinned ? "Unpin session" : "Pin session"}
            title={pinned ? "Unpin session" : "Pin session"}
          >
            {pinned ? (
              <IconPinned size={13} strokeWidth={1.8} />
            ) : (
              <IconDots size={14} strokeWidth={1.8} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="right" sideOffset={8}>
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
    </div>
  );
}

function RemoteConnectorRailStatus({
  status,
  error,
  onOpenSettings,
}: {
  status: CodeAgentRemoteConnectorStatus | null;
  error: string | null;
  onOpenSettings?: () => void;
}) {
  const copy = remoteConnectorCopy(status, error);
  return (
    <button
      type="button"
      className={`code-agents-remote-status code-agents-remote-status--${copy.tone}`}
      onClick={onOpenSettings}
      disabled={!onOpenSettings}
      title={copy.description}
    >
      <span
        className={`code-agents-remote-dot code-agents-remote-dot--${copy.tone}`}
      />
      <span>
        <strong>{copy.label}</strong>
        <em>{copy.description}</em>
      </span>
    </button>
  );
}

function remoteConnectorCopy(
  status: CodeAgentRemoteConnectorStatus | null,
  error: string | null,
): {
  label: string;
  description: string;
  tone: "ok" | "pending" | "offline" | "error";
} {
  if (error) {
    return { label: "Remote error", description: error, tone: "error" };
  }
  if (!status) {
    return {
      label: "Remote checking",
      description: "Reading connector state",
      tone: "pending",
    };
  }
  if (!status.configured) {
    return {
      label: "Remote offline",
      description: "Pair in settings",
      tone: "offline",
    };
  }
  if (!status.enabled) {
    return {
      label: "Remote off",
      description: "Paused on this computer",
      tone: "offline",
    };
  }
  if (status.state === "error") {
    return {
      label: "Remote error",
      description: status.error ?? "Connector needs attention",
      tone: "error",
    };
  }
  if (status.state === "running") {
    return {
      label: "Remote polling",
      description: `Connected to ${hostForDisplay(status.relayUrl)}`,
      tone: "ok",
    };
  }
  if (status.state === "starting") {
    return {
      label: "Remote connecting",
      description: "Retrying connector",
      tone: "pending",
    };
  }
  return {
    label: "Remote offline",
    description: "Connector is stopped",
    tone: "offline",
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

function RunDetailCard({
  run,
  selectedRunId,
  goal,
  transcriptEvents,
  transcriptLoading,
  transcriptError,
  followUpPrompt,
  followUpMode,
  submittingFollowUp,
  permissionMode,
  modelSelection,
  modelOptions,
  updatingPermissionMode,
  onFollowUpPromptChange,
  onFollowUpModeChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSubmitFollowUp,
  onOpenWorkbench,
  onOpenTerminal,
  onResume,
  onRefreshStatus,
  onStop,
  onApprove,
  onRetry,
  onRerun,
  onOpenSettings,
}: {
  run: CodeAgentRun | null;
  selectedRunId: string | null;
  goal: CodeAgentGoalDefinition;
  transcriptEvents: CodeAgentTranscriptEvent[];
  transcriptLoading: boolean;
  transcriptError: string | null;
  followUpPrompt: string;
  followUpMode: CodeAgentFollowUpMode;
  submittingFollowUp: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  updatingPermissionMode: boolean;
  onFollowUpPromptChange: (value: string) => void;
  onFollowUpModeChange: (value: CodeAgentFollowUpMode) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSubmitFollowUp: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
    followUpMode?: CodeAgentFollowUpMode,
  ) => void;
  onOpenWorkbench: () => void;
  onOpenTerminal: () => void;
  onResume: () => void;
  onRefreshStatus: () => void;
  onStop: () => void;
  onApprove: () => void;
  onRetry?: () => void;
  onRerun?: () => void;
  onOpenSettings?: () => void;
}) {
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
  const hasCredentialGap = hasMissingCredentialSignal(run, transcriptEvents);
  const pendingApproval = getPendingApproval(run);

  return (
    <div className="code-agents-detail">
      <div className="code-agents-detail__header">
        <div>
          <p className="code-agents-kicker">Selected session</p>
          <h3>{getRunTitle(run)}</h3>
        </div>
        <PhasePill run={run} />
      </div>

      {hasCredentialGap && (
        <div className="code-agents-credential-callout">
          <IconAlertCircle size={16} strokeWidth={1.8} />
          <div>
            <strong>Credentials needed</strong>
            <span>
              Connect a provider in settings, or run from a terminal with
              ANTHROPIC_API_KEY, OPENAI_API_KEY, or
              GOOGLE_GENERATIVE_AI_API_KEY.
            </span>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              className="code-agents-button"
              onClick={onOpenSettings}
            >
              Settings
            </button>
          )}
        </div>
      )}

      {pendingApproval && (
        <div className="code-agents-approval-callout">
          <IconAlertCircle size={16} strokeWidth={1.8} />
          <div>
            <strong>Approval pending</strong>
            <span>{pendingApproval.reason}</span>
            {pendingApproval.command && <code>{pendingApproval.command}</code>}
          </div>
          <button
            type="button"
            className="code-agents-button code-agents-button--primary"
            onClick={onApprove}
          >
            <IconPlayerPlay size={14} strokeWidth={1.8} />
            Approve
          </button>
        </div>
      )}

      <div className="code-agents-session-layout">
        <div className="code-agents-session-main">
          <TranscriptPanel
            events={transcriptEvents}
            loading={transcriptLoading}
            error={transcriptError}
            followUpPrompt={followUpPrompt}
            followUpMode={followUpMode}
            runIsActive={isRunActive(run)}
            submitting={submittingFollowUp}
            permissionMode={permissionMode}
            modelSelection={modelSelection}
            modelOptions={modelOptions}
            onFollowUpPromptChange={onFollowUpPromptChange}
            onFollowUpModeChange={onFollowUpModeChange}
            onPermissionModeChange={onPermissionModeChange}
            onModelSelectionChange={onModelSelectionChange}
            onSubmitFollowUp={onSubmitFollowUp}
          />
        </div>

        <aside className="code-agents-session-aside" aria-label="Session state">
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
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              onClick={onResume}
            >
              <IconPlayerPlay size={14} strokeWidth={1.8} />
              Resume
            </button>
            <button
              type="button"
              className="code-agents-button"
              onClick={onRefreshStatus}
            >
              <IconRefresh size={14} strokeWidth={1.8} />
              Status
            </button>
            {run.status !== "completed" && run.phase !== "complete" && (
              <button
                type="button"
                className="code-agents-button"
                onClick={onStop}
              >
                <IconAlertCircle size={14} strokeWidth={1.8} />
                Stop
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                className="code-agents-button"
                onClick={onRetry}
              >
                <IconRefresh size={14} strokeWidth={1.8} />
                Retry
              </button>
            )}
            {onRerun && (
              <button
                type="button"
                className="code-agents-button"
                onClick={onRerun}
              >
                <IconRoute size={14} strokeWidth={1.8} />
                Re-run
              </button>
            )}
            <button
              type="button"
              className="code-agents-button"
              onClick={onOpenWorkbench}
            >
              <IconExternalLink size={14} strokeWidth={1.8} />
              Open {goal.surfaceLabel}
            </button>
            <button
              type="button"
              className="code-agents-button"
              onClick={onOpenTerminal}
            >
              <IconTerminal2 size={14} strokeWidth={1.8} />
              Terminal
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TranscriptPanel({
  events,
  loading,
  error,
  followUpPrompt,
  followUpMode,
  runIsActive,
  submitting,
  permissionMode,
  modelSelection,
  modelOptions,
  onFollowUpPromptChange,
  onFollowUpModeChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSubmitFollowUp,
}: {
  events: CodeAgentTranscriptEvent[];
  loading: boolean;
  error: string | null;
  followUpPrompt: string;
  followUpMode: CodeAgentFollowUpMode;
  runIsActive: boolean;
  submitting: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  onFollowUpPromptChange: (value: string) => void;
  onFollowUpModeChange: (value: CodeAgentFollowUpMode) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSubmitFollowUp: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
    followUpMode?: CodeAgentFollowUpMode,
  ) => void;
}) {
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  return (
    <section className="code-agents-transcript" aria-label="Session transcript">
      <div className="code-agents-transcript__header">
        <div>
          <p className="code-agents-kicker">Transcript</p>
          <h4>Session events</h4>
        </div>
        {loading && (
          <span className="code-agents-transcript__loading">
            <IconRefresh
              size={13}
              strokeWidth={1.8}
              className="code-agents-spin"
            />
            Loading
          </span>
        )}
      </div>

      {error && (
        <div className="code-agents-transcript__error">
          <IconAlertCircle size={14} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}

      <div className="code-agents-transcript__timeline" ref={timelineRef}>
        {events.length === 0 ? (
          <div className="code-agents-transcript__empty">
            <IconClock size={18} strokeWidth={1.7} />
            <p>No transcript events recorded for this session yet.</p>
          </div>
        ) : (
          events.map((event) => (
            <TranscriptEventItem key={event.id} event={event} />
          ))
        )}
      </div>

      <CodeAgentComposer
        prompt={followUpPrompt}
        submitting={submitting}
        permissionMode={permissionMode}
        followUpMode={followUpMode}
        showFollowUpMode={runIsActive}
        modelSelection={modelSelection}
        modelOptions={modelOptions}
        placeholder="Ask for follow-up changes"
        onPromptChange={onFollowUpPromptChange}
        onFollowUpModeChange={onFollowUpModeChange}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelectionChange={onModelSelectionChange}
        onSubmit={onSubmitFollowUp}
      />
    </section>
  );
}

function TranscriptEventItem({ event }: { event: CodeAgentTranscriptEvent }) {
  const toolName = getTranscriptToolName(event);
  const toolInput = getMetadataPreview(event.metadata?.input);
  const toolResult = getMetadataPreview(event.metadata?.result);
  return (
    <article className={`code-agents-transcript-event`}>
      <div className={`code-agents-transcript-event__icon`}>
        <TranscriptEventIcon type={event.type} />
      </div>
      <div className="code-agents-transcript-event__body">
        <div className="code-agents-transcript-event__meta">
          <span>{event.title ?? transcriptEventLabel(event.type)}</span>
          <time dateTime={event.createdAt}>
            {formatRelativeTime(event.createdAt)}
          </time>
        </div>
        <p>{event.text}</p>
        {toolName && (
          <details className="code-agents-tool-event">
            <summary>
              <span>{toolName}</span>
              <span>{toolEventLabel(event)}</span>
            </summary>
            {(toolInput || toolResult) && (
              <div className="code-agents-tool-event__body">
                {toolInput && (
                  <pre>
                    <strong>input</strong>
                    {toolInput}
                  </pre>
                )}
                {toolResult && (
                  <pre>
                    <strong>result</strong>
                    {toolResult}
                  </pre>
                )}
              </div>
            )}
          </details>
        )}
        {(event.artifactPath || event.artifactUrl) && (
          <div className="code-agents-transcript-event__artifact">
            {event.artifactPath && <code>{event.artifactPath}</code>}
            {event.artifactUrl && (
              <a href={event.artifactUrl} target="_blank" rel="noreferrer">
                <IconExternalLink size={13} strokeWidth={1.8} />
                Open artifact
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function getTranscriptToolName(event: CodeAgentTranscriptEvent): string | null {
  const value = event.metadata?.tool;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toolEventLabel(event: CodeAgentTranscriptEvent): string {
  const value = event.metadata?.type;
  if (value === "tool_start") return "started";
  if (value === "tool_done") return "finished";
  if (value === "activity") return "activity";
  return "tool event";
}

function getMetadataPreview(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text =
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 1800 ? `${trimmed.slice(0, 1800)}\n...` : trimmed;
}

function TranscriptEventIcon({ type }: { type: CodeAgentTranscriptEventType }) {
  if (type === "user") return <IconRoute size={14} strokeWidth={1.8} />;
  if (type === "artifact") {
    return <IconExternalLink size={14} strokeWidth={1.8} />;
  }
  if (type === "status") return <IconListCheck size={14} strokeWidth={1.8} />;
  return <IconCode size={14} strokeWidth={1.8} />;
}

function transcriptEventLabel(type: CodeAgentTranscriptEventType): string {
  if (type === "user") return "User prompt";
  if (type === "artifact") return "Artifact";
  if (type === "status") return "Status";
  return "System";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="code-agents-field">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function PhasePill({ run }: { run: CodeAgentRun }) {
  const tone =
    run.status === "completed" || run.phase === "complete"
      ? "complete"
      : hasPendingApproval(run)
        ? "approval"
        : "active";
  return (
    <span className={`code-agents-phase code-agents-phase--${tone}`}>
      {run.phase ?? run.status}
    </span>
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

function getRunProgressLabel(run: CodeAgentRun): string {
  if (run.progress?.total && run.progress.total > 0) {
    const label = run.progress.label ?? "tasks";
    return `${run.progress.completed}/${run.progress.total} ${label.toLowerCase()}`;
  }
  if (isMigrationRun(run)) return `${run.taskCount} tasks`;
  return run.status;
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
  const permissionMode = getRunPermissionMode(run);
  const details =
    run.details?.filter((detail) => detail.value.length > 0) ?? [];
  if (details.length > 0) {
    return [
      ...withPermissionDetail(details, permissionMode),
      { label: "Updated", value: formatRelativeTime(run.updatedAt) },
    ];
  }
  if (isMigrationRun(run)) {
    return [
      { label: "Source", value: run.sourceRoot },
      { label: "Output", value: run.outputRoot },
      { label: "Target", value: run.target },
      { label: "Mode", value: formatPermissionMode(permissionMode) },
      { label: "Updated", value: formatRelativeTime(run.updatedAt) },
    ];
  }
  return [
    { label: "Goal", value: goal.slashCommand },
    { label: "Status", value: run.status },
    { label: "Mode", value: formatPermissionMode(permissionMode) },
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

function getStringMetadata(run: CodeAgentRun, key: string): string | undefined {
  const value = run.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "recently";

  const diffMs = time - Date.now();
  const abs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "recently";
}
