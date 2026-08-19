import type {
  CodeAgentSchedule,
  CodeAgentScheduleScope,
  CodeAgentsHost,
} from "@agent-native/code-agents-ui";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconCheck,
  IconClock,
  IconMessage,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ScheduleDraft = {
  name: string;
  prompt: string;
  scope: CodeAgentScheduleScope;
  targetRunId: string;
  intervalMinutes: string;
};

const EMPTY_DRAFT: ScheduleDraft = {
  name: "",
  prompt: "",
  scope: "global",
  targetRunId: "",
  intervalMinutes: "360",
};

export default function CodeAgentSchedulesPanel({
  host,
}: {
  host: CodeAgentsHost;
}) {
  const [schedules, setSchedules] = useState<CodeAgentSchedule[]>([]);
  const [threads, setThreads] = useState<
    Array<{ id: string; title: string; status: string }>
  >([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const refresh = useCallback(async () => {
    if (!host.listSchedules) {
      setError("Scheduled tasks are not available on this desktop host.");
      setLoading(false);
      return;
    }
    try {
      const [scheduleResult, runResult] = await Promise.all([
        host.listSchedules(),
        host.listRuns(),
      ]);
      if (scheduleResult.status !== "ok") {
        setError(scheduleResult.error ?? "Could not load scheduled tasks.");
      } else {
        setSchedules(scheduleResult.schedules);
        setError(null);
      }
      setThreads(
        runResult.runs.map((run) => ({
          id: run.id,
          title: run.title,
          status: run.status,
        })),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (
      selectedScheduleId &&
      !schedules.some((schedule) => schedule.id === selectedScheduleId)
    ) {
      setSelectedScheduleId(null);
    }
  }, [schedules, selectedScheduleId]);

  const filteredSchedules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return schedules;
    return schedules.filter((schedule) =>
      [schedule.name, schedule.prompt, schedule.scope]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, schedules]);

  const selectedSchedule = schedules.find(
    (schedule) => schedule.id === selectedScheduleId,
  );

  const createSchedule = useCallback(async () => {
    if (!host.createSchedule) return;
    setBusy("create");
    setError(null);
    try {
      const result = await host.createSchedule({
        name: draft.name,
        prompt: draft.prompt,
        scope: draft.scope,
        targetRunId: draft.scope === "thread" ? draft.targetRunId : undefined,
        intervalMinutes: Number(draft.intervalMinutes),
      });
      if (!result.ok || !result.schedule) {
        setError(result.error ?? result.message);
        return;
      }
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      await refresh();
      setSelectedScheduleId(result.schedule.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
    } finally {
      setBusy(null);
    }
  }, [draft, host, refresh]);

  const updateSchedule = useCallback(
    async (input: Record<string, unknown>, action: string) => {
      if (!host.updateSchedule || !selectedSchedule) return;
      setBusy(action);
      setError(null);
      try {
        const result = await host.updateSchedule({
          scheduleId: selectedSchedule.id,
          ...input,
        });
        if (!result.ok) {
          setError(result.error ?? result.message);
          return;
        }
        await refresh();
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : String(updateError),
        );
      } finally {
        setBusy(null);
      }
    },
    [host, refresh, selectedSchedule],
  );

  const runNow = useCallback(async () => {
    if (!host.runScheduleNow || !selectedSchedule) return;
    setBusy("run");
    setError(null);
    try {
      const result = await host.runScheduleNow({
        scheduleId: selectedSchedule.id,
      });
      if (!result.ok) {
        setError(result.error ?? result.message);
        return;
      }
      await refresh();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusy(null);
    }
  }, [host, refresh, selectedSchedule]);

  const deleteSchedule = useCallback(async () => {
    if (!host.deleteSchedule || !selectedSchedule) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      const result = await host.deleteSchedule({
        scheduleId: selectedSchedule.id,
      });
      if (!result.ok) {
        setError(result.error ?? result.message);
        return;
      }
      setSelectedScheduleId(null);
      setDeleteArmed(false);
      await refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      );
    } finally {
      setBusy(null);
    }
  }, [deleteArmed, host, refresh, selectedSchedule]);

  return (
    <section
      className="desktop-code-agent-schedules"
      aria-label="Scheduled tasks"
    >
      <header className="desktop-code-agent-schedules__header">
        <div>
          <p className="desktop-code-agent-schedules__eyebrow">
            <IconClock size={14} strokeWidth={1.8} />
            Agent workspace
          </p>
          <h1>Scheduled tasks</h1>
          <p>Wake an existing thread or start a fresh one on an interval.</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setCreating(true);
            setSelectedScheduleId(null);
            setDraft(EMPTY_DRAFT);
            setDeleteArmed(false);
          }}
        >
          <IconPlus size={15} />
          New schedule
        </Button>
      </header>

      <div className="desktop-code-agent-schedules__toolbar">
        <IconSearch size={16} strokeWidth={1.8} aria-hidden="true" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search scheduled tasks"
          aria-label="Search scheduled tasks"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh scheduled tasks"
          title="Refresh scheduled tasks"
        >
          <IconRefresh
            size={15}
            className={loading ? "animate-spin" : undefined}
          />
        </Button>
      </div>

      {error ? (
        <div className="desktop-code-agent-schedules__error" role="alert">
          {error}
        </div>
      ) : null}

      <div
        className={[
          "desktop-code-agent-schedules__body",
          selectedSchedule || creating
            ? "desktop-code-agent-schedules__body--selected"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="desktop-code-agent-schedules__list">
          <div className="desktop-code-agent-schedules__list-header">
            <span>
              {filteredSchedules.length}{" "}
              {filteredSchedules.length === 1 ? "task" : "tasks"}
            </span>
            <span>Next run</span>
          </div>
          {loading && schedules.length === 0 ? (
            <div className="desktop-code-agent-schedules__empty">
              Loading scheduled tasks...
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div className="desktop-code-agent-schedules__empty">
              <IconClock size={26} strokeWidth={1.5} />
              <strong>
                {query ? "No matching tasks" : "No scheduled tasks yet"}
              </strong>
              <span>
                {query
                  ? "Try a different search."
                  : "Create one here or ask an agent to schedule a recurring check."}
              </span>
              {!query ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCreating(true)}
                >
                  <IconPlus size={15} />
                  Create a schedule
                </Button>
              ) : null}
            </div>
          ) : (
            filteredSchedules.map((schedule) => (
              <button
                type="button"
                key={schedule.id}
                className={[
                  "desktop-code-agent-schedules__row",
                  selectedScheduleId === schedule.id
                    ? "desktop-code-agent-schedules__row--selected"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setSelectedScheduleId(schedule.id);
                  setCreating(false);
                  setDeleteArmed(false);
                }}
              >
                <span className="desktop-code-agent-schedules__row-icon">
                  <IconClock size={17} strokeWidth={1.7} />
                </span>
                <span className="desktop-code-agent-schedules__row-copy">
                  <strong>{schedule.name}</strong>
                  <span>
                    {formatInterval(schedule.intervalMinutes)}{" "}
                    <span aria-hidden="true">·</span>{" "}
                    {schedule.scope === "thread"
                      ? "Thread · " + threadTitle(schedule.targetRunId, threads)
                      : "New thread"}
                  </span>
                </span>
                <span className="desktop-code-agent-schedules__row-next">
                  {schedule.enabled
                    ? formatNextRun(schedule.nextRunAt)
                    : "Paused"}
                </span>
              </button>
            ))
          )}
        </div>

        {creating ? (
          <ScheduleForm
            draft={draft}
            busy={busy === "create"}
            threads={threads}
            onChange={setDraft}
            onCancel={() => setCreating(false)}
            onSubmit={() => void createSchedule()}
          />
        ) : selectedSchedule ? (
          <ScheduleDetail
            schedule={selectedSchedule}
            busy={busy}
            threads={threads}
            deleteArmed={deleteArmed}
            onToggle={() =>
              void updateSchedule(
                { enabled: !selectedSchedule.enabled },
                "toggle",
              )
            }
            onRunNow={() => void runNow()}
            onDelete={() => void deleteSchedule()}
            onCancelDelete={() => setDeleteArmed(false)}
          />
        ) : null}
      </div>
    </section>
  );
}

