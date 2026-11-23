import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconFolder, IconStar, IconStarFilled } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { OrdinaryProjectsPage } from "@/components/projects/ProjectsPage";
import type { RoutePageProps } from "@/components/workspace/types";

import { AddProjectsDialog } from "./AddProjectsDialog";
import { collectionIdFrom } from "./collectionRouteParam";
import { DeleteCollectionDialog } from "./DeleteCollectionDialog";
import { NewCollectionDialog } from "./NewCollectionDialog";

type CollectionMember = {
  email: string;
  name: string | null;
  role: "owner" | "manager" | "member";
};

type CollectionSummary = {
  id: string;
  name: string;
  description: string;
  kind: "collection" | "folder";
  parentId: string | null;
  favorited: boolean;
  projectCount: number;
  ownedByYou: boolean;
  sharedWithWorkspace: boolean;
  isPrivate: boolean;
  sharedWithUserCount: number;
  emoji?: string | null | undefined;
  members?: CollectionMember[] | undefined;
};

type CollectionsResult = { collections: CollectionSummary[] };

type CollectionProject = { id: string; title: string; href?: string };

/**
 * The collection star. It reads filled when the collection is in favorites and
 * is otherwise shown on hover, the way the source's collection card reveals it.
 */
function FavoriteCollectionToggle({
  collection,
  alwaysVisible = false,
  onChanged,
}: {
  collection: CollectionSummary;
  alwaysVisible?: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"add" | "remove" | null>(null);
  return (
    <>
      <button
        type="button"
        aria-pressed={collection.favorited}
        aria-label={
          collection.favorited
            ? t("analytics.collections.unfavorite")
            : t("analytics.collections.favorite")
        }
        className={`shrink-0 rounded p-1 text-muted-foreground hover:text-foreground ${
          collection.favorited || alwaysVisible
            ? ""
            : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 hover:opacity-100"
        }`}
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void callAction("favorite-collection", {
            collectionId: collection.id,
            favorited: !collection.favorited,
          })
            .then(onChanged)
            .catch(() => setError(collection.favorited ? "remove" : "add"))
            .finally(() => setPending(false));
        }}
      >
        {collection.favorited ? (
          <IconStarFilled aria-hidden="true" size={14} />
        ) : (
          <IconStar aria-hidden="true" size={14} />
        )}
      </button>
      {error !== null ? (
        <span
          className="shrink-0 text-xs text-[color:var(--ws-danger)]"
          role="alert"
        >
          {error === "remove"
            ? t("analytics.collections.unfavoriteFailed")
            : t("analytics.collections.favoriteFailed")}
        </span>
      ) : null}
    </>
  );
}

/**
 * Collections, and one collection's own page.
 *
 * The workspace seeds a sample collection with a description and example
 * projects, so a reader needs the description, the live project count and who
 * created it — without them the list reads as a bare name. Both the index
 * (/home/collections) and a collection (/collection/:collectionId) render from
 * the same read.
 */
function useOptionalQueryClient() {
  try {
    return useQueryClient();
  } catch {
    return undefined;
  }
}

