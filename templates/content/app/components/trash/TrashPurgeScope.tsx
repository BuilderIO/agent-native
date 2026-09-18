import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  trashActionError,
  useContentTrashPurgePlan,
} from "@/hooks/use-content-trash";

const MAX_PLAN_PAGES = 100;

export function trashPurgeScopeState({
  pageCount,
  hasNextPage,
  fetching,
  failed,
}: {
  pageCount: number;
  hasNextPage: boolean;
  fetching: boolean;
  failed: boolean;
}) {
  const capped = pageCount >= MAX_PLAN_PAGES && hasNextPage;
  return {
    capped,
    shouldFetch: hasNextPage && !fetching && !failed && !capped,
    ready: pageCount > 0 && !hasNextPage && !fetching && !failed && !capped,
  };
}

export function TrashPurgeScope({
  scope,
}: {
  scope: ReturnType<typeof useTrashPurgeScopeReady>;
}) {
  const t = useT();
  const { details, capped } = scope;
  const items = details.data?.pages.flatMap((page) => page.items) ?? [];

  if (details.isPending)
    return (
      <div className="grid gap-2" aria-label={t("trash.loadingScope")}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  if (details.isError || capped)
    return (
      <div className="grid gap-2" role="alert">
        <p className="text-sm text-destructive">
          {capped
            ? t("trash.scopeTooLarge")
            : trashActionError(details.error, t("trash.scopeFailed"))}
        </p>
        {!capped ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void details.refetch()}
          >
            {t("trash.retry")}
          </Button>
        ) : null}
      </div>
    );

  return (
    <div className="grid min-h-0 gap-2">
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {items.map((item) => (
          <div
            key={item.documentId}
            className="grid gap-0.5 border-b px-3 py-2 last:border-0"
          >
            <span className="truncate text-sm font-medium">{item.title}</span>
            {item.blocker ? (
              <span className="text-xs text-destructive">
                {t("trash.blockedItem", { reason: item.blocker })}
              </span>
            ) : null}
            {item.survivorEffect ? (
              <span className="text-xs text-muted-foreground">
                {t("trash.survivorEffect", { effect: item.survivorEffect })}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {details.hasNextPage ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("trash.loadingMore")}
        </p>
      ) : null}
    </div>
  );
}

export function useTrashPurgeScopeReady(planId: string | null) {
  const details = useContentTrashPurgePlan(planId);
  const pageCount = details.data?.pages.length ?? 0;
  const state = trashPurgeScopeState({
    pageCount,
    hasNextPage: Boolean(details.hasNextPage),
    fetching: details.isFetchingNextPage,
    failed: details.isError,
  });
  useEffect(() => {
    if (!state.shouldFetch) return;
    void details.fetchNextPage();
  }, [details.fetchNextPage, state.shouldFetch]);
  return {
    details,
    capped: state.capped,
    ready: state.ready,
  };
}
