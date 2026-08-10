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

  const { data, isLoading, isError, isSuccess } = useQuery({
    queryKey,
    queryFn: async (): Promise<T> => {
      const result = await callAction(
        "get-user-pref",
        { key },
        { method: "GET" },
      );
      return (result ?? {}) as T;
    },
    staleTime: 30_000,
  });

  const { mutate: save } = useMutation({
    mutationFn: (value: T) =>
      callAction("set-user-pref", { key, value }, { method: "PUT" }),
    onMutate: async (value: T) => {
      await queryClient.cancelQueries({ queryKey });
      const previousValue = queryClient.getQueryData<T>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previousValue };
    },
    // No invalidate on success: the optimistic value above is exactly what the
    // server stored, so refetching it only buys a round-trip. `onError` is the
    // path that restores truth.
    onError: (_err, _value, context) => {
      queryClient.setQueryData(queryKey, context?.previousValue);
      toast.error("Failed to save preference");
    },
  });

  const { mutate: remove } = useMutation({
    mutationFn: () =>
      callAction("delete-user-pref", { key }, { method: "DELETE" }),
    onError: () => {
      toast.error("Failed to reset preference");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    data: (data ?? {}) as T,
    isLoading,
    isError,
    isSuccess,
    save,
    remove,
  };
}
