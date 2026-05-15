import { useCallback, useEffect, useMemo, useState } from "react";
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
}: CodeAgentsHubProps) {
  const [selectedGoalId, setSelectedGoalId] =
    useState<CodeAgentGoalId>("migrate");
  const selectedGoal =
    getCodeAgentGoal(selectedGoalId) ?? getDefaultCodeAgentGoal();
  const selectedGoalApp = useMemo(
    () =>
      selectedGoal.surfaceKind === "app"
        ? getCodeAgentAppConfig(selectedGoal, apps)
        : null,
    [apps, selectedGoal],
  );
  const selectedGoalAppDef = useMemo(
    () => (selectedGoalApp ? toAppDefinition(selectedGoalApp) : null),
    [selectedGoalApp],
  );
  const [runs, setRuns] = useState<CodeAgentMigrationRun[]>([]);
  const [status, setStatus] = useState<RunListStatus>("unavailable");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");

  const loadRuns = useCallback(
    async (busy = false) => {
      if (busy) setRefreshing(true);
      try {
        const result =
          (await window.electronAPI?.codeAgents?.listRuns?.(selectedGoal.id)) ??
          (await window.electronAPI?.codeAgents?.listMigrationRuns?.());
        if (!result) {
          setStatus("unavailable");
          setError("Desktop bridge is not available.");
          setRuns([]);
          return;
        }
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

  useEffect(() => {
    void loadRuns();
    const interval = window.setInterval(() => void loadRuns(), 10_000);
    return () => window.clearInterval(interval);
  }, [loadRuns]);

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

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const summary = useMemo(() => buildSummary(runs), [runs]);
  const visibleRuns = useMemo(
    () => runs.filter((run) => matchesRunFilter(run, runFilter)),
    [runFilter, runs],
  );
  const workbenchUrlParams = selectedRunId ? { run: selectedRunId } : undefined;

  async function openTerminal() {
    const result = await window.electronAPI?.codeAgents?.openTerminal?.();
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
    setSelectedRunId(null);
    setWorkbenchOpen(true);
  }

  async function controlRun(command: CodeAgentControlCommand) {
    if (!selectedRunId) {
      toast("Select a session first", { duration: 1800 });
      return;
    }
    if (command === "resume") {
      setWorkbenchOpen(true);
    }
    if (command === "status") {
      await loadRuns(true);
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

  return (
    <section className="code-agents-surface" aria-label="Code Agents">
      <aside
        className="code-agents-rail"
        aria-label="Code Agent goals and sessions"
      >
        <div className="code-agents-rail__header">
          <div className="code-agents-mark">
            <IconCode size={18} strokeWidth={1.8} />
          </div>
          <div className="code-agents-title-block">
            <h1>Code Agents</h1>
            <p>Slash-command sessions</p>
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
                  {selectedRun?.name ??
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
                <p className="code-agents-kicker">Slash-command hub</p>
                <h2>Code Agents</h2>
                <p>
                  Start slash-command sessions, review coding-agent feedback,
                  and jump into the right detail surface. Migration is the first
                  app-backed goal here; the hub is the primary Desktop home for
                  Code Agents.
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

            <div className="code-agents-status-grid">
              <StatusCard
                icon={<IconListCheck size={17} strokeWidth={1.8} />}
                label="Sessions"
                value={String(summary.total)}
                tone="neutral"
              />
              <StatusCard
                icon={<IconPlayerPlay size={17} strokeWidth={1.8} />}
                label="Running"
                value={String(summary.inProgress)}
                tone="active"
              />
              <StatusCard
                icon={<IconAlertCircle size={17} strokeWidth={1.8} />}
                label="Needs input"
                value={String(summary.needsApproval)}
                tone="warning"
              />
              <StatusCard
                icon={<IconCircleCheck size={17} strokeWidth={1.8} />}
                label="Completed"
                value={String(summary.complete)}
                tone="success"
              />
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

            <RunDetailCard
              run={selectedRun}
              selectedRunId={selectedRunId}
              goal={selectedGoal}
              onOpenWorkbench={() => setWorkbenchOpen(true)}
              onOpenTerminal={openTerminal}
              onResume={() => controlRun("resume")}
              onRefreshStatus={() => controlRun("status")}
              onStop={() => controlRun("stop")}
            />
          </div>
        )}
      </main>
    </section>
  );
}

function buildSummary(runs: CodeAgentMigrationRun[]) {
  return runs.reduce(
    (acc, run) => {
      acc.total += 1;
      if (run.phase === "complete") acc.complete += 1;
      else acc.inProgress += 1;
      if (run.phase === "approve" && !run.approved) acc.needsApproval += 1;
      acc.failedTasks += run.failedTaskCount;
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
        <h3>{goal.slashCommand} native feedback</h3>
        <p>
          {goal.description} Native goals report status, findings, approval
          prompts, and terminal handoffs directly in this Code Agents hub.
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
          agent-native code {goal.slashCommand} --url https://example.com
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

function matchesRunFilter(run: CodeAgentMigrationRun, filter: RunFilter) {
  if (filter === "all") return true;
  if (filter === "complete") return run.phase === "complete";
  if (filter === "approval") return run.phase === "approve" && !run.approved;
  if (filter === "issues") return run.failedTaskCount > 0;
  return run.phase !== "complete";
}

function RunRailItem({
  run,
  selected,
  onSelect,
  onOpen,
}: {
  run: CodeAgentMigrationRun;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const progress = getTaskProgress(run);
  return (
    <button
      type="button"
      className={`code-agents-run${selected ? " code-agents-run--active" : ""}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      title={run.name}
    >
      <div className="code-agents-run__topline">
        <span className="code-agents-run__name">{run.name}</span>
        <PhasePill run={run} />
      </div>
      <p className="code-agents-run__path">{run.sourceRoot}</p>
      <div className="code-agents-run__meta">
        <span>{run.taskCount} tasks</span>
        <span>{progress}% passed</span>
        <span>{formatRelativeTime(run.updatedAt)}</span>
      </div>
    </button>
  );
}

function RunDetailCard({
  run,
  selectedRunId,
  goal,
  onOpenWorkbench,
  onOpenTerminal,
  onResume,
  onRefreshStatus,
  onStop,
}: {
  run: CodeAgentMigrationRun | null;
  selectedRunId: string | null;
  goal: CodeAgentGoalDefinition;
  onOpenWorkbench: () => void;
  onOpenTerminal: () => void;
  onResume: () => void;
  onRefreshStatus: () => void;
  onStop: () => void;
}) {
  if (!run) {
    return (
      <div className="code-agents-detail code-agents-detail--empty">
        <IconRoute size={30} strokeWidth={1.5} />
        <h3>{selectedRunId ? "Session link ready" : "No session selected"}</h3>
        <p>
          {selectedRunId
            ? `Open ${goal.surfaceLabel} to load the linked slash-command session.`
            : `Start ${goal.slashCommand} or select a session to review source, output, task status, and coding-agent feedback.`}
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

  const progress = getTaskProgress(run);

  return (
    <div className="code-agents-detail">
      <div className="code-agents-detail__header">
        <div>
          <p className="code-agents-kicker">Selected session</p>
          <h3>{run.name}</h3>
        </div>
        <PhasePill run={run} />
      </div>

      <div className="code-agents-progress">
        <div className="code-agents-progress__label">
          <span>Task feedback</span>
          <span>{progress}%</span>
        </div>
        <div className="code-agents-progress__track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="code-agents-detail-grid">
        <Field label="Source" value={run.sourceRoot} />
        <Field label="Output" value={run.outputRoot} />
        <Field label="Target" value={run.target} />
        <Field label="Updated" value={formatRelativeTime(run.updatedAt)} />
      </div>

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
        {run.phase !== "complete" && (
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

function PhasePill({ run }: { run: CodeAgentMigrationRun }) {
  const tone =
    run.phase === "complete"
      ? "complete"
      : run.phase === "approve" && !run.approved
        ? "approval"
        : "active";
  return (
    <span className={`code-agents-phase code-agents-phase--${tone}`}>
      {run.phase}
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

function getTaskProgress(run: CodeAgentMigrationRun): number {
  if (run.taskCount <= 0) return 0;
  return Math.round((run.passedTaskCount / run.taskCount) * 100);
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
