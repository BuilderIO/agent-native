import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconDots,
  IconPaperclip,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";

/**
 * The workspace's scheduled tasks.
 *
 * The source's Tasks tab lists the signed-in member's own tasks and opens a
 * create dialog whose first control is the prompt the agent runs each time
 * (components/tasks/TasksPage.tsx:25, TasksHeader.tsx:44 "New task",
 * TasksEmptyState.tsx:80 "No tasks yet", taskModal/TaskPromptSection.tsx:171
 * for the prompt placeholder). Every field here is backed by the framework's
 * automation store through create-scheduled-task; the source's model picker and
 * notification destinations are not offered because this app has no model list
 * or notification destination to name, and a control that cannot be backed is
 * not rendered.
 *
 * A task's row carries what the source's task header carries: Run now
 * (TaskHeaderActions.tsx:257) and a "Task actions" menu with Pause/Resume and
 * Delete (:280, :295). Both call the framework's own automation actions, so a
 * run is the real run and a delete is a real delete.
 */
type Task = {
  id: string;
  name: string;
  scope: "personal" | "organization";
  schedule: string;
  timezone: string;
  enabled: boolean;
  nextRun: string | null;
  expiresAt?: string | null;
  lastRun: string | null;
  lastStatus: string | null;
  lastError: string | null;
  canUpdate: boolean;
};

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_DAYS = Array.from({ length: 28 }, (_, index) => index + 1);

const timezone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

