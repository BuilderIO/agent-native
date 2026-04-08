import { useActionQuery } from "@agent-native/core/client";
import type { FormField, FormResponse } from "@shared/types";

interface ResponsesResult {
  responses: FormResponse[];
  total: number;
  fields: FormField[];
}

export function useFormResponses(formId: string, limit = 100) {
  return useActionQuery<ResponsesResult>(
    "list-responses",
    { formId, limit: String(limit) },
    { enabled: !!formId },
  );
}
