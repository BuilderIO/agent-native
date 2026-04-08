import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AgentToggleButton } from "@agent-native/core/client";
import { useSprints, useSprintIssues } from "@/hooks/use-boards";
import { IssueList } from "@/components/issues/IssueList";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { cn } from "@/lib/utils";

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

  return (
    <div className="flex h-full">
      <div
        className={cn(
          "flex flex-col overflow-hidden",
          selectedIssueKey
            ? "hidden lg:flex lg:w-[340px] lg:shrink-0 lg:border-r lg:border-border"
            : "flex-1",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-3 sm:gap-3 sm:px-4">
          <h1 className="text-sm font-semibold text-foreground">
            Sprint Planning
          </h1>
          <div className="flex-1" />
          <AgentToggleButton className="h-9 w-9 rounded-md border border-border bg-background" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <span className="text-sm text-muted-foreground">Loading...</span>
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
