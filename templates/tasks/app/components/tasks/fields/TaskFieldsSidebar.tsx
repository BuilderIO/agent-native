import { useCallback } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { SidePanel } from "@/components/shared/SidePanel";
import { useUpdateTask, type TaskWithFields } from "@/hooks/use-tasks";
import type { FieldValue, TaskFieldValue } from "@/hooks/use-custom-fields";
import { FieldValueControl } from "./controls/FieldValueControl";
import { TaskTitleSection } from "./TaskTitleSection";

export function TaskFieldsSidebar({
  task,
  onClose,
}: {
  task: TaskWithFields | null;
  onClose: () => void;
}) {
  if (!task) return null;

  return (
    <SidePanel
      title="Fields"
      subtitle="Task details"
      closeLabel="Close fields panel"
      onClose={onClose}
    >
      <TaskFieldsSidebarPanel task={task} />
    </SidePanel>
  );
}

function TaskFieldsSidebarPanel({ task }: { task: TaskWithFields }) {
  const fields = task.fields ?? [];
  const updateTask = useUpdateTask();

  const saveUpdate = useCallback(
    (payload: {
      title?: string;
      fieldValues?: Array<{ fieldId: string; value: FieldValue | null }>;
    }) => {
      void updateTask
        .mutateAsync({ taskId: task.id, ...payload })
        .catch((caught) => {
          toast.error((caught as Error)?.message ?? "Could not update task.");
        });
    },
    [task.id, updateTask],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <TaskTitleSection
        title={task.title}
        onChange={(title) => saveUpdate({ title })}
      />

      {fields.length === 0 ? (
        <div className="m-3 rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          No fields defined.
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
