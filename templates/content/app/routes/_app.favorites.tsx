import { setClientAppState } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { Document } from "@shared/api";
import { IconFileText, IconTable } from "@tabler/icons-react";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import {
  createContentSpaceSelectionQueue,
  SELECTED_CONTENT_SPACE_STORAGE_KEY,
  selectContentSpace,
} from "@/components/sidebar/select-content-space";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useContentSpaces } from "@/hooks/use-content-spaces";
import { useDocuments } from "@/hooks/use-documents";
import { useLocalStorage } from "@/hooks/use-local-storage";

function sourceLabel(document: Document) {
  if (document.source?.rootName) return document.source.rootName;
  if (document.source?.kind === "file") return "Local folder";
  return "Content";
}

function editedDate(updatedAt: string) {
  const value = new Date(updatedAt);
  if (!Number.isFinite(value.getTime())) return "";
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      value.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export default function FavoritesRoute() {
  const t = useT();
  const navigate = useNavigate();
  const documentsQuery = useDocuments();
  const contentSpacesQuery = useContentSpaces();
  const selectionQueueRef = useRef(createContentSpaceSelectionQueue());
  const [, setStoredSpaceId] = useLocalStorage<string | null>(
    SELECTED_CONTENT_SPACE_STORAGE_KEY,
    null,
  );
  const favorites = (documentsQuery.data ?? []).filter(
    (document) => document.isFavorite && document.source?.kind !== "folder",
  );
  const spaces = contentSpacesQuery.data?.spaces ?? [];

  function workspaceFor(document: Document) {
    return spaces.find(
      (space) =>
        space.filesDocumentId ===
        document.databaseMembership?.databaseDocumentId,
    );
  }

  function openFavorite(document: Document) {
    const space = workspaceFor(document);
    if (!space) {
      navigate(`/page/${document.id}`);
      return;
    }
    void selectionQueueRef
      .current(() =>
        selectContentSpace({
          space,
          syncApplicationState: (selected) =>
            setClientAppState(
              "content-space",
              {
                spaceId: selected.id,
                name: selected.name,
                kind: selected.kind,
                filesDatabaseId: selected.filesDatabaseId,
              },
              { requestSource: "content-favorites" },
            ),
          persistSelection: setStoredSpaceId,
          openFiles: () => navigate(`/page/${document.id}`),
        }),
      )
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
  }

  if (documentsQuery.isError || contentSpacesQuery.isError) {
    return (
      <QueryErrorState
        onRetry={() => {
          void documentsQuery.refetch();
          void contentSpacesQuery.refetch();
        }}
        retrying={documentsQuery.isFetching || contentSpacesQuery.isFetching}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="w-full px-4 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight">
            {t("sidebar.favorites")}
          </h1>
          <div className="mt-6 inline-flex h-7 items-center gap-1.5 rounded bg-muted px-2 text-sm text-foreground">
            <IconTable className="size-3.5" />
            Table
          </div>
        </div>

        {documentsQuery.isLoading || contentSpacesQuery.isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : favorites.length === 0 ? (
          <div className="border-t border-border py-10 text-sm text-muted-foreground">
            {t("database.noRowsMatchThisView")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-32">Edited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {favorites.map((document) => {
                  const workspace = workspaceFor(document);
                  const title = document.title || t("sidebar.untitled");
                  return (
                    <TableRow
                      key={document.id}
                      className="cursor-pointer"
                      tabIndex={0}
                      onClick={() => openFavorite(document)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openFavorite(document);
                        }
                      }}
                    >
                      <TableCell className="font-medium">
                        <span className="flex min-w-0 items-center gap-2">
                          {document.icon ? (
                            <span className="shrink-0">{document.icon}</span>
                          ) : (
                            <IconFileText className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{title}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {workspace?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sourceLabel(document)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {editedDate(document.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
