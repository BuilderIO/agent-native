import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  DEFAULT_VIEW_SETTINGS,
  type ViewSettings,
} from "@shared/view-settings";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

// Must match the key `useActionQuery` builds for `get-view-settings`.
const VIEW_SETTINGS_QUERY_KEY = ["action", "get-view-settings", undefined];

// Signed-out editors have no account to save to, so their toggles live in
// component state and reset on reload.
export function useViewSettings({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [localSettings, setLocalSettings] = useState(DEFAULT_VIEW_SETTINGS);
  const query = useActionQuery("get-view-settings", undefined, {
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: DEFAULT_VIEW_SETTINGS,
  });
  const pendingSavesRef = useRef(0);
  const { mutate } = useActionMutation("update-view-settings", {
    method: "PUT",
    skipActionQueryInvalidation: true,
    onSuccess: (saved) => {
      // The server returns the full merged value, so a toggle made before the
      // first read finished can't leave defaults cached over saved settings.
      if (pendingSavesRef.current === 1) {
        queryClient.setQueryData<ViewSettings>(VIEW_SETTINGS_QUERY_KEY, saved);
      }
    },
    onError: (error) => {
      console.warn("[design] could not save view settings", error);
      void query.refetch();
    },
    onSettled: () => {
      pendingSavesRef.current -= 1;
    },
  });

  useEffect(() => {
    if (query.error) {
      console.warn("[design] could not load view settings", query.error);
    }
  }, [query.error]);

  const settings: ViewSettings = enabled
    ? (query.data ?? DEFAULT_VIEW_SETTINGS)
    : localSettings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const update = useCallback(
    (patch: Partial<ViewSettings>) => {
      const current = settingsRef.current;
      if (
        Object.entries(patch).every(
          ([k, v]) => current[k as keyof ViewSettings] === v,
        )
      ) {
        return;
      }
      if (!enabled) {
        setLocalSettings({ ...current, ...patch });
        return;
      }

      void queryClient.cancelQueries({ queryKey: VIEW_SETTINGS_QUERY_KEY });
      queryClient.setQueryData<ViewSettings>(VIEW_SETTINGS_QUERY_KEY, {
        ...current,
        ...patch,
      });
      pendingSavesRef.current += 1;
      mutate(patch);
    },
    [enabled, mutate, queryClient],
  );

  const toggle = useCallback(
    (key: keyof ViewSettings) => update({ [key]: !settingsRef.current[key] }),
    [update],
  );

  return { settings, update, toggle };
}
