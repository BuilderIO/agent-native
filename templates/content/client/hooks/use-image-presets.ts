import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { ImagePreset, ImagePresetsFile } from "@shared/api";

export type { ImagePreset };

export function useImagePresets() {
  const queryClient = useQueryClient();
  const migratedRef = useRef(false);

  const { data, isLoading } = useQuery<ImagePresetsFile>({
    queryKey: ["image-presets"],
    queryFn: async () => {
      const res = await authFetch("/api/image-presets");
      if (!res.ok) throw new Error("Failed to fetch presets");
      return res.json();
    },
  });

  // One-time migration from localStorage
  useEffect(() => {
    if (migratedRef.current || isLoading || !data) return;
    migratedRef.current = true;
    try {
      const stored = localStorage.getItem("image-gen:presets");
      if (!stored) return;
      const localPresets: ImagePreset[] = JSON.parse(stored);
      if (!localPresets.length) return;
      if (data.presets.length > 0) {
        // Server already has presets, just clear localStorage
        localStorage.removeItem("image-gen:presets");
        return;
      }
      // Migrate each preset to server
      Promise.all(
        localPresets.map((p) =>
          authFetch("/api/image-presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: p.name, paths: p.paths }),
          })
        )
      ).then(() => {
        localStorage.removeItem("image-gen:presets");
        queryClient.invalidateQueries({ queryKey: ["image-presets"] });
      });
    } catch {}
  }, [data, isLoading, queryClient]);

  const presets = data?.presets ?? [];

  const saveMutation = useMutation({
    mutationFn: async ({ name, paths }: { name: string; paths: string[] }) => {
      const res = await authFetch("/api/image-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, paths }),
      });
      if (!res.ok) throw new Error("Failed to save preset");
      return res.json() as Promise<ImagePreset>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-presets"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/image-presets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete preset");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-presets"] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Pick<ImagePreset, "name" | "paths" | "instructions">> }) => {
      const res = await authFetch(`/api/image-presets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update preset");
      return res.json() as Promise<ImagePreset>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-presets"] }),
  });

  return {
    presets,
    isLoading,
    savePreset: (name: string, paths: string[]) => saveMutation.mutate({ name, paths }),
    deletePreset: (id: string) => deleteMutation.mutate(id),
    updatePreset: (id: string, updates: Partial<Pick<ImagePreset, "name" | "paths" | "instructions">>) =>
      updateMutation.mutate({ id, updates }),
  };
}
