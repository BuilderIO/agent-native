import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Form, FormField, FormSettings } from "@shared/types";

// ---------------------------------------------------------------------------
// Admin hooks (authenticated)
// ---------------------------------------------------------------------------

export function useForms() {
  return useQuery<Form[]>({
    queryKey: ["forms"],
    queryFn: async () => {
      const r = await fetch("/api/forms");
      if (!r.ok) throw new Error("Failed to fetch forms");
      return r.json();
    },
  });
}

export function useForm(id: string) {
  return useQuery<Form>({
    queryKey: ["forms", id],
    queryFn: async () => {
      const r = await fetch(`/api/forms/${id}`);
      if (!r.ok) throw new Error("Failed to fetch form");
      return r.json();
    },
    enabled: !!id,
  });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      fields?: FormField[];
      settings?: FormSettings;
    }) =>
      fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(e));
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forms"] }),
  });
}

export function useUpdateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      title?: string;
      description?: string;
      slug?: string;
      fields?: FormField[];
      settings?: FormSettings;
      status?: "draft" | "published" | "closed";
    }) =>
      fetch(`/api/forms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(e));
        return r.json();
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["forms"] });
      qc.invalidateQueries({ queryKey: ["forms", vars.id] });
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/forms/${id}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(e));
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forms"] }),
  });
}

// ---------------------------------------------------------------------------
// Public hooks (unauthenticated)
// ---------------------------------------------------------------------------

export function usePublicForm(slug: string) {
  return useQuery({
    queryKey: ["public-form", slug],
    queryFn: () =>
      fetch(`/api/forms/public/${slug}`).then((r) => {
        if (!r.ok) throw new Error("Form not found");
        return r.json();
      }),
    enabled: !!slug,
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
