import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AutomationRule, AutomationAction } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function useAutomations() {
  return useQuery<AutomationRule[]>({
    queryKey: ["automations"],
    queryFn: () => apiFetch("/api/automations"),
    staleTime: 60_000,
  });
}

export function useCreateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      condition: string;
      actions: AutomationAction[];
      domain?: string;
    }) =>
      apiFetch<AutomationRule>("/api/automations", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
}

export function useUpdateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      condition?: string;
      actions?: AutomationAction[];
      enabled?: boolean;
    }) =>
      apiFetch<AutomationRule>(`/api/automations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/automations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
}

export function useTriggerAutomations() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ triggered: boolean; reason?: string }>(
        "/api/automations/trigger",
        { method: "POST" },
      ),
  });
}
