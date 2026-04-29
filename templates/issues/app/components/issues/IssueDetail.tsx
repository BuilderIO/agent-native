import { Link } from "react-router";
import {
  IconX,
  IconArrowLeft,
  IconMessage,
  IconHistory,
  IconListTree,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useIssue } from "@/hooks/use-issues";
import { IssueProperties } from "./IssueProperties";
import { IssueDescription } from "./IssueDescription";
import { IssueComments } from "./IssueComments";
import { IssueActivity } from "./IssueActivity";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { JiraIssue } from "@shared/types";

interface IssueDetailProps {
  issueKey: string;
  closePath: string;
}

export function IssueDetail({ issueKey, closePath }: IssueDetailProps) {
  const { data: issue, isLoading } = useIssue(issueKey);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
          <div className="space-y-2 pt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 flex-1 max-w-xs" />
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
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
      <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <Link
            to={closePath}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-[13px] font-medium text-muted-foreground">
            {issueKey}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={closePath}
            className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:flex"
          >
            <IconX className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 sm:p-5">
          <h1 className="text-base font-semibold text-foreground leading-snug">
            {jiraIssue.fields.summary}
          </h1>

          {/* Properties inline */}
          <div className="mt-4">
            <IssueProperties issue={jiraIssue} />
          </div>

          {/* Description */}
          <div className="mt-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </h3>
            <IssueDescription description={jiraIssue.fields.description} />
          </div>

          {/* Subtasks */}
          {jiraIssue.fields.subtasks &&
            jiraIssue.fields.subtasks.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <IconListTree className="h-3.5 w-3.5" />
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
          <Tabs defaultValue="comments" className="mt-5">
            <TabsList>
              <TabsTrigger value="comments" className="gap-1.5">
                <IconMessage className="h-3.5 w-3.5" />
                Comments
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5">
                <IconHistory className="h-3.5 w-3.5" />
                Activity
              </TabsTrigger>
            </TabsList>
            <TabsContent value="comments" className="mt-4">
              <IssueComments issueKey={issueKey} />
            </TabsContent>
            <TabsContent value="activity" className="mt-4">
              <IssueActivity issue={jiraIssue} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
