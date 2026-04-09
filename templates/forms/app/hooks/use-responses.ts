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
