import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconArrowUp,
  IconClock,
  IconCode,
  IconExternalLink,
  IconCalendarTime,
  IconFileUpload,
  IconListCheck,
  IconMicrophone,
  IconPlus,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import type {
  CodeAgentControlCommand,
  CodeAgentControlResult,
  CodeAgentCreateRunRequest,
  CodeAgentCreateRunResult,
  CodeAgentFollowUpRequest,
  CodeAgentFollowUpResult,
  CodeAgentMigrationRun,
  CodeAgentModelListResult,
  CodeAgentModelOption,
  CodeAgentModelSelection,
  CodeAgentPromptAttachment,
  CodeAgentReasoningEffort,
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
  controlRun(
    goalId: string,
    runId: string,
    command: CodeAgentControlCommand,
    permissionMode?: CodeAgentPermissionMode,
  ): Promise<CodeAgentControlResult>;
  openTerminal?(
    request?: CodeAgentTerminalRequest,
  ): Promise<CodeAgentTerminalResult>;
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
    label: "Plan mode",
    description: "Read the workspace and propose a plan before editing.",
  },
  {
    id: "auto",
    label: "Auto mode",
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
const MAX_ATTACHMENT_TEXT_CHARS = 60_000;

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
  const [modelSelection, setModelSelection] = useState<CodeAgentModelSelection>(
    () => readStoredModelSelection(),
  );
  const selectedModelSelection = useMemo(
    () => normalizeModelSelection(modelSelection, modelOptions),
    [modelOptions, modelSelection],
  );
  const newPromptRef = useRef<HTMLTextAreaElement | null>(null);

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

  async function openTerminal() {
    const terminalRequest = selectedRun
      ? getRunTerminalRequest(selectedRun)
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

  async function createRunFromPrompt(
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) {
    const prompt = preparedPrompt.trim();
    if (!prompt) {
      toast("Enter a coding task first", { duration: 1800 });
      return;
    }
    setCreatingRun(true);
    try {
      const result = await host.createRun({
        goalId: selectedGoal.id,
        prompt,
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
      setRuns((current) => [result.run!, ...current]);
      setSelectedRunId(result.run.id);
      setWorkbenchOpen(false);
      if (result.event) setTranscriptEvents([result.event]);
      toast(result.message, { duration: 2200 });
      await loadRuns(true);
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
      metadata: { source: "desktop", queued: true, pending: true },
    };
    setFollowUpPrompt("");
    setTranscriptEvents((current) => [...current, optimisticEvent]);
    setSubmittingFollowUp(true);
    try {
      const result = await host.appendFollowUp({
        goalId: selectedGoal.id,
        runId: selectedRun.id,
        prompt,
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

  return (
    <section className="code-agents-surface" aria-label="Code">
      <aside
        className="code-agents-rail"
        aria-label="Agent-Native Code goals and sessions"
      >
        <div className="code-agents-rail__header">
          <div className="code-agents-title-block">
            <h1>Code</h1>
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
          <p className="code-agents-rail-label">Recents</p>
          {loading ? (
            <RunListSkeleton />
          ) : runs.length === 0 ? (
            <div className="code-agents-empty-rail">
              <IconClock size={18} strokeWidth={1.7} />
              <p>No sessions yet.</p>
            </div>
          ) : (
            runs.map((run) => (
              <RunRailItem
                key={run.id}
                run={run}
                selected={run.id === selectedRunId}
                onSelect={() => setSelectedRunId(run.id)}
                onOpen={() => {
                  setSelectedRunId(run.id);
                  setWorkbenchOpen(true);
                }}
              />
            ))
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
                submittingFollowUp={submittingFollowUp}
                permissionMode={selectedPermissionMode}
                modelSelection={selectedModelSelection}
                modelOptions={modelOptions}
                updatingPermissionMode={updatingPermissionMode}
                onFollowUpPromptChange={setFollowUpPrompt}
                onPermissionModeChange={changeSelectedPermissionMode}
                onModelSelectionChange={setModelSelection}
                onSubmitFollowUp={submitFollowUp}
                onOpenWorkbench={() => setWorkbenchOpen(true)}
                onOpenTerminal={openTerminal}
                onResume={() => controlRun("resume")}
                onRefreshStatus={() => controlRun("status")}
                onStop={() => controlRun("stop")}
                onOpenSettings={onOpenSettings}
              />
            ) : (
              <div className="code-agents-start">
                <h2>What should we work on?</h2>
                <NewSessionComposer
                  prompt={newPrompt}
                  inputRef={newPromptRef}
                  creating={creatingRun}
                  permissionMode={newRunPermissionMode}
                  modelSelection={selectedModelSelection}
                  modelOptions={modelOptions}
                  onPromptChange={setNewPrompt}
                  onPermissionModeChange={setNewRunPermissionMode}
                  onModelSelectionChange={setModelSelection}
                  onSubmit={createRunFromPrompt}
                />
                <div className="code-agents-suggestions">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGoalId("task");
                      setNewPrompt("Review the current changes");
                      newPromptRef.current?.focus();
                    }}
                  >
                    Review the current changes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGoalId("migrate");
                      setNewPrompt("/migrate ");
                      newPromptRef.current?.focus();
                    }}
                  >
                    Migrate an existing app
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGoalId("audit");
                      setNewPrompt("/audit ");
                      newPromptRef.current?.focus();
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

function NewSessionComposer({
  prompt,
  inputRef,
  creating,
  permissionMode,
  modelSelection,
  modelOptions,
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSubmit,
}: {
  prompt: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  creating: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) => void;
}) {
  return (
    <CodeAgentComposer
      prompt={prompt}
      inputRef={inputRef}
      submitting={creating}
      permissionMode={permissionMode}
      modelSelection={modelSelection}
      modelOptions={modelOptions}
      placeholder="Describe a task or ask a question"
      variant="hero"
      submitLabel={creating ? "Starting session" : "Start session"}
      onPromptChange={onPromptChange}
      onPermissionModeChange={onPermissionModeChange}
      onModelSelectionChange={onModelSelectionChange}
      onSubmit={onSubmit}
    />
  );
}

function CodeAgentComposer({
  prompt,
  inputRef,
  submitting,
  permissionMode,
  modelSelection,
  modelOptions,
  placeholder,
  submitLabel,
  variant = "compact",
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSubmit,
}: {
  prompt: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  submitting: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  placeholder: string;
  submitLabel: string;
  variant?: "hero" | "compact";
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [attachments, setAttachments] = useState<CodeAgentPromptAttachment[]>(
    [],
  );
  const [listening, setListening] = useState(false);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: CodeAgentPromptAttachment[] = [];
    for (const file of Array.from(files)) {
      next.push(await readComposerAttachment(file));
    }
    setAttachments((current) => [...current, ...next]);
    toast(`${next.length} file${next.length === 1 ? "" : "s"} attached`, {
      duration: 1800,
    });
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      toast("Voice dictation is not available in this browser.", {
        duration: 2800,
      });
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        onPromptChange(
          [prompt.trimEnd(), transcript].filter(Boolean).join(" "),
        );
      }
    };
    recognition.onerror = () => {
      setListening(false);
      toast("Voice dictation stopped", { duration: 1800 });
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const prepared = promptWithAttachments(prompt, attachments);
    onSubmit(prepared, attachments);
    if (prompt.trim()) setAttachments([]);
  };

  return (
    <form
      className={`code-agents-new-session code-agents-composer-shell code-agents-composer-shell--${variant}`}
      onSubmit={submit}
    >
      <textarea
        ref={inputRef}
        className="code-agents-composer"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={placeholder}
        rows={variant === "hero" ? 4 : 3}
      />

      {attachments.length > 0 && (
        <div className="code-agents-attachments" aria-label="Attached files">
          {attachments.map((attachment, index) => (
            <button
              key={`${attachment.name}-${index}`}
              type="button"
              className="code-agents-attachment-chip"
              onClick={() =>
                setAttachments((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              title={`Remove ${attachment.name}`}
            >
              <span>{attachment.name}</span>
              <IconX size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div className="code-agents-composer-bar">
        <div className="code-agents-composer-left">
          <ComposerPlusMenu
            onUpload={() => fileInputRef.current?.click()}
            disabled={submitting}
          />
          <input
            ref={fileInputRef}
            className="code-agents-file-input"
            type="file"
            multiple
            onChange={(event) => {
              void addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <RunModeSelect
            value={permissionMode}
            onChange={onPermissionModeChange}
            compact
          />
        </div>
        <div className="code-agents-composer-right">
          <ModelEffortSelect
            value={modelSelection}
            models={modelOptions}
            onChange={onModelSelectionChange}
          />
          <button
            type="button"
            className={`code-agents-composer-icon-button${
              listening ? " code-agents-composer-icon-button--active" : ""
            }`}
            onClick={toggleVoice}
            title="Voice dictation"
            aria-label="Voice dictation"
            disabled={submitting}
          >
            <IconMicrophone size={16} strokeWidth={1.75} />
          </button>
          <button
            type="submit"
            className="code-agents-send-button"
            disabled={
              submitting ||
              promptWithAttachments(prompt, attachments).trim().length === 0
            }
            aria-label={submitLabel}
          >
            <IconArrowUp size={17} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </form>
  );
}

function ComposerPlusMenu({
  onUpload,
  disabled,
}: {
  onUpload: () => void;
  disabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="code-agents-composer-icon-button"
          aria-label="Add context"
          title="Add context"
          disabled={disabled}
        >
          <IconPlus size={18} strokeWidth={1.7} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="code-agents-plus-menu">
        <DropdownMenuLabel>Add context</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event: Event) => {
            event.preventDefault();
            onUpload();
          }}
          description="Attach files to this prompt."
        >
          <IconFileUpload size={15} strokeWidth={1.8} />
          Upload files
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled
          description="Schedule this from Automations soon."
        >
          <IconCalendarTime size={15} strokeWidth={1.8} />
          Scheduled task
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelEffortSelect({
  value,
  models,
  onChange,
}: {
  value: CodeAgentModelSelection;
  models: CodeAgentModelOption[];
  onChange: (value: CodeAgentModelSelection) => void;
}) {
  const normalized = normalizeModelSelection(value, models);
  const modelKey = modelOptionKey(normalized);
  const effort = normalized.effort ?? "auto";
  const modelLabel =
    models.find((model) => modelOptionKey(model) === modelKey)?.label ??
    normalized.model ??
    "Model";
  return (
    <div className="code-agents-model-controls">
      <Select
        value={modelKey}
        onValueChange={(nextValue) => {
          const nextModel = models.find(
            (option) => modelOptionKey(option) === nextValue,
          );
          if (!nextModel) return;
          onChange({
            engine: nextModel.engine,
            model: nextModel.model,
            effort,
          });
        }}
      >
        <SelectTrigger
          className="code-agents-model-select"
          aria-label="Model"
          title={modelLabel}
        >
          <SelectValue>{modelLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {models.map((model) => (
              <SelectItem
                key={modelOptionKey(model)}
                value={modelOptionKey(model)}
                description={model.description ?? model.engineLabel}
              >
                {model.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={effort}
        onValueChange={(nextEffort) =>
          onChange({
            ...normalized,
            effort: normalizeReasoningEffort(nextEffort),
          })
        }
      >
        <SelectTrigger
          className="code-agents-effort-select"
          aria-label="Reasoning effort"
          title="Reasoning effort"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {CODE_AGENT_REASONING_EFFORTS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function modelOptionKey(
  value: Pick<CodeAgentModelSelection, "engine" | "model">,
): string {
  return `${value.engine ?? "auto"}:${value.model ?? "auto"}`;
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

async function readComposerAttachment(
  file: File,
): Promise<CodeAgentPromptAttachment> {
  const attachment: CodeAgentPromptAttachment = {
    name: file.name,
    type: file.type || undefined,
    size: file.size,
  };
  if (isLikelyTextFile(file) && file.size <= MAX_ATTACHMENT_TEXT_CHARS) {
    try {
      attachment.text = await file.text();
    } catch {
      // Keep the filename-only attachment if the browser cannot read it.
    }
  }
  return attachment;
}

function isLikelyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return /\.(cjs|css|csv|html|js|json|jsx|md|mdx|mjs|sql|tsx?|txt|xml|yaml|yml)$/i.test(
    file.name,
  );
}

function promptWithAttachments(
  prompt: string,
  attachments: CodeAgentPromptAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const attachmentText = attachments
    .map((attachment) => {
      const size = attachment.size ? ` size="${attachment.size}"` : "";
      const type = attachment.type ? ` type="${attachment.type}"` : "";
      const body =
        attachment.text?.trim() ||
        "Selected in the UI. If this file is needed, inspect it from the workspace or ask for a readable copy.";
      return `<attached-file name="${escapeAttribute(attachment.name)}"${type}${size}>\n${body}\n</attached-file>`;
    })
    .join("\n\n");
  return `${prompt.trimEnd()}\n\nAttached context:\n${attachmentText}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function getSpeechRecognitionConstructor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const maybeWindow = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return (
    maybeWindow.SpeechRecognition ?? maybeWindow.webkitSpeechRecognition ?? null
  );
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

function RunRailItem({
  run,
  selected,
  onSelect,
  onOpen,
}: {
  run: CodeAgentRun;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const progress = getRunProgressPercent(run);
  const progressLabel = getRunProgressLabel(run);
  return (
    <button
      type="button"
      className={`code-agents-run${selected ? " code-agents-run--active" : ""}`}
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
  );
}

function RunDetailCard({
  run,
  selectedRunId,
  goal,
  transcriptEvents,
  transcriptLoading,
  transcriptError,
  followUpPrompt,
  submittingFollowUp,
  permissionMode,
  modelSelection,
  modelOptions,
  updatingPermissionMode,
  onFollowUpPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSubmitFollowUp,
  onOpenWorkbench,
  onOpenTerminal,
  onResume,
  onRefreshStatus,
  onStop,
  onOpenSettings,
}: {
  run: CodeAgentRun | null;
  selectedRunId: string | null;
  goal: CodeAgentGoalDefinition;
  transcriptEvents: CodeAgentTranscriptEvent[];
  transcriptLoading: boolean;
  transcriptError: string | null;
  followUpPrompt: string;
  submittingFollowUp: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  updatingPermissionMode: boolean;
  onFollowUpPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSubmitFollowUp: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) => void;
  onOpenWorkbench: () => void;
  onOpenTerminal: () => void;
  onResume: () => void;
  onRefreshStatus: () => void;
  onStop: () => void;
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
        </div>
      )}

      <div className="code-agents-session-layout">
        <div className="code-agents-session-main">
          <TranscriptPanel
            events={transcriptEvents}
            loading={transcriptLoading}
            error={transcriptError}
            followUpPrompt={followUpPrompt}
            submitting={submittingFollowUp}
            permissionMode={permissionMode}
            modelSelection={modelSelection}
            modelOptions={modelOptions}
            onFollowUpPromptChange={onFollowUpPromptChange}
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
  submitting,
  permissionMode,
  modelSelection,
  modelOptions,
  onFollowUpPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSubmitFollowUp,
}: {
  events: CodeAgentTranscriptEvent[];
  loading: boolean;
  error: string | null;
  followUpPrompt: string;
  submitting: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  onFollowUpPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSubmitFollowUp: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
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
        modelSelection={modelSelection}
        modelOptions={modelOptions}
        placeholder="Ask for follow-up changes"
        submitLabel={submitting ? "Recording follow-up" : "Send follow-up"}
        onPromptChange={onFollowUpPromptChange}
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
