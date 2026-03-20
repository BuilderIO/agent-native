import { useQuery } from "@tanstack/react-query";
import type { StyleProfile } from "@shared/types";

export function useStyleProfile() {
  return useQuery<StyleProfile>({
    queryKey: ["brand", "style-profile"],
    queryFn: () => fetch("/api/brand/style-profile").then((r) => r.json()),
  });
}
