import { useT } from "@agent-native/core/client/i18n";
import {
  contentRecentHref,
  contentRecentTargetKey,
} from "@shared/content-personal-navigation";
import { Link, useSearchParams } from "react-router";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentRecent } from "@/hooks/use-content-recent";

export default function RecentRoute() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const spaceId = searchParams.get("spaceId") ?? undefined;
  const recent = useContentRecent(spaceId);

  if (recent.isError) {
    return (
      <QueryErrorState
        onRetry={() => void recent.refetch()}
        retrying={recent.isFetching}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold">{t("sidebar.recent")}</h1>
        {recent.isLoading ? (
          <div className="mt-6 grid gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : recent.data?.entries.length ? (
          <div className="mt-6 divide-y divide-border rounded-md border border-border">
            {recent.data.entries.map((entry) => (
              <Link
                key={contentRecentTargetKey(entry.target)}
                to={contentRecentHref(entry.target)}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(0,14rem)] items-center gap-4 px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate">
                  {entry.icon ? `${entry.icon} ` : ""}
                  {entry.title || t("sidebar.untitled")}
                </span>
                <span className="truncate text-muted-foreground">
                  {entry.viewName ?? ""}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            {t("sidebar.noRecentVisits")}
          </p>
        )}
      </div>
    </div>
  );
}
