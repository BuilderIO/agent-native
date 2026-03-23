import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";

export interface MediaFile {
  filename: string;
  url: string;
  type: "image" | "video";
  size: number;
  mimeType: string;
  modifiedAt: number;
}

function mediaQueryKey(projectSlug: string) {
  return ["project-media", projectSlug];
}

export function useProjectMedia(projectSlug: string | null) {
  return useQuery<{ files: MediaFile[] }>({
    queryKey: mediaQueryKey(projectSlug || ""),
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectSlug}/media`);
      if (!res.ok) throw new Error("Failed to fetch media");
      return res.json();
    },
    enabled: !!projectSlug,
  });
}

export function useBulkDeleteProjectMedia(projectSlug: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filenames: string[]) => {
      const res = await authFetch(
        `/api/projects/${projectSlug}/media/bulk-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filenames }),
        },
      );
      if (!res.ok) throw new Error("Bulk delete failed");
      return res.json();
    },
    onSuccess: () => {
      if (projectSlug) {
        queryClient.invalidateQueries({ queryKey: mediaQueryKey(projectSlug) });
      }
    },
  });
}

export function useDeleteProjectMedia(projectSlug: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filename: string) => {
      const res = await authFetch(
        `/api/projects/${projectSlug}/media/${filename}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      if (projectSlug) {
        queryClient.invalidateQueries({ queryKey: mediaQueryKey(projectSlug) });
      }
    },
  });
}
