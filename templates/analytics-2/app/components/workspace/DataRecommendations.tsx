import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type {
  SecondaryCategory,
  SecondaryDataItem,
  SecondaryStatus,
} from "@/components/data/data-secondary-model";
import {
  DataBrowserOverview,
  DataBrowserSecondaryList,
  type SecondaryPanelId,
} from "@/components/data/DataBrowserOverview";

import { dataBrowserHref } from "./DataPageAdapter.model";

type TableRef = { connectionId: string; tableId: string; name: string };

type EndorsedItemRecord = {
  id: string;
  connectionId: string;
  resourceId: string;
  resourceKind: "database" | "schema" | "table";
  group: "view" | "model" | "table" | "schema";
  name: string;
  description: string;
  pinned: boolean;
  status: SecondaryStatus;
  categories: readonly SecondaryCategory[];
  connection: { id: string; name: string; type: string };
};

type EndorsedCatalogResponse = {
  items: readonly EndorsedItemRecord[];
  statuses: readonly SecondaryStatus[];
  categories: readonly SecondaryCategory[];
};

function tableRefKey(ref: TableRef): string {
  return JSON.stringify([ref.connectionId, ref.tableId]);
}

export function DataRecommendedPanel() {
  const navigate = useNavigate();
  const t = useT();
  const endorsed = useActionQuery("list-data-endorsed-catalog", {});
  const recents = useActionQuery("list-data-recents", {});
  const favorites = useActionQuery("list-data-favorites", {});
  const { mutateAsync } = useActionMutation("set-data-favorite");

  const endorsedData = endorsed.data as EndorsedCatalogResponse | undefined;
  const recentRefs = useMemo(
    () => (recents.data as { recents: TableRef[] } | undefined)?.recents ?? [],
    [recents.data],
  );
  const favoriteRefs = useMemo(
    () =>
      (favorites.data as { favorites: TableRef[] } | undefined)?.favorites ??
      [],
    [favorites.data],
  );

  const favoriteKeySet = useMemo(
    () => new Set(favoriteRefs.map(tableRefKey)),
    [favoriteRefs],
  );

  const endorsedById = useMemo(
    () =>
      new Map((endorsedData?.items ?? []).map((entry) => [entry.id, entry])),
    [endorsedData?.items],
  );

  const endorsedItems = useMemo<SecondaryDataItem[]>(
    () =>
      (endorsedData?.items ?? []).map((entry) => ({
        id: entry.id,
        group: entry.group,
        name: entry.name,
        description: entry.description || null,
        pinned:
          entry.resourceKind === "table"
            ? favoriteKeySet.has(
                tableRefKey({
                  connectionId: entry.connectionId,
                  tableId: entry.resourceId,
                  name: entry.name,
                }),
              ) || entry.pinned
            : entry.pinned,
        status: entry.status,
        categories: entry.categories,
        connection: entry.connection,
      })),
    [endorsedData?.items, favoriteKeySet],
  );

  const toTableItems = (refs: TableRef[]): SecondaryDataItem[] =>
    refs.map((ref) => ({
      id: tableRefKey(ref),
      group: "table",
      name: ref.name,
      pinned: favoriteKeySet.has(tableRefKey(ref)),
    }));

  const findTableRef = (item: SecondaryDataItem): TableRef | undefined => {
    const endorsedEntry = endorsedById.get(item.id);
    if (endorsedEntry && endorsedEntry.resourceKind === "table") {
      return {
        connectionId: endorsedEntry.connectionId,
        tableId: endorsedEntry.resourceId,
        name: endorsedEntry.name,
      };
    }
    return [...recentRefs, ...favoriteRefs].find(
      (ref) => tableRefKey(ref) === item.id,
    );
  };

  const onItemAction = (item: SecondaryDataItem) => {
    const endorsedEntry = endorsedById.get(item.id);
    if (endorsedEntry) {
      void navigate(
        dataBrowserHref(
          "all",
          {
            type: endorsedEntry.resourceKind,
            id: endorsedEntry.resourceId,
            name: endorsedEntry.name,
          },
          endorsedEntry.connectionId,
        ),
      );
      return;
    }
    const ref = findTableRef(item);
    if (ref) {
      void navigate(
        dataBrowserHref(
          "all",
          { type: "table", id: ref.tableId, name: ref.name },
          ref.connectionId,
        ),
      );
    }
  };

  const onPinnedChange = async (
    item: SecondaryDataItem,
    favorited: boolean,
  ) => {
    const ref = findTableRef(item);
    if (!ref) return;
    try {
      await mutateAsync({
        connectionId: ref.connectionId,
        tableId: ref.tableId,
        favorited,
      });
      await Promise.all([favorites.refetch(), endorsed.refetch()]);
    } catch (error) {
      toast.error(t("dataBrowser.browse.favoriteTableFailed"));
      throw error;
    }
  };

  const onViewAll = (panel: SecondaryPanelId) => {
    void navigate(dataBrowserHref(panel));
  };

  return (
    <DataBrowserOverview
      endorsed={{
        status: endorsed.isError
          ? "error"
          : endorsed.isPending
            ? "loading"
            : "ready",
        items: endorsedItems,
      }}
      onRetryEndorsed={() => void endorsed.refetch()}
      recentlyUsed={{
        status: recents.isError
          ? "error"
          : recents.isPending || favorites.isPending
            ? "loading"
            : "ready",
        items: toTableItems(recentRefs),
      }}
      onRetryRecentlyUsed={() => void recents.refetch()}
      favorites={{
        status: favorites.isError
          ? "error"
          : favorites.isPending
            ? "loading"
            : "ready",
        items: toTableItems(favoriteRefs),
      }}
      onRetryFavorites={() => void favorites.refetch()}
      statuses={endorsedData?.statuses ?? []}
      categories={endorsedData?.categories ?? []}
      onItemAction={onItemAction}
      onPinnedChange={onPinnedChange}
      onViewAll={onViewAll}
    />
  );
}

