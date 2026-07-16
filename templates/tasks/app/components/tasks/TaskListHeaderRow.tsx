import type { TaskFieldValue } from "@/hooks/use-custom-fields";
import type { TaskWithFields } from "@/hooks/use-tasks";
import {
  TASK_CARD_FIELD_LIMIT,
  useVisibleTaskFieldIds,
} from "@/hooks/use-visible-task-fields";

function TaskListFieldStripHeader({ fields }: { fields?: TaskFieldValue[] }) {
  const { fieldIds } = useVisibleTaskFieldIds();
  const items = fieldIds.slice(0, TASK_CARD_FIELD_LIMIT).map((fieldId) => {
    const field = fields?.find((candidate) => candidate.id === fieldId);
    return { id: fieldId, title: field?.title ?? fieldId };
  });

  return (
    <div
      className="grid items-center gap-2 text-xs font-medium text-muted-foreground"
      style={{
        gridTemplateColumns: `repeat(${Math.min(fieldIds.length, TASK_CARD_FIELD_LIMIT)}, minmax(6.5rem, 8rem))`,
      }}
      aria-hidden="true"
    >
      {items.map((item) => (
        <div key={item.id} className="truncate px-2">
          {item.title}
        </div>
      ))}
    </div>
  );
}

export function TaskListHeaderRow({
  task,
}: {
  task: TaskWithFields | undefined;
}) {
  return (
    <div className="hidden items-center gap-3 px-3 mb-2 text-xs font-medium text-muted-foreground md:flex">
      <div className="size-8 shrink-0" />
      <div className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 px-3">Task</div>
      <TaskListFieldStripHeader fields={task?.fields} />
      <div className="size-8 shrink-0" />
    </div>
  );
}
