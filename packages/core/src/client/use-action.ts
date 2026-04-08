/**
 * React Query hooks for calling actions via their auto-mounted HTTP endpoints.
 *
 * Actions are mounted at `/_agent-native/actions/:name` by the framework.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UseQueryOptions,
  UseMutationOptions,
} from "@tanstack/react-query";

const ACTION_PREFIX = "/_agent-native/actions";

async function actionFetch<T>(
  name: string,
  method: string,
  params?: Record<string, any>,
): Promise<T> {
  let url = `${ACTION_PREFIX}/${name}`;
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (method === "GET" && params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    );
    url += `?${qs}`;
  } else if (method !== "GET" && params) {
    init.body = JSON.stringify(params);
  }

  const res = await fetch(url, init);
  if (res.status === 204) return null as T;

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Action ${name} failed: HTTP ${res.status}`);
  }
  return data;
}

/**
 * Query an action exposed as GET.
 *
 * ```ts
 * const { data } = useActionQuery<Meal[]>("list-meals", { date: "2025-01-01" });
 * ```
 */
export function useActionQuery<T = any>(
  actionName: string,
  params?: Record<string, any>,
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">,
) {
  return useQuery<T>({
    queryKey: ["action", actionName, params],
    queryFn: () => actionFetch<T>(actionName, "GET", params),
    ...options,
  });
}

/**
 * Mutate via an action exposed as POST (default), PUT, or DELETE.
 *
 * ```ts
 * const { mutate } = useActionMutation<Meal>("log-meal");
 * mutate({ name: "Salad", calories: 350 });
 * ```
 */
export function useActionMutation<
  TData = any,
  TVariables = Record<string, any>,
>(
  actionName: string,
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, "mutationFn"> & {
    method?: "POST" | "PUT" | "DELETE";
  },
) {
  const queryClient = useQueryClient();
  const method = options?.method ?? "POST";

  return useMutation<TData, Error, TVariables>({
    mutationFn: (params) =>
      actionFetch<TData>(actionName, method, params as Record<string, any>),
    onSuccess: (...args) => {
      // Invalidate related action queries
      queryClient.invalidateQueries({ queryKey: ["action"] });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
}
