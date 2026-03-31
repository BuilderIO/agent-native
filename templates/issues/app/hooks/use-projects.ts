import { useQuery } from "@tanstack/react-query";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useProject(projectKey: string | undefined) {
  return useQuery({
    queryKey: ["project", projectKey],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectKey}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
    enabled: !!projectKey,
    staleTime: 60_000,
  });
}