export function CollectionsPage({ route }: RoutePageProps) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useOptionalQueryClient();
  // A deep link can ask for the create dialog directly (sweep-2 S-PAGE-5): the
  // page's own button opened it, /collections?dialog=create-collection did not.
  const location = useLocation();
  const [creating, setCreating] = useState(
    () =>
      new URLSearchParams(window.location.search).get("dialog") ===
      "create-collection",
  );
  useEffect(() => {
    if (
      new URLSearchParams(location.search).get("dialog") === "create-collection"
    ) {
      setCreating(true);
    }
  }, [location.search]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const routerParams = useParams<{ collectionId?: string }>();

  // The page is rendered from the resolved route, not a nested /collection/:id
  // match, so the router has no param to read (row 515/516: the collection page
  // showed the index and hid Edit/Add projects/Delete).
  const collectionId = collectionIdFrom(route, routerParams);
  const query = useActionQuery<CollectionsResult>(
    "list-collections",
    collectionId ? { id: collectionId } : {},
  );
  // A collection's own page lists what is filed in it, straight from the project
  // listing's collection filter, so the count above and the rows below agree.
  const projectsQuery = useActionQuery<{ projects: CollectionProject[] }>(
    "list-projects",
    collectionId ? { view: "active", search: "", collectionId } : {},
    { enabled: Boolean(collectionId) },
  );

  const collections = query.data?.collections ?? [];
  const current = collectionId
    ? collections.find((item) => item.id === collectionId)
    : undefined;
  const refreshCollections = () => {
    void query.refetch();
    void queryClient?.invalidateQueries({
      queryKey: ["action", "get-workspace-activity"],
    });
  };

  const sharingLabel = (collection: CollectionSummary) => {
    if (collection.sharedWithWorkspace)
      return t("analytics.collections.sharedWithWorkspace");
    if (collection.sharedWithUserCount === 1)
      return t("collectionSharingSummary.usersOne");
    if (collection.sharedWithUserCount > 1)
      return t("collectionSharingSummary.usersOther", {
        count: collection.sharedWithUserCount,
      });
    return t("analytics.collections.privateSharing");
  };
  const countLabel = (count: number) =>
    count === 1
      ? t("analytics.collections.projectCountOne")
      : t("analytics.collections.projectCountOther", { count });

  if (query.isLoading) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10" role="alert">
        <h1 className="text-lg font-semibold text-foreground">
          {t("projectMenu.loadError")}
        </h1>
        <button
          className="mt-4 text-sm font-medium text-primary hover:underline"
          onClick={() => void query.refetch()}
          type="button"
        >
          {t("error.retry")}
        </button>
      </main>
    );
  }

  if (collectionId && !current) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-lg font-semibold text-foreground">
          {t("analytics.collections.notFoundTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("analytics.collections.notFoundDescription")}
        </p>
        <Link
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          to="/home/collections"
        >
          {t("analytics.collections.back")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      {current ? (
        <Link
          className="text-sm text-muted-foreground hover:underline"
          to="/home/collections"
        >
          {t("analytics.collections.back")}
        </Link>
      ) : null}
      <div
        data-collection-header
        className="mt-2 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <h1 className="min-w-0 max-w-full break-words text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
            {current ? (
              <>
                {current.emoji ? (
                  <span aria-hidden="true" className="mr-2">
                    {current.emoji}
                  </span>
                ) : null}
                {current.name}
              </>
            ) : (
              t("analytics.collections.title")
            )}
          </h1>
          {current ? (
            <FavoriteCollectionToggle
              alwaysVisible
              collection={current}
              onChanged={refreshCollections}
            />
          ) : null}
        </div>
        {current ? (
          <div
            data-collection-actions
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-sm"
              onClick={() => setEditing(true)}
            >
              {t("analytics.lists.editCollection")}
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-sm"
              onClick={() => setAdding(true)}
            >
              {t("analytics.collections.addProjects")}
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-sm text-[color:var(--ws-danger)]"
              onClick={() => setDeleting(true)}
            >
              {t("analytics.lists.deleteCollection")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-sm"
            onClick={() => setCreating(true)}
          >
            New collection
          </button>
        )}
      </div>
      {current ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {current.description ? <p>{current.description}</p> : null}
            <span>{countLabel(current.projectCount)}</span>
            <Badge variant="secondary">{sharingLabel(current)}</Badge>
            <span className="text-xs text-muted-foreground">
              {current.ownedByYou
                ? t("analytics.collections.createdByYou")
                : t("analytics.collections.sharedWithYou")}
            </span>
          </div>
          <section
            data-collection-members
            className="mt-4 rounded-lg border border-border px-4 py-3"
          >
            <h2 className="text-xs font-medium text-muted-foreground">
              {t("analytics.collections.managersAndMembers")}
            </h2>
            <ul className="mt-2 flex flex-wrap items-center gap-2">
              {(current.members ?? []).map((member) => (
                <li
                  key={member.email}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground"
                >
                  <span>{member.name || member.email}</span>
                  <span className="text-muted-foreground">
                    {member.role === "owner"
                      ? t("analytics.collections.roleOwner")
                      : member.role === "manager"
                        ? t("collectionDialog.roleManager")
                        : t("collectionDialog.roleMember")}
                  </span>
                </li>
              ))}
              {current.sharedWithWorkspace ? (
                <li className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {t("analytics.collections.sharedWithWorkspace")}
                </li>
              ) : null}
            </ul>
          </section>
        </>
      ) : null}

      {current && collectionId ? (
        <div className="mt-6">
          <OrdinaryProjectsPage
            route={route}
            collectionId={collectionId}
            onAddToCollection={() => setAdding(true)}
          />
        </div>
      ) : null}

      {current ? null : collections.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border p-10 text-center">
          <IconFolder
            aria-hidden="true"
            className="mx-auto mb-3 text-muted-foreground"
            size={28}
          />
          <p className="text-sm font-medium text-foreground">
            {t("analytics.collections.emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("analytics.collections.emptyDescription")}
          </p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-lg border border-border">
          {collections.map((collection) => (
            <li
              className="group flex items-start gap-3 p-4"
              key={collection.id}
            >
              {collection.emoji ? (
                <span
                  aria-hidden="true"
                  className="mt-px shrink-0 text-base leading-5"
                >
                  {collection.emoji}
                </span>
              ) : (
                <IconFolder
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-muted-foreground"
                  size={18}
                />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  className="text-sm font-medium text-foreground hover:underline"
                  to={`/collection/${encodeURIComponent(collection.id)}`}
                >
                  {collection.name}
                </Link>
                {collection.description ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {collection.description}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {countLabel(collection.projectCount)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {sharingLabel(collection)}
              </span>
              <FavoriteCollectionToggle
                collection={collection}
                onChanged={refreshCollections}
              />
            </li>
          ))}
        </ul>
      )}
      {deleting && current ? (
        <DeleteCollectionDialog
          collectionId={current.id}
          collectionName={current.name}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            refreshCollections();
            // Through the router: a full-page assign to a bare path leaves the
            // app's mount path behind (census CEN-analytics-2-002).
            navigate("/home/collections");
          }}
        />
      ) : null}
      {editing && current ? (
        <NewCollectionDialog
          collection={{
            id: current.id,
            name: current.name,
            description: current.description,
            emoji: current.emoji ?? null,
          }}
          onClose={() => {
            setEditing(false);
            refreshCollections();
          }}
        />
      ) : null}
      {creating ? (
        <NewCollectionDialog
          onClose={(createdId) => {
            setCreating(false);
            refreshCollections();
            if (createdId)
              navigate(`/collection/${encodeURIComponent(createdId)}`);
          }}
        />
      ) : null}
      {adding && collectionId ? (
        <AddProjectsDialog
          collectionId={collectionId}
          alreadyFiled={(projectsQuery.data?.projects ?? []).map(
            (project) => project.id,
          )}
          onClose={() => {
            setAdding(false);
            void query.refetch();
            void projectsQuery.refetch();
          }}
        />
      ) : null}
    </main>
  );
}
