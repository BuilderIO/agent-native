import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AssetInfo, BrandConfig } from "@shared/types";

export function useBrandConfig() {
  return useQuery<BrandConfig>({
    queryKey: ["brand", "config"],
    queryFn: () => fetch("/api/brand/config").then((r) => r.json()),
  });
}

export function useUpdateBrandConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: BrandConfig) =>
      fetch("/api/brand/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand", "config"] }),
  });
}

export function useBrandAssets(category?: string) {
  const params = category ? `?category=${category}` : "";
  return useQuery<AssetInfo[]>({
    queryKey: ["brand", "assets", category],
    queryFn: () => fetch(`/api/brand/assets${params}`).then((r) => r.json()),
  });
}

export function useUploadAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, category }: { file: File; category: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/brand/upload?category=${category}`, {
        method: "POST",
        body: formData,
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand", "assets"] }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ category, filename }: { category: string; filename: string }) =>
      fetch(`/api/brand/assets/${category}/${filename}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand", "assets"] }),
  });
}
