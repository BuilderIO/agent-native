import { ExtensionSlot } from "@agent-native/core/client/extensions";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconSparkles } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SidePanel } from "@/components/shared/SidePanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FieldValue, TaskFieldValue } from "@/hooks/use-custom-fields";
import { useUpdateTask, type TaskWithFields } from "@/hooks/use-tasks";

import { FieldValueControl } from "./controls/FieldValueControl";
import { TaskTitleSection } from "./TaskTitleSection";

type RouteSuggestion = {
  taskId: string;
  queue: string | null;
  queueProbability: number;
  queueConfidence: number;
  urgentProbability: number;
};

export function TaskFieldsSidebar({
  task,
  onClose,
}: {
  task: TaskWithFields | null;
  onClose: () => void;
}) {
  const t = useT();
  if (!task) return null;

  return (
    <SidePanel
      title={t("taskFields.panelTitle")}
      subtitle={t("taskFields.panelSubtitle")}
      closeLabel={t("taskFields.closeLabel")}
      onClose={onClose}
    >
      <TaskFieldsSidebarPanel task={task} />
    </SidePanel>
  );
}

function TaskFieldsSidebarPanel({ task }: { task: TaskWithFields }) {
  const t = useT();
  const fields = task.fields ?? [];
  const updateTask = useUpdateTask();
  const suggestRoute = useActionMutation<RouteSuggestion, { taskId: string }>(
    "suggest-task-route",
  );
  const applyRoute = useActionMutation<
    unknown,
    { taskId: string; queueName: string }
  >("apply-task-route");
  const [suggestion, setSuggestion] = useState<RouteSuggestion | null>(null);

  useEffect(() => setSuggestion(null), [task.id, task.title]);

  const requestSuggestion = async () => {
    try {
      setSuggestion(await suggestRoute.mutateAsync({ taskId: task.id }));
    } catch (caught) {
      toast.error((caught as Error)?.message ?? t("taskFields.routingError"));
    }
  };

  const applySuggestion = async () => {
    if (!suggestion?.queue) return;
    try {
      await applyRoute.mutateAsync({
        taskId: task.id,
        queueName: suggestion.queue,
      });
      setSuggestion(null);
    } catch (caught) {
      toast.error((caught as Error)?.message ?? t("taskFields.updateError"));
    }
  };

  const saveUpdate = useCallback(
    (payload: {
      title?: string;
      fieldValues?: Array<{ fieldId: string; value: FieldValue | null }>;
    }) => {
      void updateTask
        .mutateAsync({ taskId: task.id, ...payload })
        .catch((caught) => {
          toast.error(
            (caught as Error)?.message ?? t("taskFields.updateError"),
          );
        });
    },
    [task.id, updateTask, t],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <TaskTitleSection
        title={task.title}
        onChange={(title) => saveUpdate({ title })}
      />

      <section className="grid gap-2 border-b border-border/70 px-3 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start gap-2"
          disabled={suggestRoute.isPending}
          onClick={() => void requestSuggestion()}
        >
          <IconSparkles className="size-4" />
          {t("taskFields.suggestRoute")}
        </Button>
        {suggestion && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {suggestion.queue ?? t("taskFields.noQueueMatch")}
              {suggestion.queue &&
                ` (${Math.round(suggestion.queueProbability * 100)}%)`}
            </span>
            <span className="text-muted-foreground">
              {t("taskFields.urgentProbability", {
                percent: Math.round(suggestion.urgentProbability * 100),
              })}
            </span>
            {suggestion.queue && (
              <Button
                type="button"
                size="sm"
                disabled={applyRoute.isPending}
                onClick={() => void applySuggestion()}
              >
                {t("taskFields.applyRoute")}
              </Button>
            )}
          </div>
        )}
      </section>

      {fields.length === 0 ? (
        <div className="m-3 rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          {t("taskFields.noFieldsDefined")}
        </div>
      ) : (
        fields.map((field) => (
          <TaskFieldEditorSection
            key={field.id}
            field={field}
            value={field.value ?? null}
            onChange={(value) =>
              saveUpdate({ fieldValues: [{ fieldId: field.id, value }] })
            }
          />
        ))
      )}

      {/* Stable extension contract: changing this slot id or context requires a migration. */}
      <ExtensionSlot
        id="tasks.task-detail.bottom"
        context={{
          taskId: task.id,
          title: task.title,
          done: task.done,
          fieldValues: fields.map((field) => ({
            fieldId: field.id,
            value: field.value ?? null,
          })),
        }}
      />
    </div>
  );
}

function TaskFieldEditorSection({
  field,
  value,
  onChange,
}: {
  field: TaskFieldValue;
  value: FieldValue | null;
  onChange: (value: FieldValue | null) => void;
}) {
  return (
    <section className="grid gap-2 border-b border-border/70 px-3 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Label className="min-w-0 truncate text-[13px] font-medium">
          {field.title}
        </Label>
      </div>
      <FieldValueControl
        field={field}
        value={value}
        disabled={false}
        onChange={onChange}
      />
    </section>
  );
}
