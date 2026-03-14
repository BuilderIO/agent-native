import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type {
  ImageGenRequest,
  ImageGenResponse,
  ImageGenStatusResponse,
} from "@shared/api";

export function useImageGenStatus() {
  return useQuery<ImageGenStatusResponse>({
    queryKey: ["image-gen-status"],
    queryFn: async () => {
      const res = await authFetch("/api/image-gen/status");
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json();
    },
  });
}

export function useGenerateImage() {
  return useMutation<ImageGenResponse, Error, ImageGenRequest>({
    mutationFn: async (req) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const res = await authFetch("/api/image-gen/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Generation failed" }));
          throw new Error(err.error || "Generation failed");
        }
        return res.json();
      } catch (e: any) {
        if (e.name === "AbortError") {
          throw new Error("Image generation timed out (2 min limit)");
        }
        throw new Error(
          e.message ||
            "Image generation failed — check your API key and network",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export function useConfigureImageGen() {
  return useMutation({
    mutationFn: async (data: { provider: string; apiKey: string }) => {
      const res = await authFetch("/api/image-gen/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to configure");
      return res.json();
    },
  });
}
