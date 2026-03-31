import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { IssueListItem } from "./IssueListItem";
import { groupIssuesByStatusCategory } from "@/lib/issue-utils";
import type { JiraIssue } from "@shared/types";
import { cn } from "@/lib/utils";

interface IssueListProps {
  issues: JiraIssue[];
  basePath: string;
  selectedIssueKey?: string;
  focusedIndex?: number;
  grouped?: boolean;
}

export function IssueList({
  issues,
  basePath,
  selectedIssueKey,
  focusedIndex,
  grouped = true,
}: IssueListProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  if (!grouped) {
    return (
      <div>
        {issues.map((issue, i) => (
          <IssueListItem
            key={issue.id}
            issue={issue}
            basePath={basePath}
            focused={focusedIndex === i}
            selected={issue.key === selectedIssueKey}
          />
        ))}
      </div>
    );
  }

  const groups = groupIssuesByStatusCategory(issues);
  let globalIndex = 0;

  return (
    <div>
      {groups.map((group) => {
        const isCollapsed = collapsedGroups[group.categoryKey];
        const startIndex = globalIndex;

        if (!isCollapsed) {
          globalIndex += group.issues.length;
        }

        return (
          <div key={group.categoryKey}>
            <button
              onClick={() =>
                setCollapsedGroups((prev) => ({
                  ...prev,
                  [group.categoryKey]: !prev[group.categoryKey],
                }))
              }
              className="flex w-full items-center gap-2 border-b border-border/30 bg-muted/30 px-4 py-2 text-left"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              )}
              <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {group.issues.length}
              </span>
            </button>
            {!isCollapsed &&
              group.issues.map((issue, i) => (
                <IssueListItem
                  key={issue.id}
                  issue={issue}
                  basePath={basePath}
                  focused={focusedIndex === startIndex + i}
                  selected={issue.key === selectedIssueKey}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
