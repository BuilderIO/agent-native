import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { useBoardConfig } from "@/hooks/use-boards";
import { useIssues } from "@/hooks/use-issues";
import { useTransitionIssue } from "@/hooks/use-transitions";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { KanbanBoard } from "@/components/board/KanbanBoard";

interface BoardPageProps {
  boardId: string;
  selectedIssueKey?: string;
}

export function BoardPage({ boardId, selectedIssueKey }: BoardPageProps) {
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
      fetch(`/api/issues/${issueKey}/transitions`)
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

  return (
    <div className="flex h-full">
      <div
        className={`flex flex-col overflow-hidden ${selectedIssueKey ? "flex-1 border-r border-border" : "flex-1"}`}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            {boardConfig?.name || "Board"}
          </h1>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <span className="text-sm text-muted-foreground">Loading...</span>
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
        <div className="w-[500px] shrink-0 overflow-hidden">
          <IssueDetail
            issueKey={selectedIssueKey}
            closePath={`/board/${boardId}`}
          />
        </div>
      )}
    </div>
  );
}
