import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type { ImageFoldersResponse } from "@shared/api";

export function useImageFolders() {
  return useQuery<ImageFoldersResponse>({
    queryKey: ["image-folders"],
    queryFn: async () => {
      const res = await authFetch("/api/shared/image-folders");
      if (!res.ok) throw new Error("Failed to fetch image folders");
      return res.json();
    },
  });
}
