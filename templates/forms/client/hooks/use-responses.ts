import { useQuery } from "@tanstack/react-query";
import type { FormField, FormResponse } from "@shared/types";

interface ResponsesResult {
  responses: FormResponse[];
  total: number;
  fields: FormField[];
}

export function useFormResponses(formId: string, limit = 100) {
  return useQuery<ResponsesResult>({
    queryKey: ["responses", formId, limit],
    queryFn: () =>
      fetch(`/api/forms/${formId}/responses?limit=${limit}`).then((r) =>
        r.json(),
      ),
    enabled: !!formId,
  });
}
