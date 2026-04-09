import { useActionQuery } from "@agent-native/core/client";

export function useProjects() {
  return useActionQuery<any>("list-projects", undefined, {
    staleTime: 60_000,
  });
}

export function useProject(projectKey: string | undefined) {
  return useActionQuery<any>(
    "get-project",
    projectKey ? { projectKey } : undefined,
    {
      enabled: !!projectKey,
      staleTime: 60_000,
    },
  );
}
