import { useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { cn } from "@/lib/utils";
import { useBoardConfig } from "@/hooks/use-boards";
import { useIssues } from "@/hooks/use-issues";
import { useTransitionIssue } from "@/hooks/use-transitions";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { Skeleton } from "@/components/ui/skeleton";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

interface BoardPageProps {
  boardId: string;
  selectedIssueKey?: string;
}

export function BoardPage({
  boardId: propBoardId,
  selectedIssueKey: propIssueKey,
}: BoardPageProps) {
  const params = useParams();
  const boardId = propBoardId || params.boardId || "";
  const selectedIssueKey = propIssueKey || params.issueKey;
  const { data: boardConfig, isLoading: configLoading } =
    useBoardConfig(boardId);
  const navigate = useNavigate();

  // Get issues via JQL for the board's project
  const projectKey = boardConfig?.location?.projectKey;
  const { data: issuesData, isLoading: issuesLoading } = useIssues({
    view: "project",
    projectKey: projectKey || undefined,
    maxResults: 100,
  });

  const transitionMutation = useTransitionIssue();

  const issues = issuesData?.issues || [];
  const columns = boardConfig?.columnConfig?.columns || [];

  const handleDrop = useCallback(
    (issueKey: string, columnName: string) => {
      // Find the status in the column to determine the right transition
      const column = columns.find((c: any) => c.name === columnName);
      if (!column) return;

      // We need to fetch transitions for this issue to find the right one
      fetch(
        `/_agent-native/actions/get-transitions?key=${encodeURIComponent(issueKey)}`,
      )
        .then((r) => r.json())
        .then((data) => {
          const transitions = data.transitions || [];
          // Find a transition that matches the target column
          const targetStatuses = column.statuses?.map((s: any) => s.id) || [];
          const transition = transitions.find((t: any) =>
            targetStatuses.includes(t.to?.id),
          );
          if (transition) {
            transitionMutation.mutate({
              issueKey,
              transitionId: transition.id,
            });
          }
        })
        .catch(() => {});
    },
    [columns, transitionMutation],
  );

  const isLoading = configLoading || issuesLoading;

  useSetPageTitle(
    <h1 className="truncate text-sm font-semibold text-foreground">
      {boardConfig?.name || "Board"}
    </h1>,
  );

  return (
    <div className="flex h-full w-full min-w-0">
      <div
        className={cn(
          "flex flex-col overflow-hidden",
          selectedIssueKey
            ? "hidden lg:flex lg:w-1/2 lg:min-w-[280px] lg:border-r lg:border-border"
            : "min-w-0 flex-1",
        )}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-3 sm:p-4">
          {isLoading ? (
            <div className="flex h-full gap-3">
              {Array.from({ length: 4 }).map((_, col) => (
                <div
                  key={col}
                  className="flex w-72 shrink-0 flex-col gap-2 rounded-md border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-6 rounded-full" />
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    {Array.from({ length: 3 + ((col * 2) % 3) }).map((_, j) => (
                      <div
                        key={j}
                        className="space-y-2 rounded-md border border-border bg-background p-3"
                      >
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <div className="flex items-center justify-between pt-1">
                          <Skeleton className="h-4 w-12 rounded" />
                          <Skeleton className="h-5 w-5 rounded-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <KanbanBoard
              columns={columns}
              issues={issues}
              onDrop={handleDrop}
              onIssueClick={(key) => navigate(`/board/${boardId}/${key}`)}
            />
          )}
        </div>
      </div>

      {selectedIssueKey && (
        <div className="min-w-0 flex-1 overflow-hidden">
          <IssueDetail
            issueKey={selectedIssueKey}
            closePath={`/board/${boardId}`}
          />
        </div>
      )}
    </div>
  );
}
