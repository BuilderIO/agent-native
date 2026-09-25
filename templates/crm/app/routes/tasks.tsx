import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconCheck, IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  LoadingRows,
  PageHeader,
  SetupEmptyState,
} from "@/components/crm/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizeTasks } from "@/lib/types";

interface ManageTaskInput {
  taskId?: string;
  title?: string;
  description?: string;
  dueAt?: string;
  status?: "open" | "done" | "cancelled";
}

export default function TasksRoute() {
  const query = useActionQuery<unknown>(
    "list-crm-tasks" as never,
    { limit: 100 } as never,
  );
  const manage = useActionMutation<unknown, ManageTaskInput>(
    "manage-crm-task" as never,
  );
  const tasks = normalizeTasks(query.data);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());

  async function setStatus(
    taskId: string,
    status: "open" | "done" | "cancelled",
  ) {
    setPendingTaskIds((current) => new Set(current).add(taskId));
    try {
      await manage.mutateAsync({ taskId, status });
      toast.success(status === "done" ? "Task completed." : "Task updated.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Task update failed.";
      toast.error(
        message.includes("mirrored provider task")
          ? "This is a mirrored provider task. Create a CRM proposal or complete it upstream."
          : message,
      );
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        description="Local follow-up work connected to the records you can access."
        actions={<CreateTaskDialog mutation={manage} />}
      />
      {query.isLoading ? (
        <LoadingRows rows={7} />
      ) : tasks.length ? (
        <div className="divide-y divide-border/70">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-7"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{task.title}</p>
                  <Badge variant="secondary" className="font-normal capitalize">
                    {task.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.dueAt ? `Due ${formatDate(task.dueAt)}` : "No due date"}
                  {task.recordId ? (
                    <>
                      {" · "}
                      <Link
                        to={`/records/${encodeURIComponent(task.recordId)}`}
                        className="underline-offset-4 hover:underline"
                      >
                        Open record
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {task.status !== "done" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={pendingTaskIds.has(task.id)}
                    onClick={() => void setStatus(task.id, "done")}
                  >
                    <IconCheck className="size-4" /> Complete
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pendingTaskIds.has(task.id)}
                    onClick={() => void setStatus(task.id, "open")}
                  >
                    Reopen
                  </Button>
                )}
                {task.status !== "cancelled" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pendingTaskIds.has(task.id)}
                    aria-label={`Cancel ${task.title}`}
                    onClick={() => void setStatus(task.id, "cancelled")}
                  >
                    <IconX className="size-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title="No follow-up tasks"
          description="Create a task here or from a CRM record to keep the next action visible."
        />
      )}
    </>
  );
}

function CreateTaskDialog({
  mutation,
}: {
  mutation: {
    isPending: boolean;
    mutateAsync: (input: ManageTaskInput) => Promise<unknown>;
  };
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");

  async function createTask() {
    try {
      await mutation.mutateAsync({
        title,
        description: description || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        status: "open",
      });
      setOpen(false);
      setTitle("");
      setDescription("");
      setDueAt("");
      toast.success("Task created.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Task creation failed.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <IconPlus className="size-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create follow-up task</DialogTitle>
          <DialogDescription>
            Tasks are local by default and never write to the provider silently.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              maxLength={2_000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => void createTask()}
            disabled={!title.trim() || mutation.isPending}
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
