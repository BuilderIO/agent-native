import { useQuery } from "@tanstack/react-query";

export function useBoards() {
  return useQuery({
    queryKey: ["boards"],
    queryFn: async () => {
      const res = await fetch("/api/boards");
      if (!res.ok) throw new Error("Failed to fetch boards");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useSprints(boardId: string | number | undefined) {
  return useQuery({
    queryKey: ["sprints", boardId],
    queryFn: async () => {
      const res = await fetch(`/api/boards/${boardId}/sprints`);
      if (!res.ok) throw new Error("Failed to fetch sprints");
      return res.json();
    },
    enabled: !!boardId,
    staleTime: 30_000,
  });
}

export function useSprintIssues(sprintId: string | number | undefined) {
  return useQuery({
    queryKey: ["sprint-issues", sprintId],
    queryFn: async () => {
      const res = await fetch(`/api/sprints/${sprintId}/issues`);
      if (!res.ok) throw new Error("Failed to fetch sprint issues");
      return res.json();
    },
    enabled: !!sprintId,
    staleTime: 30_000,
  });
}

export function useBoardConfig(boardId: string | number | undefined) {
  return useQuery({
    queryKey: ["board-config", boardId],
    queryFn: async () => {
      const res = await fetch(`/api/boards/${boardId}/configuration`);
      if (!res.ok) throw new Error("Failed to fetch board config");
      return res.json();
    },
    enabled: !!boardId,
    staleTime: 60_000,
  });
}
