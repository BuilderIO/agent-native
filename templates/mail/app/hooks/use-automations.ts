import { appApiPath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import type { AutomationRule, AutomationAction } from "@shared/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { TAB_ID } from "@/lib/tab-id";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(appApiPath(url), {
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
    queryFn: () => callAction("list-automations", {}, { method: "GET" }),
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
      domain?: AutomationRule["domain"];
    }) => callAction("create-automation", data) as Promise<AutomationRule>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
}

export function useUpdateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      id: string;
      name?: string;
      condition?: string;
      actions?: AutomationAction[];
      enabled?: boolean;
    }) =>
      callAction("update-automation", data, {
        method: "PUT",
      }) as Promise<AutomationRule>,
    onMutate: async ({ id, ...data }) => {
      await qc.cancelQueries({ queryKey: ["automations"] });
      const previous = qc.getQueryData<AutomationRule[]>(["automations"]);
      if (previous) {
        qc.setQueryData<AutomationRule[]>(
          ["automations"],
          previous.map((rule) =>
            rule.id === id
              ? { ...rule, ...data, updatedAt: new Date().toISOString() }
              : rule,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["automations"], context.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callAction("delete-automation", { id }, { method: "DELETE" }),
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
