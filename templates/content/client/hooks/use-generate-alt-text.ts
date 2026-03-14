import { useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";

interface GenerateAltTextRequest {
  imagePath: string;
  projectSlug: string;
  context?: string;
}

interface GenerateAltTextResponse {
  alt: string;
}

export function useGenerateAltText() {
  return useMutation<GenerateAltTextResponse, Error, GenerateAltTextRequest>({
    mutationFn: async (req) => {
      const res = await authFetch("/api/alt-text/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Alt generation failed" }));
        throw new Error(err.error || "Alt generation failed");
      }
      return res.json();
    },
  });
}
