import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useSprints, useSprintIssues } from "@/hooks/use-boards";
import { IssueList } from "@/components/issues/IssueList";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

interface SprintPageProps {
  boardId: string;
  selectedIssueKey?: string;
}

export function SprintPage({
  boardId: propBoardId,
  selectedIssueKey: propIssueKey,
}: SprintPageProps) {
  const params = useParams();
  const boardId = propBoardId || params.boardId || "";
  const selectedIssueKey = propIssueKey || params.issueKey;
  const { data: sprintsData, isLoading: sprintsLoading } = useSprints(boardId);
  const sprints = sprintsData?.values || [];

  const activeSprint = sprints.find((s: any) => s.state === "active");
  const futureSprints = sprints.filter((s: any) => s.state === "future");

  const { data: sprintIssuesData, isLoading: issuesLoading } = useSprintIssues(
    activeSprint?.id,
  );
  const sprintIssues = sprintIssuesData?.issues || [];

  const isLoading = sprintsLoading || issuesLoading;

  useSetPageTitle(
    <h1 className="truncate text-sm font-semibold text-foreground">
      Sprint Planning
    </h1>,
  );

  return (
    <div className="flex h-full w-full min-w-0">
      <div
        className={cn(
          "flex flex-col overflow-hidden",
          selectedIssueKey
            ? "hidden lg:flex lg:w-[320px] lg:min-w-[200px] lg:border-r lg:border-border"
            : "min-w-0 flex-1",
        )}
      >
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b border-border/30 bg-muted/30 px-3 py-2.5 sm:px-4">
                <Skeleton className="h-4 w-12 rounded-full" />
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="ml-auto h-3 w-14" />
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-border/30 px-3 py-2.5 sm:px-4"
                >
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="ml-auto h-5 w-5 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Active Sprint */}
              {activeSprint && (
                <div>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border/30 bg-muted/30 px-3 py-2.5 sm:px-4">
                    <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-green-500/15 px-1.5 text-[10px] font-medium text-green-500">
                      ACTIVE
                    </span>
                    <span className="text-[13px] font-semibold text-foreground">
                      {activeSprint.name}
                    </span>
                    {activeSprint.goal && (
                      <span className="hidden text-[12px] text-muted-foreground sm:inline">
                        — {activeSprint.goal}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {sprintIssues.length} issues
                    </span>
                  </div>
                  <IssueList
                    issues={sprintIssues}
                    basePath={`/sprint/${boardId}`}
                    selectedIssueKey={selectedIssueKey}
                  />
                </div>
              )}

              {/* Future Sprints */}
              {futureSprints.map((sprint: any) => (
                <div key={sprint.id}>
                  <div className="flex items-center gap-2 border-b border-border/30 bg-muted/30 px-3 py-2.5 sm:px-4">
                    <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                      FUTURE
                    </span>
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {sprint.name}
                    </span>
                  </div>
                </div>
              ))}

              {!activeSprint && futureSprints.length === 0 && (
                <div className="flex h-32 items-center justify-center">
                  <span className="text-sm text-muted-foreground">
                    No sprints found for this board
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedIssueKey && (
        <div className="min-w-0 flex-1 overflow-hidden">
          <IssueDetail
            issueKey={selectedIssueKey}
            closePath={`/sprint/${boardId}`}
          />
        </div>
      )}
    </div>
  );
}
