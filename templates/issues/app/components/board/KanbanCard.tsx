import { useCallback } from "react";
import {
  IconCircleDot,
  IconBug,
  IconBook,
  IconBolt,
  IconChevronUp,
  IconChevronDown,
  IconEqual,
} from "@tabler/icons-react";
import type { JiraIssue } from "@shared/types";

interface KanbanCardProps {
  issue: JiraIssue;
  onClick: () => void;
}

function PriorityIcon({ name }: { name?: string }) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower === "highest" || lower === "high")
    return <IconChevronUp className="h-3 w-3 text-orange-500" />;
  if (lower === "medium")
    return <IconEqual className="h-3 w-3 text-yellow-500" />;
  if (lower === "low" || lower === "lowest")
    return <IconChevronDown className="h-3 w-3 text-blue-500" />;
  return null;
}

function TypeIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("bug"))
    return <IconBug className="h-3 w-3 text-red-500" />;
  if (lower.includes("story"))
    return <IconBook className="h-3 w-3 text-green-500" />;
  if (lower.includes("epic"))
    return <IconBolt className="h-3 w-3 text-purple-500" />;
  return <IconCircleDot className="h-3 w-3 text-blue-500" />;
}

export function KanbanCard({ issue, onClick }: KanbanCardProps) {
  const { fields } = issue;

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", issue.key);
      e.dataTransfer.effectAllowed = "move";
    },
    [issue.key],
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      className="kanban-card cursor-pointer rounded-md border border-border bg-card p-3"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <TypeIcon name={fields.issuetype?.name || "Task"} />
        <span className="text-[11px] text-muted-foreground">{issue.key}</span>
      </div>
      <div className="text-[13px] font-medium leading-snug text-foreground">
        {fields.summary}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <PriorityIcon name={fields.priority?.name} />
        {fields.assignee && (
          <div
            className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-muted-foreground"
            title={fields.assignee.displayName}
          >
            {fields.assignee.displayName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}
