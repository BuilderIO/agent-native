import { useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";

interface GenerateMetaDescriptionRequest {
  articleContent: string;
  projectSlug: string;
  title?: string;
}

interface GenerateMetaDescriptionResponse {
  description: string;
}

export function useGenerateMetaDescription() {
  return useMutation<
    GenerateMetaDescriptionResponse,
    Error,
    GenerateMetaDescriptionRequest
  >({
    mutationFn: async (req) => {
      let res: Response;

      try {
        res = await authFetch("/api/meta-description/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
      } catch (err) {
        throw new Error(
          "Meta description generation timed out or lost connection. Please try again.",
        );
      }

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Meta description generation failed" }));
        throw new Error(err.error || "Meta description generation failed");
      }

      return res.json();
    },
  });
}
