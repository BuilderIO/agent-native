import { appApiPath } from "@agent-native/core/client/api-path";
import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type FormListItem = { id: string; [key: string]: unknown };
type FormListMutationContext = {
  removed: Array<{
    queryKey: readonly unknown[];
    form: FormListItem;
    index: number;
  }>;
};

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

/**
 * Granular field-level patch — uses server-side merge so concurrent edits
 * to different fields both survive. The UI builder uses this for all
 * incremental field mutations.
 */
export function usePatchFormFields() {
  const qc = useQueryClient();
  return useActionMutation("patch-form-fields", {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "get-form"] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error && err.message
          ? err.message.replace(/^Action patch-form-fields failed:\s*/, "")
          : "Failed to update fields";
      toast.error(message);
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  const t = useT();
  return useActionMutation("delete-form", {
    onMutate: async (variables) => {
      if (variables.purge) return undefined;

      const activeListFilter = {
        queryKey: ["action", "list-forms"],
        predicate: (query: { queryKey: readonly unknown[] }) => {
          const params = query.queryKey[2];
          return !(
            params &&
            typeof params === "object" &&
            (params as { archived?: boolean }).archived === true
          );
        },
      } as const;

      await qc.cancelQueries(activeListFilter);
      const previous = qc.getQueriesData<FormListItem[]>(activeListFilter);
      const removed: FormListMutationContext["removed"] = [];
      for (const [queryKey, data] of previous) {
        const index = data?.findIndex((form) => form.id === variables.id) ?? -1;
        const form = index >= 0 ? data?.[index] : undefined;
        if (form) removed.push({ queryKey, form, index });
        qc.setQueryData<FormListItem[]>(queryKey, (old) =>
          old?.filter((form) => form.id !== variables.id),
        );
      }

      return { removed } satisfies FormListMutationContext;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action", "list-forms"] });
      qc.invalidateQueries({ queryKey: ["action", "get-form"] });
    },
    onError: (_error, variables, context) => {
      const mutationContext = context as FormListMutationContext | undefined;
      for (const { queryKey, form, index } of mutationContext?.removed ?? []) {
        qc.setQueryData<FormListItem[]>(queryKey, (old) => {
          if (!old || old.some((item) => item.id === form.id)) return old;
          const next = [...old];
          next.splice(Math.min(index, next.length), 0, form);
          return next;
        });
      }
      if (variables.purge) {
        toast.error("Failed to delete form");
      } else if (!mutationContext?.removed.length) {
        toast.error(t("forms.archiveFailed"));
      }
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
