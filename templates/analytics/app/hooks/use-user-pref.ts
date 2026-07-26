import { callAction } from "@agent-native/core/client/hooks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
      try {
        const result = await callAction(
          "get-user-pref",
          { key },
          { method: "GET" },
        );
        return (result ?? {}) as T;
      } catch {
        return {} as T;
      }
    },
    staleTime: 30_000,
  });

  const { mutate: save } = useMutation({
    // Write failures reconcile through the `onSettled` refetch, not `onError`.
    mutationFn: async (value: T) => {
      await callAction(
        "set-user-pref",
        { key, value },
        { method: "PUT" },
      ).catch(() => {});
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
      await callAction("delete-user-pref", { key }, { method: "DELETE" }).catch(
        () => {},
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return { data: (data ?? {}) as T, isLoading, save, remove };
}
