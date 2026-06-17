import { useActionQuery } from "@agent-native/core/client";

export function useFormResponses(formId: string, limit = 100) {
  return useActionQuery(
    "list-responses",
    { formId, limit: String(limit) },
    {
      enabled: !!formId,
    },
  );
}

export function useResponseInsights(formId?: string, limit = 300, days = 30) {
  return useActionQuery("response-insights", {
    ...(formId ? { formId } : {}),
    limit: String(limit),
    days: String(days),
  });
}
