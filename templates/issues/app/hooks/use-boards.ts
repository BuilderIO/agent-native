import { useActionQuery } from "@agent-native/core/client";

export function useBoards(enabled = true) {
  return useActionQuery<any>("list-boards", undefined, {
    enabled,
    staleTime: 60_000,
  });
}

export function useSprints(boardId: string | number | undefined) {
  return useActionQuery<any>(
    "list-sprints",
    boardId ? { boardId: String(boardId) } : undefined,
    {
      enabled: !!boardId,
      staleTime: 30_000,
    },
  );
}

export function useSprintIssues(sprintId: string | number | undefined) {
  return useActionQuery<any>(
    "get-sprint-issues",
    sprintId ? { sprintId: String(sprintId) } : undefined,
    {
      enabled: !!sprintId,
      staleTime: 30_000,
    },
  );
}

export function useBoardConfig(boardId: string | number | undefined) {
  return useActionQuery<any>(
    "get-board-config",
    boardId ? { boardId: String(boardId) } : undefined,
    {
      enabled: !!boardId,
      staleTime: 60_000,
    },
  );
}
