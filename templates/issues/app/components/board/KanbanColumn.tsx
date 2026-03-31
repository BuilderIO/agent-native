import { useState, useCallback } from "react";
import { KanbanCard } from "./KanbanCard";
import { cn } from "@/lib/utils";
import type { JiraIssue } from "@shared/types";

interface KanbanColumnProps {
  name: string;
  issues: JiraIssue[];
  onDrop: (issueKey: string) => void;
  onIssueClick: (issueKey: string) => void;
}

export function KanbanColumn({
  name,
  issues,
  onDrop,
  onIssueClick,
}: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const issueKey = e.dataTransfer.getData("text/plain");
      if (issueKey) onDrop(issueKey);
    },
    [onDrop],
  );

  return (
    <div
      className={cn(
        "kanban-column flex w-64 shrink-0 flex-col rounded-lg bg-muted/30",
        dragOver && "drag-over",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          {name}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {issues.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {issues.map((issue) => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            onClick={() => onIssueClick(issue.key)}
          />
        ))}
      </div>
    </div>
  );
}
