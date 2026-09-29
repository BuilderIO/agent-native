import { useT } from "@agent-native/core/client/i18n";
import type { ContentSidebarViewOrder } from "@shared/api";
import {
  contentRecentHref,
  contentRecentTargetKey,
} from "@shared/content-personal-navigation";
import { Link, Navigate, useSearchParams } from "react-router";

import { contentSidebarOrderedItems } from "@/components/editor/database/sidebar";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isContentDatabaseUnavailable,
  useContentDatabaseById,
  useContentDatabasePersonalView,
} from "@/hooks/use-content-database";
import { useContentRecent } from "@/hooks/use-content-recent";
import { useContentSpaces } from "@/hooks/use-content-spaces";

function RecentCollection({ spaceId }: { spaceId: string }) {
  const t = useT();
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

export default function FavoritesRoute() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const spaceId = searchParams.get("spaceId");
  const showingRecent = searchParams.get("view") === "recent";
  const contentSpacesQuery = useContentSpaces();
  const databaseId = contentSpacesQuery.data?.favoritesDatabaseId ?? null;
  const favorites = useContentDatabaseById(databaseId, {
    enabled: Boolean(spaceId),
    limit: 50,
    contentSpaceId: spaceId ?? undefined,
  });
  const personalView = useContentDatabasePersonalView(
    spaceId && !showingRecent ? databaseId : null,
  );

  if (spaceId && showingRecent) {
    return <RecentCollection spaceId={spaceId} />;
  }

  if (
    contentSpacesQuery.isError ||
    (spaceId && (favorites.isError || personalView.isError))
  ) {
    return (
      <QueryErrorState
        onRetry={() => {
          void contentSpacesQuery.refetch();
          void favorites.refetch();
          void personalView.refetch();
        }}
        retrying={
          contentSpacesQuery.isFetching ||
          favorites.isFetching ||
          personalView.isFetching
        }
      />
    );
  }

  const documentId = contentSpacesQuery.data?.favoritesDocumentId;
  if (!documentId) {
    return (
      <div className="min-h-0 flex-1 px-4 py-8 sm:px-8 lg:px-10">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  if (!spaceId) return <Navigate to={`/page/${documentId}`} replace />;

  const data = isContentDatabaseUnavailable(favorites.data)
    ? undefined
    : favorites.data;
  const savedActiveViewId =
    data?.database.viewConfig.activeViewId ??
    data?.database.viewConfig.views[0]?.id ??
    "default";
  const activeViewId =
    personalView.data?.overrides?.activeViewId &&
    data?.database.viewConfig.views.some(
      (view) => view.id === personalView.data?.overrides?.activeViewId,
    )
      ? personalView.data.overrides.activeViewId
      : savedActiveViewId;
  const order =
    personalView.data?.overrides?.views.find((view) => view.id === activeViewId)
      ?.sidebarOrder ??
    ({
      mode: "custom",
      itemIds: data?.items.map((item) => item.id) ?? [],
    } satisfies ContentSidebarViewOrder);
  const items = data ? contentSidebarOrderedItems(data.items, order) : [];

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold">{t("sidebar.pinned")}</h1>
        {favorites.isLoading || personalView.isLoading ? (
          <div className="mt-6 grid gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length ? (
          <div className="mt-6 divide-y divide-border rounded-md border border-border">
            {items.map((item) => (
              <Link
                key={item.id}
                to={`/page/${item.document.id}`}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)] items-center px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate">
                  {item.document.icon ? `${item.document.icon} ` : ""}
                  {item.document.title || t("sidebar.untitled")}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            {t("sidebar.noPinnedItems")}
          </p>
        )}
      </div>
    </div>
  );
}
