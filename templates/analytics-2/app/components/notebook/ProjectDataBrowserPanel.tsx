import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";
import { useInRouterContext, useLocation } from "react-router";

import type { QueryNotebookTableReceipt } from "../../../shared/notebook-table-query";
import { resolveRoute } from "../../routes/routing/registry";
import { DataTableDetail } from "../workspace/DataTableDetail";
import {
  SemanticModelDetail,
  SemanticModelList,
  type SemanticModelItem,
} from "./ProjectDataBrowserModels";
import { DatasetTreeLevel, type DatasetItem } from "./ProjectDataBrowserTree";
import type { NotebookConnection } from "./types";
import { useNotebookTableQuery } from "./useNotebookTableQuery";

const SEARCH_DEBOUNCE_MS = 250;

type QueryTable = (table: { connectionId: string; tableId: string }) => void;
type DataBrowserProps = {
  connections: readonly NotebookConnection[];
  semanticModels?: readonly SemanticModelItem[] | undefined;
  /** Connections already used by a cell in this notebook. */
  importedConnectionIds?: ReadonlySet<string> | undefined;
  onImport?: ((connectionId: string) => Promise<void> | void) | undefined;
  onQueryConnection?:
    | ((connectionId: string, source: string | null) => Promise<void>)
    | undefined;
  onClose: () => void;
  onQuery?: QueryTable | undefined;
  onAdmitted?: ((receipt: QueryNotebookTableReceipt) => void) | undefined;
  projectId?: string | undefined;
  afterCellId?: string | null | undefined;
  queryDisabled?: boolean;
};

export function ProjectDataBrowserPanel(props: DataBrowserProps) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <RoutedDataBrowser {...props} />
  ) : (
    <DataBrowser {...props} />
  );
}

function RoutedDataBrowser(props: DataBrowserProps) {
  const { pathname } = useLocation();
  const { projectLocator } = resolveRoute(pathname).params;
  return (
    <DataBrowser {...props} projectId={props.projectId ?? projectLocator} />
  );
}

