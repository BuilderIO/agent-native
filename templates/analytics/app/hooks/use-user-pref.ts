import { callAction } from "@agent-native/core/client/hooks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useUserPref<T extends Record<string, unknown>>(key: string) {
  const queryClient = useQueryClient();
  const queryKey = ["user-pref", key];
  // One write per key at a time: overlapping autosaves could otherwise commit
  // an older value after a newer one.
  const scope = { id: `user-pref:${key}` };

  const { data, isLoading, isError, isSuccess, isFetching } = useQuery({
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
    scope,
    mutationKey: queryKey,
    mutationFn: (value: T) =>
      callAction("set-user-pref", { key, value }, { method: "PUT" }),
    // A queued write shows its value here, before the writes ahead of it run.
    onMutate: async (value: T) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, value);
    },
    onError: () => {
      // Rolling back to this write's snapshot would hide a newer queued value
      // that is still to be saved. Only the last pending write rereads the
      // server, which by then holds every earlier write.
      if (queryClient.isMutating({ mutationKey: queryKey }) <= 1) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.error("Failed to save preference");
    },
  });

  const { mutate: remove } = useMutation({
    scope,
    mutationKey: queryKey,
    mutationFn: () =>
      callAction("delete-user-pref", { key }, { method: "DELETE" }),
    onError: () => {
      toast.error("Failed to reset preference");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    data: (data ?? {}) as T,
    isLoading,
    isError,
    isSuccess,
    isFetching,
    save,
    remove,
  };
}