export function TasksPage() {
  const t = useT();
  // list-scheduled-tasks answers with the rows themselves. Reading a `tasks`
  // wrapper left every created task invisible behind the empty state.
  const tasks = useActionQuery<Task[]>("list-scheduled-tasks", {});
  const createTask = useActionMutation("create-scheduled-task");
  const runNow = useActionMutation("run-automation-now");
  // The source's prompt composer attaches files with a "+" control; the file is
  // stored by the framework's upload registry and named on the task.
  const attachFile = useActionMutation("attach-task-file");
  // The source puts a model picker in the prompt's footer (TaskPromptSection
  // AgentModelEffortPicker), so a task runs on the model the user picked. The
  // list comes from the framework's own model description action.
  const models = useActionQuery<{
    models?: Array<{ modelId: string; name?: string; shortName?: string }>;
  }>("describe-models", {});
  // The source's notification section (taskModal/TaskNotificationSection.tsx):
  // a run can be sent to people, groups or a Slack channel. The list is what
  // this workspace can actually deliver to, so an empty kind is not offered.
  const destinations = useActionQuery<
    Array<{
      kind: "user" | "group" | "slack";
      id: string;
      label: string;
      platform: string;
    }>
  >("list-task-destinations", {});
  const manageAutomation = useActionMutation("manage-automation");
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] =
    useState<(typeof CADENCES)[number]["value"]>("weekly");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [model, setModel] = useState("");
  const [endDate, setEndDate] = useState("");
  const [destination, setDestination] = useState("");
  const [attachments, setAttachments] = useState<
    Array<{ id: string; url: string; label: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const rows = Array.isArray(tasks.data) ? tasks.data : [];
  const destinationOptions = Array.isArray(destinations.data)
    ? destinations.data
    : [];
  const chosenDestination = destinationOptions.find(
    (option) => `${option.kind}:${option.id}` === destination,
  );
  const submit = useCallback(async () => {
    setError(null);
    const promptText = prompt.trim();
    if (title.trim() === "") {
      setError("Title is required for task");
      return;
    }
    if (promptText === "") {
      setError("Prompt is required for task");
      return;
    }
    if (!/^\d{1,2}$/.test(hour.trim()) || Number(hour) > 23) {
      setError("The hour must be between 0 and 23.");
      return;
    }
    if (!/^\d{1,2}$/.test(minute.trim()) || Number(minute) > 59) {
      setError("The minute must be between 0 and 59.");
      return;
    }
    try {
      await createTask.mutateAsync({
        operation: "create",
        title: title.trim(),
        prompt: promptText,
        schedule: {
          cadence,
          hour: Number(hour.trim()),
          minute: Number(minute.trim()),
          timezone,
          ...(cadence === "weekly" ? { dayOfWeek: Number(dayOfWeek) } : {}),
          ...(cadence === "monthly" ? { dayOfMonth: Number(dayOfMonth) } : {}),
        },
        ...(model ? { model } : {}),
        ...(endDate ? { endDate } : {}),
        ...(chosenDestination
          ? {
              notification: {
                platform: chosenDestination.platform,
                destination: chosenDestination.id,
              },
            }
          : {}),
        scope: "personal" as const,
      });
      setOpen(false);
      setTitle("");
      setPrompt("");
      setModel("");
      setEndDate("");
      setDestination("");
      setAttachments([]);
      await tasks.refetch();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The task could not be created.",
      );
    }
  }, [
    cadence,
    chosenDestination,
    createTask,
    dayOfMonth,
    dayOfWeek,
    endDate,
    hour,
    minute,
    model,
    prompt,
    tasks,
    title,
  ]);

  return (
    <div
      className="ws-tasks"
      data-list-page="tasks"
      style={{
        padding: "24px 32px",
        maxWidth: 900,
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Tasks</h1>
        <Button onClick={() => setOpen(true)}>
          <IconPlus size={16} aria-hidden="true" />
          New task
        </Button>
      </div>

      <div
        className="analytics-workspace-list-content"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {tasks.isLoading ? (
          <p style={{ opacity: 0.7 }}>Loading tasks…</p>
        ) : tasks.error ? (
          <p role="alert" style={{ color: "var(--destructive, crimson)" }}>
            The tasks could not be read.
          </p>
        ) : rows.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            <svg
              data-testid="workspace-list-empty-illustration"
              width={240}
              height={240}
              viewBox="0 0 240 240"
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ opacity: 0.35, flexShrink: 0 }}
            >
              <rect x="50" y="40" width="140" height="160" rx="14" />
              <path d="M82 92l10 10 18-20M126 92h40" />
              <path d="M82 138l10 10 18-20M126 138h40" />
              <circle cx="170" cy="182" r="30" fill="var(--background, #fff)" />
              <path d="M170 166v16l11 7" />
            </svg>
            <p style={{ fontWeight: 600, margin: 0 }}>No tasks yet</p>
            <p style={{ margin: 0, opacity: 0.75, maxWidth: 420 }}>
              Tasks run an agent on a schedule, so a question you ask every week
              answers itself.
            </p>
            <div className="analytics-workspace-list-empty-actions">
              <Button variant="outline" onClick={() => setOpen(true)}>
                Create from scratch
              </Button>
            </div>
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {rows.map((task) => (
              <li
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{task.name}</div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    {task.schedule} · {task.timezone}
                    {task.nextRun ? ` · next run ${task.nextRun}` : ""}
                    {task.lastStatus ? ` · last run ${task.lastStatus}` : ""}
                    {task.expiresAt
                      ? ` · ends ${task.expiresAt.slice(0, 10)}`
                      : ""}
                    {task.enabled ? "" : " · paused"}
                  </div>
                  {task.lastError ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--destructive, crimson)",
                      }}
                    >
                      {task.lastError}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Button
                    size="sm"
                    disabled={!task.canUpdate || busyTaskId === task.id}
                    onClick={async () => {
                      setRowError(null);
                      setBusyTaskId(task.id);
                      try {
                        await runNow.mutateAsync({
                          resourceId: task.id,
                          scope: task.scope,
                        });
                      } catch (runError) {
                        setRowError(
                          runError instanceof Error
                            ? runError.message
                            : "The task could not run.",
                        );
                      } finally {
                        setBusyTaskId(null);
                        await tasks.refetch();
                      }
                    }}
                  >
                    <IconPlayerPlay size={15} aria-hidden="true" />
                    {busyTaskId === task.id ? "Running…" : "Run now"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Task actions"
                        disabled={!task.canUpdate}
                      >
                        <IconDots size={15} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          void (async () => {
                            await createTask.mutateAsync({
                              operation: task.enabled ? "pause" : "resume",
                              taskId: task.id,
                              scope: task.scope,
                            });
                            await tasks.refetch();
                          })();
                        }}
                      >
                        {task.enabled ? "Pause" : "Resume"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        style={{ color: "var(--destructive, crimson)" }}
                        onSelect={() => {
                          void (async () => {
                            setRowError(null);
                            try {
                              await manageAutomation.mutateAsync({
                                operation: "delete",
                                resourceId: task.id,
                                scope: task.scope,
                              });
                            } catch (deleteError) {
                              setRowError(
                                deleteError instanceof Error
                                  ? deleteError.message
                                  : "The task could not be deleted.",
                              );
                            }
                            await tasks.refetch();
                          })();
                        }}
                      >
                        <IconTrash size={14} aria-hidden="true" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rowError ? (
        <p
          role="alert"
          style={{ marginTop: 12, color: "var(--destructive, crimson)" }}
        >
          {rowError}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setError(null);
          setOpen(next);
        }}
      >
        <DialogContent
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              paddingBlock: 8,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label htmlFor="task-prompt">Prompt</Label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <IconPaperclip size={14} aria-hidden="true" />
                  <span aria-hidden="true">+</span>
                  <span className="sr-only">Attach file</span>
                  <input
                    type="file"
                    aria-label="Attach file"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      void (async () => {
                        setError(null);
                        try {
                          const dataBase64 = await new Promise<string>(
                            (resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => {
                                const result = String(reader.result ?? "");
                                resolve(result.slice(result.indexOf(",") + 1));
                              };
                              reader.onerror = () =>
                                reject(
                                  reader.error ?? new Error("read failed"),
                                );
                              reader.readAsDataURL(file);
                            },
                          );
                          const stored = (await attachFile.mutateAsync({
                            filename: file.name,
                            mimeType: file.type || "application/octet-stream",
                            dataBase64,
                          })) as { id: string; url: string; label: string };
                          setAttachments((current) => [...current, stored]);
                          setPrompt(
                            (current) =>
                              `${current}${current.trim() ? "\n\n" : ""}[${stored.label}](${stored.url})`,
                          );
                        } catch (attachError) {
                          setError(
                            attachError instanceof Error
                              ? attachError.message
                              : "The file could not be attached.",
                          );
                        }
                      })();
                    }}
                  />
                </label>
                {attachments.map((item) => (
                  <span
                    key={item.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                    }}
                  >
                    {item.label}
                    <button
                      type="button"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => {
                        setAttachments((current) =>
                          current.filter((entry) => entry.id !== item.id),
                        );
                        setPrompt((current) =>
                          current
                            .replace(`[${item.label}](${item.url})`, "")
                            .replace(/\n{3,}/g, "\n\n")
                            .trim(),
                        );
                      }}
                      style={{
                        border: 0,
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <Textarea
                id="task-prompt"
                value={prompt}
                rows={4}
                placeholder={t("analytics.tasks.instructionsPlaceholder")}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Select
                  value={model || "default"}
                  onValueChange={(value) =>
                    setModel(value === "default" ? "" : value)
                  }
                >
                  <SelectTrigger aria-label="Model" style={{ width: 220 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default model</SelectItem>
                    {(models.data?.models ?? []).map((option) => (
                      <SelectItem key={option.modelId} value={option.modelId}>
                        {option.shortName ?? option.name ?? option.modelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label htmlFor="task-title">Task name</Label>
              <Input
                id="task-title"
                value={title}
                placeholder="Weekly ARR summary"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <Label>Repeat</Label>
                  <Select
                    value={cadence}
                    onValueChange={(value) =>
                      setCadence(value as typeof cadence)
                    }
                  >
                    <SelectTrigger aria-label="Repeat">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CADENCES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {cadence === "weekly" ? (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <Label>Day</Label>
                    <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                      <SelectTrigger aria-label="Day of the week">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map((day, index) => (
                          <SelectItem key={day} value={String(index)}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {cadence === "monthly" ? (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <Label>Day of month</Label>
                    <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                      <SelectTrigger aria-label="Day of the month">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTH_DAYS.map((day) => (
                          <SelectItem key={day} value={String(day)}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <Label htmlFor="task-hour">Time</Label>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <Input
                      id="task-hour"
                      value={hour}
                      inputMode="numeric"
                      style={{ width: 56 }}
                      aria-label="Hour"
                      onChange={(event) => setHour(event.target.value)}
                    />
                    <span>:</span>
                    <Input
                      value={minute}
                      inputMode="numeric"
                      style={{ width: 56 }}
                      aria-label="Minute"
                      onChange={(event) => setMinute(event.target.value)}
                    />
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {timezone}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Label htmlFor="task-end-date">Expiration date</Label>
                <Input
                  id="task-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
            {destinationOptions.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Label htmlFor="task-notification">Send after every run</Label>
                <Select
                  value={destination || "none"}
                  onValueChange={(value) =>
                    setDestination(value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger
                    id="task-notification"
                    aria-label="Send after every run"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No notification</SelectItem>
                    {destinationOptions.map((option) => (
                      <SelectItem
                        key={`${option.kind}:${option.id}`}
                        value={`${option.kind}:${option.id}`}
                      >
                        {option.kind === "group"
                          ? `Group: ${option.label}`
                          : option.kind === "slack"
                            ? `Slack: ${option.label}`
                            : option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                style={{ margin: 0, color: "var(--destructive, crimson)" }}
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={createTask.isPending}
            >
              {createTask.isPending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TasksPage;
