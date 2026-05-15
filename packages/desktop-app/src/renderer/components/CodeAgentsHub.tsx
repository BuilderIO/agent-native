import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconClock,
  IconCode,
  IconExternalLink,
  IconListCheck,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconTerminal2,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  CODE_AGENT_GOALS,
  getCodeAgentAppConfig,
  getCodeAgentGoal,
  getDefaultCodeAgentGoal,
  type CodeAgentGoalDefinition,
  type CodeAgentGoalId,
} from "@shared/code-agents";
import { toAppDefinition, type AppConfig } from "@shared/app-registry";
import AppWebview from "./AppWebview.js";

interface CodeAgentsHubProps {
  apps: AppConfig[];
  openRequest?: { goalId?: string; runId?: string; nonce: number };
  refreshKey?: number;
  onOpenSettings?: () => void;
}

type RunListStatus = CodeAgentRunListResult["status"];
type RunFilter = "all" | "active" | "approval" | "complete" | "issues";

const RUN_FILTERS: Array<{ id: RunFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "approval", label: "Input" },
  { id: "issues", label: "Issues" },
  { id: "complete", label: "Done" },
];

export default function CodeAgentsHub({
  apps,
  openRequest,
  refreshKey = 0,
  onOpenSettings,
}: CodeAgentsHubProps) {
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
  const selectedGoalAppDef = useMemo(
    () => (selectedGoalApp ? toAppDefinition(selectedGoalApp) : null),
    [selectedGoalApp],
  );
  const [status, setStatus] = useState<RunListStatus>("unavailable");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [newPrompt, setNewPrompt] = useState("");
  const [creatingRun, setCreatingRun] = useState(false);
  const [transcriptEvents, setTranscriptEvents] = useState<
    CodeAgentTranscriptEvent[]
  >([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);
  const newPromptRef = useRef<HTMLTextAreaElement | null>(null);

  const loadRuns = useCallback(
    async (busy = false) => {
      if (busy) setRefreshing(true);
      try {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listRuns) {
          setStatus("unavailable");
          setError("Desktop bridge is not available.");
          setRuns([]);
          return;
        }
        const result = await api.listRuns(selectedGoal.id);
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
    [selectedGoal.id],
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
        const api = window.electronAPI?.codeAgents;
        if (!api?.readTranscript) {
          setTranscriptEvents([]);
          setTranscriptError("Desktop bridge is not available.");
          return;
        }
        const result = await api.readTranscript({
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
    [selectedGoal.id, selectedRunId],
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

  useEffect(() => {
    if (selectedRunId || runs.length === 0) return;
    setSelectedRunId(runs[0].id);
  }, [runs, selectedRunId]);

  const summary = useMemo(() => buildSummary(runs), [runs]);
  const hasActiveRuns = useMemo(() => runs.some(isRunActive), [runs]);
  const selectedRunIsActive = selectedRun ? isRunActive(selectedRun) : false;
  const visibleRuns = useMemo(
    () => runs.filter((run) => matchesRunFilter(run, runFilter)),
    [runFilter, runs],
  );
  const workbenchUrlParams = selectedRunId ? { run: selectedRunId } : undefined;

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
    const result =
      await window.electronAPI?.codeAgents?.openTerminal?.(terminalRequest);
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

    const result = await window.electronAPI?.codeAgents?.controlRun?.(
      selectedGoal.id,
      selectedRunId,
      command,
    );
    if (!result) {
      toast("Desktop bridge is not available", { duration: 2600 });
      return;
    }
    if (result.action === "open-ui") setWorkbenchOpen(true);
    if (result.action === "refresh") await loadRuns(true);
    toast(result.message, {
      duration: result.ok ? 2200 : 3600,
      description: result.error,
    });
  }

  async function createRunFromPrompt(event: React.FormEvent) {
    event.preventDefault();
    const prompt = newPrompt.trim();
    if (!prompt) {
      toast("Enter a coding task first", { duration: 1800 });
      return;
    }
    const api = window.electronAPI?.codeAgents;
    if (!api?.createRun) {
      toast("Desktop bridge is not available", { duration: 2600 });
      return;
    }

    setCreatingRun(true);
    try {
      const result = await api.createRun({
        goalId: selectedGoal.id,
        prompt,
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

  async function submitFollowUp(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRun) {
      toast("Select a session first", { duration: 1800 });
      return;
    }
    const prompt = followUpPrompt.trim();
    if (!prompt) {
      toast("Enter a follow-up prompt", { duration: 1800 });
      return;
    }
    const api = window.electronAPI?.codeAgents;
    if (!api?.appendFollowUp) {
      toast("Desktop bridge is not available", { duration: 2600 });
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
      const result = await api.appendFollowUp({
        goalId: selectedGoal.id,
        runId: selectedRun.id,
        prompt,
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

  return (
    <section className="code-agents-surface" aria-label="Code">
      <aside
        className="code-agents-rail"
        aria-label="Code Agent goals and sessions"
      >
        <div className="code-agents-rail__header">
          <div className="code-agents-mark">
            <IconCode size={18} strokeWidth={1.8} />
          </div>
          <div className="code-agents-title-block">
            <h1>Code</h1>
            <p>Coding sessions</p>
          </div>
        </div>

        <div className="code-agents-goal-list" aria-label="Code Agent goals">
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
              <span>{goal.slashCommand}</span>
              <strong>{goal.label}</strong>
            </button>
          ))}
        </div>

        <div className="code-agents-rail__actions">
          <button
            type="button"
            className="code-agents-button code-agents-button--primary"
            onClick={openSelectedGoal}
          >
            <IconRoute size={14} strokeWidth={1.8} />
            {selectedGoal.primaryActionLabel}
          </button>
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

        <div className="code-agents-run-list">
          <div className="code-agents-filter" aria-label="Session filters">
            {RUN_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`code-agents-filter__item${
                  runFilter === filter.id
                    ? " code-agents-filter__item--active"
                    : ""
                }`}
                onClick={() => setRunFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {loading ? (
            <RunListSkeleton />
          ) : visibleRuns.length === 0 ? (
            <div className="code-agents-empty-rail">
              <IconClock size={18} strokeWidth={1.7} />
              <p>
                {runs.length === 0
                  ? `No ${selectedGoal.slashCommand} sessions yet.`
                  : "No sessions match this filter."}
              </p>
            </div>
          ) : (
            visibleRuns.map((run) => (
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
              {selectedGoalApp && selectedGoalAppDef ? (
                <AppWebview
                  app={selectedGoalAppDef}
                  appConfig={selectedGoalApp}
                  isActive
                  urlParams={workbenchUrlParams}
                  refreshKey={refreshKey}
                />
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
            <div className="code-agents-overview__header">
              <div>
                <p className="code-agents-kicker">Native Code app</p>
                <h2>Coding sessions</h2>
                <p>
                  Start a coding task, review the transcript, and attach
                  follow-ups to the same session. Migration and audit are
                  slash-command goals in the same queue.
                </p>
              </div>
              <div className="code-agents-toolbar-actions">
                <button
                  type="button"
                  className="code-agents-button"
                  onClick={() => setWorkbenchOpen(true)}
                >
                  <IconExternalLink size={14} strokeWidth={1.8} />
                  Open {selectedGoal.surfaceLabel}
                </button>
                <button
                  type="button"
                  className="code-agents-button"
                  onClick={openTerminal}
                >
                  <IconTerminal2 size={14} strokeWidth={1.8} />
                  Open Terminal
                </button>
              </div>
            </div>

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

            <NewSessionComposer
              goal={selectedGoal}
              prompt={newPrompt}
              inputRef={newPromptRef}
              creating={creatingRun}
              onPromptChange={setNewPrompt}
              onSubmit={createRunFromPrompt}
            />

            <div className="code-agents-status-grid">
              <StatusCard
                icon={<IconListCheck size={17} strokeWidth={1.8} />}
                label="Sessions"
                value={String(summary.total)}
                tone="neutral"
              />
              <StatusCard
                icon={<IconPlayerPlay size={17} strokeWidth={1.8} />}
                label="Active"
                value={String(summary.inProgress)}
                tone="active"
              />
              <StatusCard
                icon={<IconAlertCircle size={17} strokeWidth={1.8} />}
                label="Waiting"
                value={String(summary.needsApproval)}
                tone="warning"
              />
              <StatusCard
                icon={<IconCircleCheck size={17} strokeWidth={1.8} />}
                label="Complete"
                value={String(summary.complete)}
                tone="success"
              />
            </div>

            <RunDetailCard
              run={selectedRun}
              selectedRunId={selectedRunId}
              goal={selectedGoal}
              transcriptEvents={transcriptEvents}
              transcriptLoading={transcriptLoading}
              transcriptError={transcriptError}
              followUpPrompt={followUpPrompt}
              submittingFollowUp={submittingFollowUp}
              onFollowUpPromptChange={setFollowUpPrompt}
              onSubmitFollowUp={submitFollowUp}
              onOpenWorkbench={() => setWorkbenchOpen(true)}
              onOpenTerminal={openTerminal}
              onResume={() => controlRun("resume")}
              onRefreshStatus={() => controlRun("status")}
              onStop={() => controlRun("stop")}
              onOpenSettings={onOpenSettings}
            />
          </div>
        )}
      </main>
    </section>
  );
}

function buildSummary(runs: CodeAgentRun[]) {
  return runs.reduce(
    (acc, run) => {
      acc.total += 1;
      if (run.status === "completed" || run.phase === "complete") {
        acc.complete += 1;
      } else {
        acc.inProgress += 1;
      }
      if (
        run.needsApproval ||
        run.status === "needs-approval" ||
        (isMigrationRun(run) && run.phase === "approve" && !run.approved)
      ) {
        acc.needsApproval += 1;
      }
      acc.failedTasks += getRunFailedCount(run);
      return acc;
    },
    {
      total: 0,
      inProgress: 0,
      needsApproval: 0,
      complete: 0,
      failedTasks: 0,
    },
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
  goal,
  prompt,
  inputRef,
  creating,
  onPromptChange,
  onSubmit,
}: {
  goal: CodeAgentGoalDefinition;
  prompt: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  creating: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form className="code-agents-new-session" onSubmit={onSubmit}>
      <div className="code-agents-new-session__header">
        <div>
          <p className="code-agents-kicker">{goal.slashCommand}</p>
          <h3>New coding session</h3>
        </div>
        <button
          type="submit"
          className="code-agents-button code-agents-button--primary"
          disabled={creating || prompt.trim().length === 0}
        >
          <IconPlayerPlay size={14} strokeWidth={1.8} />
          {creating ? "Starting" : "Start Session"}
        </button>
      </div>
      <textarea
        ref={inputRef}
        className="code-agents-composer"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Describe the coding task..."
        rows={3}
      />
    </form>
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
        <h3>{goal.slashCommand} session surface</h3>
        <p>
          {goal.description} Transcript events, queued prompts, status updates,
          artifacts, and terminal handoffs live directly in this native Code
          surface.
        </p>
        <div className="code-agents-feedback-list">
          <span>
            <IconListCheck size={14} strokeWidth={1.8} />
            Findings and task progress stay attached to the session.
          </span>
          <span>
            <IconAlertCircle size={14} strokeWidth={1.8} />
            Approval or follow-up prompts appear as coding-agent feedback.
          </span>
        </div>
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
    return 'agent-native code /task "Implement the settings polish"';
  }
  if (goal.id === "migrate") {
    return "agent-native code /migrate ./legacy-app --out ../migrated-app";
  }
  return `agent-native code ${goal.slashCommand} --url https://example.com`;
}

function matchesRunFilter(run: CodeAgentRun, filter: RunFilter) {
  if (filter === "all") return true;
  if (filter === "complete") {
    return run.status === "completed" || run.phase === "complete";
  }
  if (filter === "approval") {
    return (
      run.needsApproval ||
      run.status === "needs-approval" ||
      (isMigrationRun(run) && run.phase === "approve" && !run.approved)
    );
  }
  if (filter === "issues") {
    return run.status === "errored" || getRunFailedCount(run) > 0;
  }
  return run.status !== "completed" && run.phase !== "complete";
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
  onFollowUpPromptChange,
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
  onFollowUpPromptChange: (value: string) => void;
  onSubmitFollowUp: (event: React.FormEvent) => void;
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

  return (
    <div className="code-agents-detail">
      <div className="code-agents-detail__header">
        <div>
          <p className="code-agents-kicker">Selected session</p>
          <h3>{getRunTitle(run)}</h3>
        </div>
        <PhasePill run={run} />
      </div>

      <div className="code-agents-progress">
        <div className="code-agents-progress__label">
          <span>{run.progress?.label ?? "Task feedback"}</span>
          <span>{progress}%</span>
        </div>
        <div className="code-agents-progress__track">
          <span style={{ width: `${progress}%` }} />
        </div>
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

      <div className="code-agents-detail-grid">
        {details.map((detail) => (
          <Field key={detail.label} label={detail.label} value={detail.value} />
        ))}
      </div>

      <TranscriptPanel
        events={transcriptEvents}
        loading={transcriptLoading}
        error={transcriptError}
        followUpPrompt={followUpPrompt}
        submitting={submittingFollowUp}
        onFollowUpPromptChange={onFollowUpPromptChange}
        onSubmitFollowUp={onSubmitFollowUp}
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
          <button type="button" className="code-agents-button" onClick={onStop}>
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
    </div>
  );
}

function TranscriptPanel({
  events,
  loading,
  error,
  followUpPrompt,
  submitting,
  onFollowUpPromptChange,
  onSubmitFollowUp,
}: {
  events: CodeAgentTranscriptEvent[];
  loading: boolean;
  error: string | null;
  followUpPrompt: string;
  submitting: boolean;
  onFollowUpPromptChange: (value: string) => void;
  onSubmitFollowUp: (event: React.FormEvent) => void;
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

      <form className="code-agents-follow-up" onSubmit={onSubmitFollowUp}>
        <textarea
          className="code-agents-composer"
          value={followUpPrompt}
          onChange={(event) => onFollowUpPromptChange(event.target.value)}
          placeholder="Add a follow-up prompt..."
          rows={3}
        />
        <div className="code-agents-follow-up__actions">
          <button
            type="submit"
            className="code-agents-button code-agents-button--primary"
            disabled={submitting || followUpPrompt.trim().length === 0}
          >
            <IconRoute size={14} strokeWidth={1.8} />
            {submitting ? "Recording" : "Send Follow-up"}
          </button>
        </div>
      </form>
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

function StatusCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "active" | "warning" | "success";
}) {
  return (
    <div className={`code-agents-status code-agents-status--${tone}`}>
      <div className="code-agents-status__icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
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
      : run.needsApproval ||
          run.status === "needs-approval" ||
          (isMigrationRun(run) && run.phase === "approve" && !run.approved)
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

function getRunFailedCount(run: CodeAgentRun): number {
  if (typeof run.progress?.failed === "number") return run.progress.failed;
  if (isMigrationRun(run)) return run.failedTaskCount;
  return run.status === "errored" ? 1 : 0;
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

function getRunTitle(run: CodeAgentRun | null): string | null {
  if (!run) return null;
  if (isMigrationRun(run)) return run.name;
  return run.title || run.id;
}

function getRunSubtitle(run: CodeAgentRun): string {
  if (run.subtitle) return run.subtitle;
  if (isMigrationRun(run)) return run.sourceRoot;
  return run.goalId ? `${run.goalId} session` : "Code Agent session";
}

function getRunDetails(
  run: CodeAgentRun,
  goal: CodeAgentGoalDefinition,
): CodeAgentRunDetail[] {
  const details =
    run.details?.filter((detail) => detail.value.length > 0) ?? [];
  if (details.length > 0) {
    return [
      ...details,
      { label: "Updated", value: formatRelativeTime(run.updatedAt) },
    ];
  }
  if (isMigrationRun(run)) {
    return [
      { label: "Source", value: run.sourceRoot },
      { label: "Output", value: run.outputRoot },
      { label: "Target", value: run.target },
      { label: "Updated", value: formatRelativeTime(run.updatedAt) },
    ];
  }
  return [
    { label: "Goal", value: goal.slashCommand },
    { label: "Status", value: run.status },
    { label: "Updated", value: formatRelativeTime(run.updatedAt) },
  ];
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
