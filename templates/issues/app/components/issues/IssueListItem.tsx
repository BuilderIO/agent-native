import { Link } from "react-router";
import {
  IconCircleDot,
  IconBug,
  IconBook,
  IconBolt,
  IconGitBranch,
  IconChevronUp,
  IconChevronDown,
  IconEqual,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import type { JiraIssue } from "@shared/types";

function PriorityIcon({ name }: { name?: string }) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower === "highest")
    return (
      <IconChevronUp className="h-3.5 w-3.5 text-red-500" strokeWidth={3} />
    );
  if (lower === "high")
    return <IconChevronUp className="h-3.5 w-3.5 text-orange-500" />;
  if (lower === "medium")
    return <IconEqual className="h-3.5 w-3.5 text-yellow-500" />;
  if (lower === "low")
    return <IconChevronDown className="h-3.5 w-3.5 text-blue-500" />;
  if (lower === "lowest")
    return <IconChevronDown className="h-3.5 w-3.5 text-gray-400" />;
  return null;
}

function IssueTypeIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("bug"))
    return <IconBug className="h-3.5 w-3.5 text-red-500" />;
  if (lower.includes("story"))
    return <IconBook className="h-3.5 w-3.5 text-green-500" />;
  if (lower.includes("epic"))
    return <IconBolt className="h-3.5 w-3.5 text-purple-500" />;
  if (lower.includes("sub"))
    return <IconGitBranch className="h-3.5 w-3.5 text-blue-400" />;
  return <IconCircleDot className="h-3.5 w-3.5 text-blue-500" />;
}

interface IssueListItemProps {
  issue: JiraIssue;
  basePath: string;
  focused?: boolean;
  selected?: boolean;
}

export function IssueListItem({
  issue,
  basePath,
  focused,
  selected,
}: IssueListItemProps) {
  const { fields } = issue;

  return (
    <Link
      to={`${basePath}/${issue.key}`}
      className={cn(
        "issue-row flex items-center gap-2 border-b border-border/30 px-3 py-3 sm:gap-3 sm:px-4 sm:py-2.5",
        focused && "focused",
        selected && "selected",
      )}
    >
      <IssueTypeIcon name={fields.issuetype?.name || "Task"} />

      <span className="hidden w-[80px] shrink-0 text-[12px] font-medium text-muted-foreground sm:inline">
        {issue.key}
      </span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
        {fields.summary}
      </span>

      <PriorityIcon name={fields.priority?.name} />

      {fields.assignee ? (
        <div
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground sm:flex"
          title={fields.assignee.displayName}
        >
          {fields.assignee.displayName
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
      ) : (
        <div className="hidden h-5 w-5 shrink-0 sm:block" />
      )}

      <StatusBadge status={fields.status} />
    </Link>
  );
}