function ScheduleForm({
  draft,
  busy,
  threads,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: ScheduleDraft;
  busy: boolean;
  threads: Array<{ id: string; title: string; status: string }>;
  onChange: (draft: ScheduleDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <aside className="desktop-code-agent-schedules__detail">
      <div className="desktop-code-agent-schedules__detail-header">
        <div>
          <p className="desktop-code-agent-schedules__eyebrow">New schedule</p>
          <h2>Set a recurring prompt</h2>
        </div>
      </div>
      <label>
        Name
        <Input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="Review release checks"
        />
      </label>
      <label>
        Prompt
        <Textarea
          value={draft.prompt}
          onChange={(event) =>
            onChange({ ...draft, prompt: event.target.value })
          }
          placeholder="Check the latest status and report blockers."
          rows={5}
        />
      </label>
      <label>
        Runs in
        <Select
          value={draft.scope}
          onValueChange={(scope: CodeAgentScheduleScope) =>
            onChange({
              ...draft,
              scope,
              targetRunId: scope === "global" ? "" : draft.targetRunId,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">A new thread</SelectItem>
            <SelectItem value="thread">An existing thread</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {draft.scope === "thread" ? (
        <label>
          Thread
          <Select
            value={draft.targetRunId}
            onValueChange={(targetRunId) => onChange({ ...draft, targetRunId })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a thread" />
            </SelectTrigger>
            <SelectContent>
              {threads.map((thread) => (
                <SelectItem key={thread.id} value={thread.id}>
                  {thread.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}
      <label>
        Every (minutes)
        <Input
          type="number"
          min={1}
          max={44640}
          value={draft.intervalMinutes}
          onChange={(event) =>
            onChange({ ...draft, intervalMinutes: event.target.value })
          }
        />
        <span className="desktop-code-agent-schedules__field-hint">
          Use 360 for every 6 hours.
        </span>
      </label>
      <div className="desktop-code-agent-schedules__detail-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={busy || !draft.name.trim() || !draft.prompt.trim()}
        >
          <IconCheck size={15} />
          {busy ? "Saving..." : "Save schedule"}
        </Button>
      </div>
    </aside>
  );
}

function ScheduleDetail({
  schedule,
  busy,
  threads,
  deleteArmed,
  onToggle,
  onRunNow,
  onDelete,
  onCancelDelete,
}: {
  schedule: CodeAgentSchedule;
  busy: string | null;
  threads: Array<{ id: string; title: string; status: string }>;
  deleteArmed: boolean;
  onToggle: () => void;
  onRunNow: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}) {
  const targetTitle = threadTitle(schedule.targetRunId, threads);
  return (
    <aside className="desktop-code-agent-schedules__detail">
      <div className="desktop-code-agent-schedules__detail-header">
        <div>
          <p className="desktop-code-agent-schedules__eyebrow">
            {schedule.enabled ? "Active" : "Paused"}
          </p>
          <h2>{schedule.name}</h2>
        </div>
        <span
          className={
            schedule.enabled
              ? "desktop-code-agent-schedules__status"
              : "desktop-code-agent-schedules__status desktop-code-agent-schedules__status--paused"
          }
        >
          {schedule.enabled ? "Running" : "Paused"}
        </span>
      </div>
      <div className="desktop-code-agent-schedules__prompt">
        {schedule.prompt}
      </div>
      <dl className="desktop-code-agent-schedules__metadata">
        <div>
          <dt>Runs in</dt>
          <dd>
            {schedule.scope === "thread" ? (
              <>
                <IconMessage size={14} />
                {targetTitle}
              </>
            ) : (
              "A new thread"
            )}
          </dd>
        </div>
        <div>
          <dt>Frequency</dt>
          <dd>Every {formatInterval(schedule.intervalMinutes)}</dd>
        </div>
        <div>
          <dt>Next run</dt>
          <dd>
            {schedule.enabled ? formatNextRun(schedule.nextRunAt) : "Paused"}
          </dd>
        </div>
        {schedule.lastRunAt ? (
          <div>
            <dt>Last run</dt>
            <dd>
              {formatNextRun(schedule.lastRunAt)}
              {schedule.lastStatus ? " · " + schedule.lastStatus : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {schedule.lastError ? (
        <p className="desktop-code-agent-schedules__last-error">
          {schedule.lastError}
        </p>
      ) : null}
      <div className="desktop-code-agent-schedules__detail-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onToggle}
          disabled={busy !== null}
        >
          {schedule.enabled ? (
            <IconPlayerPause size={15} />
          ) : (
            <IconPlayerPlay size={15} />
          )}
          {schedule.enabled ? "Pause" : "Resume"}
        </Button>
        <Button type="button" onClick={onRunNow} disabled={busy !== null}>
          <IconPlayerPlay size={15} />
          {busy === "run" ? "Queueing..." : "Run now"}
        </Button>
      </div>
      <div className="desktop-code-agent-schedules__danger">
        {deleteArmed ? (
          <>
            <span>Delete this schedule?</span>
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={busy !== "delete" && busy !== null}
            >
              <IconTrash size={14} />
              {busy === "delete" ? "Deleting..." : "Delete"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancelDelete}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={onDelete}
            disabled={busy !== null}
          >
            <IconTrash size={14} />
            Delete schedule
          </Button>
        )}
      </div>
    </aside>
  );
}

function formatInterval(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    return (
      String(minutes / (24 * 60)) + (minutes === 24 * 60 ? " day" : " days")
    );
  }
  if (minutes % 60 === 0) {
    return String(minutes / 60) + (minutes === 60 ? " hour" : " hours");
  }
  return String(minutes) + " minutes";
}

function formatNextRun(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  const delta = date.getTime() - Date.now();
  if (Math.abs(delta) < 60_000) {
    return delta < 0 ? "Due now" : "In less than a minute";
  }
  const minutes = Math.round(Math.abs(delta) / 60_000);
  if (minutes < 60) {
    return delta >= 0 ? "In " + minutes + " minutes" : minutes + " minutes ago";
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return delta >= 0 ? "In " + hours + " hours" : hours + " hours ago";
  }
  const days = Math.round(hours / 24);
  return delta >= 0 ? "In " + days + " days" : days + " days ago";
}

function threadTitle(
  runId: string | undefined,
  threads: Array<{ id: string; title: string; status: string }>,
): string {
  if (!runId) return "Unknown thread";
  return threads.find((thread) => thread.id === runId)?.title ?? runId;
}
