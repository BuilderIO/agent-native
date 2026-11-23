import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFolder,
  IconTable,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

export type DatasetItem = {
  id: string;
  name: string;
  kind: "database" | "schema" | "table";
  hasChildren: boolean;
};

type DatasetPage = {
  items: readonly DatasetItem[];
  endCursor: string | null;
  hasNextPage: boolean;
};

function iconFor(kind: string) {
  if (kind === "table") return <IconTable size={13} aria-hidden="true" />;
  if (kind === "database") return <IconDatabase size={13} aria-hidden="true" />;
  return <IconFolder size={13} aria-hidden="true" />;
}

export function DatasetTreeLevel({
  connectionId,
  parentId,
  search,
  depth,
  anchor,
  expanded,
  selectedId,
  onOpen,
  onQuery,
  onImport,
  onQueryConnection,
  imported = false,
  pendingTableId,
  queryDisabled,
}: {
  connectionId: string;
  parentId: string | undefined;
  search: string;
  depth: number;
  anchor?: DatasetItem | null;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  onOpen: (item: DatasetItem, isRoot: boolean) => void;
  onQuery: ((tableId: string) => void) | undefined;
  onImport?: ((connectionId: string) => void) | undefined;
  onQueryConnection?:
    | ((connectionId: string, source: string | null) => void)
    | undefined;
  imported?: boolean;
  pendingTableId: string | null;
  queryDisabled: boolean;
}) {
  const t = useT();
  const [pages, setPages] = useState(
    () => new Map<string | undefined, DatasetPage>(),
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useActionQuery(
    "list-connection-datasets",
    {
      connectionId,
      ...(parentId === undefined ? {} : { parentId }),
      ...(cursor === undefined ? {} : { after: cursor }),
      ...(search === "" ? {} : { search }),
    },
    { retry: 1 },
  );

  useEffect(() => {
    const page = query.data;
    if (page === undefined) return;
    setPages((current) =>
      current.get(cursor) === page
        ? current
        : new Map(current).set(cursor, page),
    );
  }, [query.data, cursor]);

  const loadedPages = [...pages.values()];
  const lastPage = loadedPages.at(-1);
  const nextCursor = lastPage?.hasNextPage ? lastPage.endCursor : null;
  const invalidContinuation =
    lastPage?.hasNextPage === true && (!nextCursor || pages.has(nextCursor));
  const failed = query.isError || invalidContinuation;
  const loadingPage = !pages.has(cursor) && !failed;
  const items = new Map<string, DatasetItem>();
  for (const page of loadedPages) {
    for (const item of page.items) items.set(item.id, item);
  }
  const hasItems = items.size > 0;
  const autoAdvance = !hasItems && !failed && !loadingPage ? nextCursor : null;
  useEffect(() => {
    if (autoAdvance) setCursor(autoAdvance);
  }, [autoAdvance]);

  if (anchor && !items.has(anchor.id)) items.set(anchor.id, anchor);
  const indent = { paddingInlineStart: 6 + depth * 14 };

  return (
    <>
      {items.size > 0 && (
        <ul className="nb-outline-list">
          {[...items.values()].map((item) => {
            const isFolder = item.kind !== "table";
            const isOpen =
              isFolder &&
              item.hasChildren &&
              search === "" &&
              expanded.has(item.id);
            const isDatabase = item.kind === "database";
            return (
              <li key={item.id}>
                <div className="nb-data-browser-row">
                  <button
                    type="button"
                    className="nb-outline-item"
                    style={indent}
                    disabled={isFolder && !item.hasChildren}
                    aria-expanded={isFolder ? isOpen : undefined}
                    aria-current={selectedId === item.id ? "true" : undefined}
                    onClick={() => onOpen(item, parentId === undefined)}
                  >
                    {isFolder ? (
                      isOpen ? (
                        <IconChevronDown size={12} aria-hidden="true" />
                      ) : (
                        <IconChevronRight size={12} aria-hidden="true" />
                      )
                    ) : null}
                    {iconFor(item.kind)}
                    <span className="nb-outline-name">{item.name}</span>
                    <span className="nb-outline-kind">{item.kind}</span>
                  </button>
                  {isDatabase && onImport && !imported ? (
                    <button
                      type="button"
                      className="nb-button"
                      disabled={queryDisabled}
                      aria-label={t("dataBrowser.notebook.import")}
                      onClick={() => onImport(connectionId)}
                    >
                      {t("dataBrowser.notebook.import")}
                    </button>
                  ) : null}
                  {isDatabase && onQueryConnection ? (
                    <button
                      type="button"
                      className="nb-button"
                      disabled={queryDisabled}
                      aria-label={t("dataBrowser.notebook.query")}
                      onClick={() => onQueryConnection(connectionId, null)}
                    >
                      {t("dataBrowser.notebook.query")}
                    </button>
                  ) : null}
                  {!isFolder && onQuery && (
                    <button
                      type="button"
                      className="nb-button"
                      disabled={queryDisabled}
                      aria-label={t("notebook.queryTable", {
                        table: item.name,
                      })}
                      onClick={() => onQuery(item.id)}
                    >
                      {t(
                        pendingTableId === item.id
                          ? "notebook.addingTableQuery"
                          : "notebook.queryTableAction",
                      )}
                    </button>
                  )}
                </div>
                {isOpen ? (
                  <DatasetTreeLevel
                    connectionId={connectionId}
                    parentId={item.id}
                    search=""
                    depth={depth + 1}
                    expanded={expanded}
                    selectedId={selectedId}
                    onOpen={onOpen}
                    onQuery={onQuery}
                    onImport={onImport}
                    onQueryConnection={onQueryConnection}
                    imported={imported}
                    pendingTableId={pendingTableId}
                    queryDisabled={queryDisabled}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {failed ? (
        <div className="nb-side-panel-error" role="alert" style={indent}>
          <p>{t("dataBrowser.browse.datasetsError")}</p>
          {query.isError ? (
            <button
              type="button"
              className="nb-text-button"
              onClick={() => void query.refetch()}
            >
              {t("dataBrowser.browse.retry")}
            </button>
          ) : null}
        </div>
      ) : items.size === 0 ? (
        loadingPage || autoAdvance ? (
          <div role="status" className="nb-side-panel-note" style={indent}>
            <span className="sr-only">{t("dataBrowser.notebook.loading")}</span>
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <p className="nb-side-panel-note" style={indent}>
            {t("dataBrowser.notebook.empty")}
          </p>
        )
      ) : null}
      {!failed && nextCursor && hasItems ? (
        <div className="nb-data-browser-more" style={indent}>
          <button
            type="button"
            className="nb-text-button"
            disabled={loadingPage}
            onClick={() => setCursor(nextCursor)}
          >
            {t(
              loadingPage
                ? "dataBrowser.notebook.loading"
                : "dataBrowser.notebook.more",
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}
