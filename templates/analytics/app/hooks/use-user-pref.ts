import { callAction } from "@agent-native/core/client/hooks";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

// What the server last confirmed for each preference, by a read or a write.
// The cache can't say: a queued write puts its unsaved value there at once.
const confirmedPrefs = new WeakMap<QueryClient, Map<string, unknown>>();

function confirmedFor(queryClient: QueryClient) {
  let confirmed = confirmedPrefs.get(queryClient);
  if (!confirmed) {
    confirmed = new Map();
    confirmedPrefs.set(queryClient, confirmed);
  }
  return confirmed;
}

export function useUserPref<T extends Record<string, unknown>>(key: string) {
  const queryClient = useQueryClient();
  const confirmed = confirmedFor(queryClient);
  const queryKey = ["user-pref", key];
  // One write per key at a time: overlapping autosaves could otherwise commit
  // an older value after a newer one.
  const scope = { id: `user-pref:${key}` };

  const { data, isLoading, isError, isSuccess, isFetching } = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<T> => {
      const result = await callAction(
        "get-user-pref",
        { key },
        { method: "GET" },
      );
      const value = (result ?? {}) as T;
      // A write cancels the read in flight, which may still return the value
      // from before that write.
      if (!signal.aborted) confirmed.set(key, value);
      return value;
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
    onSuccess: (_result, value) => {
      confirmed.set(key, value);
    },
    onError: () => {
      // Rolling back to this write's snapshot would hide a newer queued value
      // that is still to be saved, and the snapshot can itself be an unsaved
      // queued value. Only the last pending write rolls back, to what the
      // server last confirmed, and rereads behind it. With nothing confirmed
      // yet there is no value to show, so the preference reads as loading.
      if (queryClient.isMutating({ mutationKey: queryKey }) <= 1) {
        if (confirmed.has(key)) {
          queryClient.setQueryData(queryKey, confirmed.get(key));
          void queryClient.invalidateQueries({ queryKey });
        } else {
          void queryClient.resetQueries({ queryKey });
        }
      }
      toast.error("Failed to save preference");
    },
  });

  const { mutate: remove } = useMutation({
    scope,
    mutationKey: queryKey,
    mutationFn: () =>
      callAction("delete-user-pref", { key }, { method: "DELETE" }),
    onSuccess: () => {
      confirmed.set(key, {});
    },
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
