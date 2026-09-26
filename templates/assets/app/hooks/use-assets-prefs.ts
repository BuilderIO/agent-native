import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  AssetsNotificationPreferences,
  AssetsUserPrefs,
} from "@shared/assets-user-prefs";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const PREFS_ACTION = "get-assets-notification-prefs";
const PREFS_PARAMS = {};
const PREFS_QUERY_KEY = ["action", PREFS_ACTION, PREFS_PARAMS] as const;

export interface AssetsPrefsState {
  prefs: AssetsUserPrefs;
  loading: boolean;
  /** The read failed, so `prefs` holds no stored answer. */
  loadFailed: boolean;
  /** Applies the patch optimistically and rolls back if the write fails. */
  save: (patch: AssetsUserPrefs) => Promise<void>;
}

export function useAssetsPrefs(): AssetsPrefsState {
  const queryClient = useQueryClient();
  const query = useActionQuery<AssetsNotificationPreferences>(
    PREFS_ACTION,
    PREFS_PARAMS,
  );
  const { mutateAsync } = useActionMutation<
    AssetsNotificationPreferences,
    { emailNotifications: boolean }
  >("update-assets-notification-prefs", {
    skipActionQueryInvalidation: true,
  });

  const save = useCallback(
    async (patch: AssetsUserPrefs) => {
      if (patch.emailNotifications === undefined) return;
      const previous =
        queryClient.getQueryData<AssetsNotificationPreferences>(
          PREFS_QUERY_KEY,
        );
      queryClient.setQueryData<AssetsNotificationPreferences>(PREFS_QUERY_KEY, {
        emailNotifications: patch.emailNotifications,
      });
      try {
        const next = await mutateAsync({
          emailNotifications: patch.emailNotifications,
        });
        queryClient.setQueryData(PREFS_QUERY_KEY, next);
      } catch (err) {
        queryClient.setQueryData(PREFS_QUERY_KEY, previous);
        throw err;
      }
    },
    [mutateAsync, queryClient],
  );

  return {
    prefs: query.data ?? {},
    loading: query.isLoading,
    loadFailed: query.isError,
    save,
  };
}
