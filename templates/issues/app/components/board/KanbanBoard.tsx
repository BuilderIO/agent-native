import { KanbanColumn } from "./KanbanColumn";
import type { JiraIssue, JiraBoardColumn } from "@shared/types";

interface KanbanBoardProps {
  columns: JiraBoardColumn[];
  issues: JiraIssue[];
  onDrop: (issueKey: string, columnName: string) => void;
  onIssueClick: (issueKey: string) => void;
}

export function KanbanBoard({
  columns,
  issues,
  onDrop,
  onIssueClick,
}: KanbanBoardProps) {
  // Map issues to columns by status
  const columnIssues = columns.map((column) => {
    const statusIds = column.statuses?.map((s) => s.id) || [];
    const colIssues = issues.filter((issue) =>
      statusIds.includes(issue.fields.status.id),
    );
    return { column, issues: colIssues };
  });

  return (
    <div className="flex h-full gap-3">
      {columnIssues.map(({ column, issues: colIssues }) => (
        <KanbanColumn
          key={column.name}
          name={column.name}
          issues={colIssues}
          onDrop={(issueKey) => onDrop(issueKey, column.name)}
          onIssueClick={onIssueClick}
        />
      ))}
    </div>
  );
}
