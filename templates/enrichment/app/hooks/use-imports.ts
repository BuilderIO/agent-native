import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@shared/api";
import type { ImportRecord } from "@shared/types";

/**
 * Lists imports from `/api/imports`.
 * Query key `["imports"]` is invalidated by `useFileWatcher` in `app/root.tsx` on file changes.
 */
export function useImports() {
  const { data, ...rest } = useQuery<ImportRecord[]>({
    queryKey: ["imports"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/imports`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json() as Promise<ImportRecord[]>;
    },
  });

  return { imports: data ?? [], ...rest };
}

export function useImport(id: string | null) {
  return useQuery<ImportRecord>({
    queryKey: ["imports", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/imports/${id}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json() as Promise<ImportRecord>;
    },
    enabled: !!id,
  });
}
