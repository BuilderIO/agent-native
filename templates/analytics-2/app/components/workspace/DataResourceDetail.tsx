import { IconDatabase, IconTable } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DataBrowserNavigation,
  DataBrowserView,
} from "@/components/data/data-page-model";
import type {
  Dataset,
  DatasetLoader,
  DatasetPage,
} from "@/components/data/model";
import { Skeleton } from "@/components/ui/skeleton";

import { DataTableDetail } from "./DataTableDetail";

import "./DataPageAdapter.css";

/**
 * Read-only detail for a selected database, schema or table node. The node
 * list is the live provider cursor; it is not the flattened connection table
 * reused as a stand-in. Child nodes navigate on a real click so the URL keeps
 * the selected node.
 */
export interface DataResourceDetailProps {
  connectionId: string;
  connectionName: string;
  node: {
    type: "database" | "schema" | "table";
    id: string;
    name?: string | undefined;
  };
  loadPage: DatasetLoader;
  onNavigate: (target: DataBrowserNavigation) => void;
  tab: DataBrowserView;
  onNewThread?: (() => void) | undefined;
  onUseInProject?: (() => void) | undefined;
  useInProjectPending?: boolean | undefined;
}

type ChildResourceNode = {
  type: "database" | "schema";
  id: string;
  name?: string | undefined;
};

function isChildResourceNode(
  node: DataResourceDetailProps["node"],
): node is ChildResourceNode {
  return node.type !== "table";
}

const CHILD_PAGE_SIZE: Record<"database" | "schema", number> = {
  database: 100,
  schema: 25,
};

export function DataResourceDetail({
  connectionId,
  connectionName,
  loadPage,
  node,
  onNavigate,
  tab,
  onNewThread,
  onUseInProject,
  useInProjectPending,
}: DataResourceDetailProps) {
  const label = node.name ?? node.id;
  if (!isChildResourceNode(node)) {
    return (
      <DataTableDetail
        connectionId={connectionId}
        connectionName={connectionName}
        tableId={node.id}
        tableName={node.name}
        onNewThread={onNewThread}
        onUseInProject={onUseInProject}
        useInProjectPending={useInProjectPending}
      />
    );
  }
  return (
    <DataResourceChildren
      connectionId={connectionId}
      connectionName={connectionName}
      label={label}
      loadPage={loadPage}
      node={node}
      onNavigate={onNavigate}
      tab={tab}
    />
  );
}

function DataResourceChildren({
  connectionId,
  connectionName,
  label,
  loadPage,
  node,
  onNavigate,
  tab,
}: Omit<DataResourceDetailProps, "node"> & {
  label: string;
  node: ChildResourceNode;
}) {
  const childLabel = node.type === "database" ? "schemas" : "tables";
  const [pages, setPages] = useState<readonly DatasetPage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setPages([]);
    setStatus("loading");
    setLoadingMore(false);
    setLoadMoreFailed(false);
    void loadPage({
      connectionId,
      parentId: node.id,
      first: CHILD_PAGE_SIZE[node.type],
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        if (generation.current !== requestGeneration) return;
        setPages([page]);
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (generation.current !== requestGeneration) return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [connectionId, loadPage, node.id, node.type, retryKey]);

  const page = pages[pages.length - 1];
  const rows: Dataset[] = [];
  const seen = new Set<string>();
  for (const entry of pages) {
    for (const item of entry.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(item);
    }
  }
  const totalCount = [...pages]
    .reverse()
    .find((entry) => entry.totalCount !== undefined)?.totalCount;

  const loadMore = useCallback(() => {
    if (
      !page?.hasNextPage ||
      page.endCursor === null ||
      loadingMore ||
      status !== "ready"
    ) {
      return;
    }
    const requestGeneration = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    void loadPage({
      connectionId,
      parentId: node.id,
      first: CHILD_PAGE_SIZE[node.type],
      after: page.endCursor,
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        if (generation.current !== requestGeneration) return;
        setPages((current) => [...current, next]);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (generation.current !== requestGeneration) return;
        setLoadMoreFailed(true);
      })
      .finally(() => {
        if (generation.current === requestGeneration) setLoadingMore(false);
      });
  }, [connectionId, loadPage, loadingMore, node.id, node.type, page, status]);

  const retry = useCallback(() => {
    generation.current += 1;
    abort.current?.abort();
    setRetryKey((value) => value + 1);
  }, []);

  const caption =
    node.type === "database"
      ? `SCHEMAS (${totalCount ?? rows.length})`
      : `TABLES (${totalCount ?? rows.length})`;

  return (
    <div className="data-page-source">
      <header className="data-page-source-header">
        <div className="data-page-source-title-row">
          <IconDatabase size={18} aria-hidden="true" />
          <h2>{label}</h2>
        </div>
        <p className="data-page-readonly-description">{connectionName}</p>
      </header>
      {status === "loading" ? (
        <div
          role="status"
          aria-label={`Loading ${childLabel}`}
          className="data-page-spinner data-page-source-spinner"
        />
      ) : status === "error" ? (
        <div role="alert" className="data-page-source-status">
          <span>
            {node.type === "database"
              ? "Error loading database data"
              : "Error loading schema data"}
          </span>
          <button type="button" className="data-page-link" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <div className="data-page-source-table-scroll">
          <table className="data-page-source-table">
            <thead>
              <tr>
                <th scope="col">{caption}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td role="status">
                    {node.type === "database"
                      ? "No schemas found"
                      : "No tables found"}
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="data-page-schema-name data-page-readonly-row"
                      onClick={() =>
                        onNavigate({
                          tab,
                          detail: {
                            type: row.kind,
                            id: row.id,
                            name: row.name,
                          },
                        })
                      }
                    >
                      {row.kind === "table" ? (
                        <IconTable size={14} aria-hidden="true" />
                      ) : (
                        <IconDatabase size={14} aria-hidden="true" />
                      )}
                      {row.name}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loadMoreFailed && !loadingMore ? (
        <div role="alert" className="data-page-source-status">
          {node.type === "database"
            ? "Error loading more schemas"
            : "Error loading more tables"}
        </div>
      ) : null}
      {loadingMore ? (
        <div role="status" aria-busy="true" className="data-page-source-status">
          <Skeleton className="h-4 w-full" />
        </div>
      ) : null}
      {status === "ready" && page?.hasNextPage && !loadingMore ? (
        <button
          type="button"
          className="data-page-link data-page-load-more"
          onClick={loadMore}
        >
          Load more...
        </button>
      ) : null}
    </div>
  );
}
