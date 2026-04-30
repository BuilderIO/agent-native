import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";

// ---------------------------------------------------------------------------
// Admin hooks (authenticated)
// ---------------------------------------------------------------------------

export function useForms() {
  return useActionQuery("list-forms");
}

export function useForm(id: string) {
  return useActionQuery("get-form", { id }, { enabled: !!id });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useActionMutation("create-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
    },
    onError: () => {
      toast.error("Failed to create form");
    },
  });
}

export function useUpdateForm() {
  const qc = useQueryClient();
  return useActionMutation("update-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
      qc.invalidateQueries({ queryKey: ["action", "get-form"] });
    },
    onError: () => {
      toast.error("Failed to update form");
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useActionMutation("delete-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
    },
    onError: () => {
      toast.error("Failed to delete form");
    },
  });
}

// ---------------------------------------------------------------------------
// Public hooks (unauthenticated) — stay as raw fetch since they hit
// public API routes that don't require auth
// ---------------------------------------------------------------------------

export function usePublicForm(formId: string) {
  return useQuery({
    queryKey: ["public-form", formId],
    queryFn: () =>
      fetch(`/api/forms/public/${formId}`).then((r) => {
        if (!r.ok) throw new Error("Form not found");
        return r.json();
      }),
    enabled: !!formId,
    retry: false,
  });
}

export function useSubmitForm() {
  return useMutation({
    mutationFn: ({
      formId,
      data,
      captchaToken,
      _hp,
      _t,
    }: {
      formId: string;
      data: Record<string, unknown>;
      captchaToken?: string;
      _hp?: string;
      _t?: number;
    }) =>
      fetch(`/api/submit/${formId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, captchaToken, _hp, _t }),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(e));
        return r.json();
      }),
  });
}
