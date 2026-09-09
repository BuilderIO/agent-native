import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  contentRecentTargetKey,
  type ContentRecentTarget,
} from "@shared/content-personal-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

export function useContentRecent() {
  const org = useOrg();
  const scopeKey = org.data
    ? JSON.stringify([
        org.data.email.trim().toLowerCase(),
        org.data.orgId ?? null,
      ])
    : undefined;
  const query = useActionQuery(
    "get-content-recent",
    { scopeKey },
    {
      enabled: Boolean(scopeKey) && !org.isFetching,
      placeholderData: undefined,
    },
  );
  return {
    ...query,
    data:
      !org.isFetching && query.data?.scopeKey === scopeKey
        ? query.data
        : undefined,
    isLoading: org.isLoading || org.isFetching || query.isLoading,
    isError: org.isError || query.isError,
  };
}

export function useContentVisitRecorder() {
  const queryClient = useQueryClient();
  const t = useT();
  const mutation = useActionMutation("record-content-visit", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-recent"],
      });
    },
    onError: () => {
      toast.error(t("sidebar.failedSaveSidebarState"));
    },
  });
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;
  return useCallback((target: ContentRecentTarget) => {
    mutationRef.current.mutate(target);
  }, []);
}

export function useRecordContentVisit(
  target: ContentRecentTarget | null,
  enabled: boolean,
) {
  const record = useContentVisitRecorder();
  const targetRef = useRef(target);
  targetRef.current = target;
  const key = target ? contentRecentTargetKey(target) : null;
  const recordedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    if (recordedKey.current === key || !targetRef.current) return;
    recordedKey.current = key;
    record(targetRef.current);
  }, [enabled, key, record]);
}
