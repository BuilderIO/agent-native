import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type { Form, FormField, FormSettings } from "@shared/types";

// ---------------------------------------------------------------------------
// Admin hooks (authenticated)
// ---------------------------------------------------------------------------

export function useForms() {
  return useActionQuery<Form[]>("list-forms");
}

export function useForm(id: string) {
  return useActionQuery<Form>("get-form", { id }, { enabled: !!id });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useActionMutation<
    Form,
    {
      title: string;
      description?: string;
      fields?: FormField[];
      settings?: FormSettings;
    }
  >("create-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
    },
  });
}

export function useUpdateForm() {
  const qc = useQueryClient();
  return useActionMutation<
    Form,
    {
      id: string;
      title?: string;
      description?: string;
      slug?: string;
      fields?: FormField[];
      settings?: FormSettings;
      status?: "draft" | "published" | "closed";
    }
  >("update-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
      qc.invalidateQueries({ queryKey: ["action", "get-form"] });
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useActionMutation<{ success: boolean }, { id: string }>(
    "delete-form",
    {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
      },
    },
  );
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
    }: {
      formId: string;
      data: Record<string, unknown>;
      captchaToken?: string;
    }) =>
      fetch(`/api/submit/${formId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, captchaToken }),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(e));
        return r.json();
      }),
  });
}
