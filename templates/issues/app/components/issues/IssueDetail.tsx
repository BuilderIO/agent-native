import { useState } from "react";
import { Link } from "react-router";
import {
  X,
  ExternalLink,
  MessageSquare,
  History,
  ListTree,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIssue } from "@/hooks/use-issues";
import { IssueProperties } from "./IssueProperties";
import { IssueDescription } from "./IssueDescription";
import { IssueComments } from "./IssueComments";
import { IssueActivity } from "./IssueActivity";
import type { JiraIssue } from "@shared/types";

interface IssueDetailProps {
  issueKey: string;
  closePath: string;
}

export function IssueDetail({ issueKey, closePath }: IssueDetailProps) {
  const { data: issue, isLoading } = useIssue(issueKey);
  const [activeTab, setActiveTab] = useState<"comments" | "activity">(
    "comments",
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Issue not found</div>
      </div>
    );
  }

  const jiraIssue = issue as JiraIssue;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">
            {issueKey}
          </span>
          {jiraIssue.self && (
            <a
              href={`https://${new URL(jiraIssue.self).hostname.replace("api.atlassian.com", "")}/browse/${issueKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <Link
          to={closePath}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex-1 overflow-y-auto p-6">
          <h1 className="text-lg font-semibold text-foreground">
            {jiraIssue.fields.summary}
          </h1>

          {/* Description */}
          <div className="mt-6">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </h3>
            <IssueDescription description={jiraIssue.fields.description} />
          </div>

          {/* Subtasks */}
          {jiraIssue.fields.subtasks &&
            jiraIssue.fields.subtasks.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <ListTree className="h-3.5 w-3.5" />
                  Subtasks ({jiraIssue.fields.subtasks.length})
                </h3>
                <div className="space-y-1">
                  {jiraIssue.fields.subtasks.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 rounded-md border border-border/30 px-3 py-2"
                    >
                      <span className="text-[12px] text-muted-foreground">
                        {sub.key}
                      </span>
                      <span className="flex-1 truncate text-[13px] text-foreground">
                        {sub.fields.summary}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          sub.fields.status.statusCategory.key === "done"
                            ? "status-done"
                            : sub.fields.status.statusCategory.key ===
                                "indeterminate"
                              ? "status-indeterminate"
                              : "status-new",
                        )}
                      >
                        {sub.fields.status.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Tabs: Comments / Activity */}
          <div className="mt-6">
            <div className="flex gap-4 border-b border-border">
              <button
                onClick={() => setActiveTab("comments")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] font-medium",
                  activeTab === "comments"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Comments
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] font-medium",
                  activeTab === "activity"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <History className="h-3.5 w-3.5" />
                Activity
              </button>
            </div>

            <div className="mt-4">
              {activeTab === "comments" ? (
                <IssueComments issueKey={issueKey} />
              ) : (
                <IssueActivity issue={jiraIssue} />
              )}
            </div>
          </div>
        </div>

        {/* Properties sidebar */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-border">
          <IssueProperties issue={jiraIssue} />
        </div>
      </div>
    </div>
  );
}
