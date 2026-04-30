import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getIdToken } from "@/lib/auth";
import { appApiPath } from "@agent-native/core/client";

async function fetchWithAuth(url: string, options?: RequestInit) {
  const token = await getIdToken();
  return fetch(appApiPath(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  });
}

/**
 * Read/write a per-user preference stored in the settings table.
 * Returns the value as a Record and provides a `save` mutation.
 */
export function useUserPref<T extends Record<string, unknown>>(key: string) {
  const queryClient = useQueryClient();
  const queryKey = ["user-pref", key];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<T> => {
      const res = await fetchWithAuth(
        `/api/user-prefs/${encodeURIComponent(key)}`,
      );
      if (!res.ok) return {} as T;
      return (await res.json()) as T;
    },
    staleTime: 30_000,
  });

  const { mutate: save } = useMutation({
    mutationFn: async (value: T) => {
      await fetchWithAuth(`/api/user-prefs/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify(value),
      });
    },
    onMutate: async (value: T) => {
      await queryClient.cancelQueries({ queryKey });
      const previousValue = queryClient.getQueryData<T>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previousValue };
    },
    onError: (_err, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previousValue);
      toast.error("Failed to save preference");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutate: remove } = useMutation({
    mutationFn: async () => {
      await fetchWithAuth(`/api/user-prefs/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return { data: (data ?? {}) as T, isLoading, save, remove };
}