export function DataRecentsPanel() {
  const navigate = useNavigate();
  const t = useT();
  const recents = useActionQuery("list-data-recents", {});
  const favorites = useActionQuery("list-data-favorites", {});
  const { mutateAsync } = useActionMutation("set-data-favorite");
  const recentRefs =
    (recents.data as { recents: TableRef[] } | undefined)?.recents ?? [];
  const favoriteRefs =
    (favorites.data as { favorites: TableRef[] } | undefined)?.favorites ?? [];
  const key = (ref: TableRef) =>
    JSON.stringify([ref.connectionId, ref.tableId]);
  const toItems = (refs: TableRef[]): SecondaryDataItem[] =>
    refs.map((ref) => ({
      id: key(ref),
      group: "table",
      name: ref.name,
      pinned: favoriteRefs.some((favorite) => key(favorite) === key(ref)),
    }));
  const find = (item: SecondaryDataItem) =>
    [...recentRefs, ...favoriteRefs].find((ref) => key(ref) === item.id);
  const onItemAction = (item: SecondaryDataItem) => {
    const ref = find(item);
    if (ref)
      void navigate(
        dataBrowserHref(
          "all",
          { type: "table", id: ref.tableId, name: ref.name },
          ref.connectionId,
        ),
      );
  };
  const onPinnedChange = async (
    item: SecondaryDataItem,
    favorited: boolean,
  ) => {
    const ref = find(item);
    if (!ref) return;
    try {
      await mutateAsync({
        connectionId: ref.connectionId,
        tableId: ref.tableId,
        favorited,
      });
      await favorites.refetch();
    } catch (error) {
      toast.error(t("dataBrowser.browse.favoriteTableFailed"));
      throw error;
    }
  };
  const retry = () => {
    if (recents.isError) void recents.refetch();
    if (favorites.isError) void favorites.refetch();
  };
  if (recents.isError || favorites.isError)
    return (
      <div role="alert">
        {recents.isError
          ? t("dataBrowser.recents.error")
          : t("dataBrowser.favorites.error")}{" "}
        <button type="button" className="data-page-link" onClick={retry}>
          {t("editorPreferences.retry")}
        </button>
      </div>
    );
  return (
    <DataBrowserSecondaryList
      panel="recently-used"
      list={{
        status: recents.isPending || favorites.isPending ? "loading" : "ready",
        items: toItems(recentRefs),
      }}
      onItemAction={onItemAction}
      onPinnedChange={onPinnedChange}
      onBrowseAllData={() => navigate(dataBrowserHref("all"))}
    />
  );
}