function DataBrowser({
  connections,
  semanticModels = [],
  importedConnectionIds,
  onImport,
  onQueryConnection,
  onClose,
  onQuery,
  onAdmitted,
  projectId,
  afterCellId,
  queryDisabled = false,
}: DataBrowserProps) {
  const [selectedConnectionId, setConnectionId] = useState("");
  const tableQuery = useNotebookTableQuery(
    projectId,
    onQuery,
    onAdmitted,
    afterCellId,
  );
  const t = useT();
  const defaultConnection = connections.find(
    (connection) => connection.isDefault,
  );
  const connectionId = connections.some(
    (connection) => connection.id === selectedConnectionId,
  )
    ? selectedConnectionId
    : (defaultConnection?.id ?? connections[0]?.id ?? "");
  if (connectionId !== selectedConnectionId) setConnectionId(connectionId);
  return (
    <>
      <DataBrowserContent
        key={connectionId}
        connections={connections}
        connectionId={connectionId}
        setConnectionId={setConnectionId}
        semanticModels={semanticModels}
        importedConnectionIds={importedConnectionIds}
        onImport={onImport}
        onQueryConnection={onQueryConnection}
        onClose={onClose}
        onQuery={tableQuery.query}
        pendingTableId={tableQuery.pendingTableId}
        queryDisabled={queryDisabled || tableQuery.pending}
      />
      <div role="status" className="sr-only">
        {tableQuery.pending ? t("notebook.addingTableQuery") : null}
        {tableQuery.added ? t("notebook.tableQueryAdded") : null}
      </div>
      {tableQuery.error && (
        <div className="nb-side-panel-error" role="alert">
          {t(tableQuery.error)}
          {tableQuery.retry && (
            <button
              type="button"
              className="nb-button"
              disabled={queryDisabled || tableQuery.pending}
              onClick={tableQuery.retry}
            >
              {t("editorPreferences.retry")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function DataBrowserContent({
  connections,
  connectionId,
  setConnectionId,
  semanticModels,
  importedConnectionIds,
  onImport,
  onQueryConnection,
  onClose,
  onQuery,
  pendingTableId,
  queryDisabled,
}: {
  connections: readonly NotebookConnection[];
  connectionId: string;
  setConnectionId: (id: string) => void;
  semanticModels: readonly SemanticModelItem[];
  importedConnectionIds: ReadonlySet<string> | undefined;
  onImport: ((connectionId: string) => Promise<void> | void) | undefined;
  onQueryConnection:
    | ((connectionId: string, source: string | null) => Promise<void>)
    | undefined;
  onClose: () => void;
  queryDisabled: boolean;
  onQuery?:
    | ((table: { connectionId: string; tableId: string }) => void)
    | undefined;
  pendingTableId: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  async function runAction(action: () => Promise<void> | void) {
    if (pending) return;
    setPending(true);
    setActionFailed(false);
    try {
      await action();
      onClose();
    } catch {
      setActionFailed(true);
      setPending(false);
    }
  }
  const imported = importedConnectionIds?.has(connectionId) === true;
  const [tab, setTab] = useState<"warehouse" | "models">("warehouse");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const selectedModel =
    semanticModels.find((model) => model.id === selectedModelId) ?? null;
  const t = useT();
  const id = useId();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [anchor, setAnchor] = useState<DatasetItem | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedTable, setSelectedTable] = useState<DatasetItem | null>(null);
  const showWarehouse = tab === "warehouse" && selectedTable === null;

  useEffect(() => {
    const nextSearch = searchInput.trim();
    if (nextSearch === search) return;
    const timer = setTimeout(() => setSearch(nextSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  function openDataset(item: DatasetItem, isRoot: boolean) {
    if (item.kind === "table") {
      setSelectedTable(item);
      return;
    }
    if (search !== "" && isRoot) setAnchor(item);
    setSearchInput("");
    setSearch("");
    setExpanded((current) => {
      const next = new Set(current);
      if (search === "" && next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  return (
    <aside
      className="nb-side-panel"
      aria-label={t("dataBrowser.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">{t("dataBrowser.title")}</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label={t("dataBrowser.notebook.close")}
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      {connections.length === 0 ? (
        <p className="nb-side-panel-note">
          {t("dataBrowser.notebook.noConnection")}
        </p>
      ) : selectedTable ? (
        <TablePreview
          connectionId={connectionId}
          table={selectedTable}
          onBack={() => setSelectedTable(null)}
          queryPending={pendingTableId === selectedTable.id}
          queryDisabled={queryDisabled}
          onQuery={
            onQuery
              ? () => onQuery({ connectionId, tableId: selectedTable.id })
              : undefined
          }
        />
      ) : (
        <>
          <div
            className="nb-data-browser-tabs"
            role="tablist"
            aria-label={t("dataBrowser.notebook.sections")}
          >
            {(["warehouse", "models"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="nb-text-button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {t(
                  id === "warehouse"
                    ? "dataBrowser.tabs.warehouse"
                    : "dataBrowser.notebook.semanticModels",
                )}
              </button>
            ))}
          </div>
          <div className="nb-data-browser-controls">
            <select
              hidden={tab !== "warehouse"}
              className="nb-data-browser-connection"
              aria-label="Data connection"
              value={connectionId}
              onChange={(event) => {
                if (event.target.value === connectionId) return;
                setConnectionId(event.target.value);
              }}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
            {tab === "warehouse" && onImport && !imported ? (
              <button
                type="button"
                className="nb-text-button"
                disabled={pending || queryDisabled}
                onClick={() => void runAction(() => onImport(connectionId))}
              >
                {t("dataBrowser.notebook.import")}
              </button>
            ) : null}
            {tab === "warehouse" && onQueryConnection ? (
              <button
                type="button"
                className="nb-text-button"
                disabled={pending || queryDisabled}
                onClick={() =>
                  void runAction(() => onQueryConnection(connectionId, null))
                }
              >
                {t("dataBrowser.notebook.query")}
              </button>
            ) : null}
            <input
              id={`${id}-search`}
              className="nb-data-browser-search"
              type="search"
              value={tab === "warehouse" ? searchInput : modelSearch}
              placeholder={t(
                tab === "warehouse"
                  ? "dataBrowser.notebook.searchPlaceholder"
                  : "dataBrowser.notebook.searchModelsPlaceholder",
              )}
              aria-label={t(
                tab === "warehouse"
                  ? "dataBrowser.notebook.search"
                  : "dataBrowser.notebook.searchModels",
              )}
              onChange={(event) => {
                if (tab !== "warehouse") {
                  setModelSearch(event.target.value);
                  return;
                }
                setSearchInput(event.target.value);
                if (event.target.value.trim() !== "") setAnchor(null);
              }}
            />
            {tab === "warehouse" && expanded.size > 0 ? (
              <button
                type="button"
                className="nb-text-button"
                onClick={() => setExpanded(new Set())}
              >
                All datasets
              </button>
            ) : null}
          </div>
          {actionFailed ? (
            <p className="nb-side-panel-error" role="alert">
              {t("dataBrowser.notebook.actionFailed")}
            </p>
          ) : null}
          {tab === "models" ? (
            <>
              <SemanticModelList
                models={semanticModels}
                search={modelSearch}
                selectedId={selectedModelId}
                onSelect={(model) => setSelectedModelId(model.id)}
              />
              <section className="nb-data-browser-detail" aria-live="polite">
                {selectedModel ? (
                  <SemanticModelDetail model={selectedModel} />
                ) : (
                  <>
                    <p className="nb-side-panel-note">
                      {t("dataBrowser.detailEmpty.modelsTitle")}
                    </p>
                    <p className="nb-side-panel-note">
                      {t("dataBrowser.detailEmpty.modelsBody")}
                    </p>
                  </>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
      {connections.length > 0 && (
        <nav
          hidden={!showWarehouse}
          aria-label={t("dataBrowser.notebook.datasets")}
        >
          <DatasetTreeLevel
            key={search}
            connectionId={connectionId}
            parentId={undefined}
            search={search}
            depth={0}
            anchor={search === "" ? anchor : null}
            expanded={expanded}
            selectedId={selectedTable?.id ?? null}
            onOpen={openDataset}
            onQuery={
              showWarehouse && onQuery
                ? (tableId) => onQuery({ connectionId, tableId })
                : undefined
            }
            onImport={
              showWarehouse && onImport
                ? (connId) => void runAction(() => onImport(connId))
                : undefined
            }
            onQueryConnection={
              showWarehouse && onQueryConnection
                ? (connId, source) =>
                    void runAction(() => onQueryConnection(connId, source))
                : undefined
            }
            imported={imported}
            pendingTableId={pendingTableId}
            queryDisabled={queryDisabled}
          />
        </nav>
      )}
    </aside>
  );
}

function TablePreview({
  connectionId,
  table,
  onBack,
  onQuery,
  queryPending,
  queryDisabled,
}: {
  connectionId: string;
  table: { id: string; name: string };
  onBack: () => void;
  onQuery: (() => void) | undefined;
  queryPending: boolean;
  queryDisabled: boolean;
}) {
  const t = useT();
  return (
    <div className="nb-data-browser-preview">
      <button type="button" className="nb-button" onClick={onBack}>
        {t("dataBrowser.missingConnection.back")}
      </button>
      <div className="nb-data-browser-preview-heading">
        <h3>{table.name}</h3>
        {onQuery && (
          <button
            type="button"
            className="nb-button"
            disabled={queryDisabled}
            onClick={onQuery}
          >
            {t(
              queryPending
                ? "notebook.addingTableQuery"
                : "notebook.queryTableAction",
            )}
          </button>
        )}
      </div>
      <DataTableDetail connectionId={connectionId} tableId={table.id} />
    </div>
  );
}
