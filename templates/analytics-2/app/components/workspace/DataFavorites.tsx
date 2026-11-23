import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { SecondaryDataItem } from "@/components/data/data-secondary-model";
import { DataBrowserSecondaryList } from "@/components/data/DataBrowserOverview";

import { dataBrowserHref } from "./DataPageAdapter.model";

type Favorite = { connectionId: string; tableId: string; name: string };
type Favorites = { favorites: Favorite[] };

export function DataTableFavorite({
  connectionId,
  tableId,
}: {
  connectionId: string;
  tableId: string;
}) {
  const t = useT();
  const query = useActionQuery("list-data-favorites", {});
  const { mutateAsync } = useActionMutation("set-data-favorite");
  const [pending, setPending] = useState<boolean | null>(null);
  const favorites = (query.data as Favorites | undefined)?.favorites;
  const pinned =
    pending ??
    favorites?.some(
      (item) => item.connectionId === connectionId && item.tableId === tableId,
    ) ??
    false;
  const label = pinned
    ? t("dataBrowser.browse.removeFavorite")
    : t("dataBrowser.browse.addFavorite");
  if (query.isError)
    return (
      <span role="alert">
        {t("dataBrowser.favorites.error")}{" "}
        <button
          type="button"
          className="data-page-link"
          onClick={() => void query.refetch()}
        >
          {t("editorPreferences.retry")}
        </button>
      </span>
    );
  return (
    <button
      type="button"
      className="data-secondary-star"
      aria-label={label}
      title={label}
      aria-pressed={pinned}
      disabled={query.isPending || query.isError || pending !== null}
      onClick={() => {
        const next = !pinned;
        setPending(next);
        void mutateAsync({ connectionId, tableId, favorited: next })
          .then(() => query.refetch())
          .catch(() => toast.error(t("dataBrowser.browse.favoriteTableFailed")))
          .finally(() => setPending(null));
      }}
    >
      {pinned ? (
        <IconStarFilled size={16} aria-hidden="true" />
      ) : (
        <IconStar size={16} aria-hidden="true" />
      )}
    </button>
  );
}

export function DataFavoritesPanel() {
  const navigate = useNavigate();
  const t = useT();
  const query = useActionQuery("list-data-favorites", {});
  const { mutateAsync } = useActionMutation("set-data-favorite");
  const [removing, setRemoving] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const favorites = (query.data as Favorites | undefined)?.favorites ?? [];
  const items: SecondaryDataItem[] = favorites
    .filter(
      (favorite) =>
        !removing.has(
          JSON.stringify([favorite.connectionId, favorite.tableId]),
        ),
    )
    .map((favorite) => ({
      id: JSON.stringify([favorite.connectionId, favorite.tableId]),
      group: "table",
      name: favorite.name,
      pinned: true,
    }));
  const lookup = (item: SecondaryDataItem) =>
    favorites.find(
      (favorite) =>
        JSON.stringify([favorite.connectionId, favorite.tableId]) === item.id,
    );
  if (query.isError)
    return (
      <div role="alert">
        {t("dataBrowser.favorites.error")}{" "}
        <button
          type="button"
          className="data-page-link"
          onClick={() => void query.refetch()}
        >
          {t("editorPreferences.retry")}
        </button>
      </div>
    );
  return (
    <DataBrowserSecondaryList
      panel="favorites"
      list={{
        status: query.isPending ? "loading" : "ready",
        items,
      }}
      onItemAction={(item) => {
        const favorite = lookup(item);
        if (favorite)
          void navigate(
            dataBrowserHref(
              "all",
              { type: "table", id: favorite.tableId, name: favorite.name },
              favorite.connectionId,
            ),
          );
      }}
      onPinnedChange={async (item, favorited) => {
        const favorite = lookup(item);
        if (!favorite) return;
        setRemoving((current) => new Set(current).add(item.id));
        try {
          await mutateAsync({
            connectionId: favorite.connectionId,
            tableId: favorite.tableId,
            favorited,
          });
          await query.refetch();
        } catch (error) {
          toast.error(t("dataBrowser.browse.favoriteTableFailed"));
          throw error;
        } finally {
          setRemoving((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        }
      }}
      onBrowseAllData={() => navigate(dataBrowserHref("all"))}
    />
  );
}
