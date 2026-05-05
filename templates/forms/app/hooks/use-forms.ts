import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  appApiPath,
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client";

// ---------------------------------------------------------------------------
// Admin hooks (authenticated)
// ---------------------------------------------------------------------------

export function useForms(opts: { archived?: boolean } = {}) {
  const archived = !!opts.archived;
  return useActionQuery("list-forms", archived ? { archived: true } : {});
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
    onError: (err: unknown) => {
      // Surface the server's actual error message (e.g. publish validation
      // failures like "Cannot publish: form has no fields") instead of a
      // generic toast that hides the real problem. Callers can pass an
      // inline `onError` to mutate() to suppress this toast if they want
      // to show their own UI.
      const message =
        err instanceof Error && err.message
          ? err.message.replace(/^Action update-form failed:\s*/, "")
          : "Failed to update form";
      toast.error(message);
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useActionMutation("delete-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
      qc.invalidateQueries({ queryKey: ["action", "get-form"] });
    },
    onError: () => {
      toast.error("Failed to delete form");
    },
  });
}

export function useRestoreForm() {
  const qc = useQueryClient();
  return useActionMutation("restore-form", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
      qc.invalidateQueries({ queryKey: ["action", "get-form"] });
    },
    onError: () => {
      toast.error("Failed to restore form");
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
      fetch(appApiPath(`/api/forms/public/${formId}`)).then((r) => {
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
      fetch(appApiPath(`/api/submit/${formId}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, captchaToken, _hp, _t }),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(e));
        return r.json();
      }),
  });
}
