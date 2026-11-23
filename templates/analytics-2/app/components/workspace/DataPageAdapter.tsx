import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { AddDataConnectionDialog } from "@/components/data/AddDataConnectionDialog";
import {
  type AiUsageControls,
  type CategoryOption,
  type ConnectionMetadataControls,
  type DataBrowserNavigation,
  type SchemaMetadata,
  type StatusOption,
} from "@/components/data/data-page-model";
import type { DataBrowserView } from "@/components/data/data-page-model";
import type { SecondaryDataItem } from "@/components/data/data-secondary-model";
import {
  DataBrowserPage,
  type DataBrowserPageProps,
} from "@/components/data/DataBrowserPage";
import type {
  ConnectionSchema,
  ConnectionCanonicalBaseline,
  ConnectionValues,
  DataConnection,
  Dataset,
  DatasetLoader,
  SaveConnection,
} from "@/components/data/model";
import { SampleSourcePanel } from "@/components/data/SampleSourcePanel";
import { useDataConnectionActions } from "@/components/data/useDataConnectionActions";
import type {
  DataResourceMetadataPatch,
  DataResourceRef,
} from "@/lib/model/data-resource-contracts";
import type { ResolvedRoute } from "@/routes/routing/registry";

import {
  ANALYTICS_CONTROL_IDS as controls,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import { DataFavoritesPanel } from "./DataFavorites";
import {
  canonicalConnectionAiUsage,
  categoryChangePatch,
  connectionAiUsage,
  dataBrowserHref,
  decodeScopedResourceId,
  providerResourceName,
  resourceAiUsage,
  resolveDataBrowserDetail,
  resolveDataBrowserView,
  sourceFamiliesForConnections,
} from "./DataPageAdapter.model";
import { DataPageAdapterConnectionMenu } from "./DataPageAdapterConnectionMenu";
import {
  DataPageAdapterFailure,
  DataPageAdapterFrame,
  DataPageAdapterLoading,
  DataPageAdapterNoAccess,
} from "./DataPageAdapterPanels";
import {
  CatalogRevisionSyncError,
  RootResetBudget,
  catalogBootstrapKey,
  catalogRevision,
  catalogRevisionKey,
  catalogRootEnabled,
  catalogViewState,
  connectionRefreshPending,
  getSharedCatalogBootstrapController,
  isKnownCatalogCursorRestart,
  rootReaderRevision,
  settleRefetch,
  shouldBootstrapCatalogWithKey,
  shouldCoordinateCatalogResult,
  useCatalogLeaseWatch,
  withConnectionRefreshPending,
  loadDatasetPage,
  type CatalogOutput,
} from "./DataPageCatalog";
import { DataRecentsPanel, DataRecommendedPanel } from "./DataRecommendations";
import { DataResourceDetail } from "./DataResourceDetail";

export interface DataPageAdapterProps {
  route: ResolvedRoute;
}

interface EditFormState {
  connectionId: string;
  isDraft?: boolean | undefined;
  type: string;
  values: ConnectionValues;
  configuredCredentialFields: readonly string[];
  baseline: ConnectionCanonicalBaseline;
  nativeRevision?: string | undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "The request could not be completed.";
}

/**
 * Integration adapter for the Data page.
 *
 * This file owns only the route, permission, action and metadata wiring. The
 * page UI stays in DataBrowserPage; the route controls the tab, the selected
 * connection and the selected node.
 */
export function DataPageAdapter({ route }: DataPageAdapterProps) {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const actions = useDataConnectionActions();
  const access = actions.access;

  const canBrowseData = capabilityAllowed(
    access.data?.capabilities,
    controls.dataBrowse,
  );
  const canAddConnection = capabilityAllowed(
    access.data?.capabilities,
    controls.bigQueryConnectionCreate,
  );
  const canManageMetadata =
    canBrowseData && access.data?.canManageMetadata === true;
  const favoritesQuery = useActionQuery(
    "list-data-favorites",
    {},
    { enabled: canBrowseData },
  );
  const setFavoriteMutation = useActionMutation("set-data-favorite");
  const [favoritePending, setFavoritePending] = useState<
    Record<string, boolean>
  >({});

  const view = resolveDataBrowserView(route.params.tab);
  const routeDetail = resolveDataBrowserDetail(
    route.params.detailViewType,
    route.params.dataSourceId,
  );
  const scopedRoute =
    route.params.dataSourceId &&
    route.params.detailViewType !== "data-connection"
      ? decodeScopedResourceId(route.params.dataSourceId)
      : undefined;
  const directConnectionId =
    routeDetail?.type === "data-connection" ? routeDetail.id : undefined;
  const scopedConnectionId = scopedRoute?.connectionId;
  const routeConnectionId = directConnectionId ?? scopedConnectionId;
  const hasRouteDetail = routeDetail !== undefined;
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | undefined
  >(routeConnectionId);
  const [nodeNames, setNodeNames] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [editForm, setEditForm] = useState<EditFormState>();
  const [editError, setEditError] = useState<string>();
  const editGeneration = useRef(0);
  const selectedConnectionIdRef = useRef(selectedConnectionId);
  selectedConnectionIdRef.current = selectedConnectionId;
  const [readerRevision, setReaderRevision] = useState(0);
  const [catalogInitializingKey, setCatalogInitializingKey] = useState<
    string | undefined
  >();
  const catalogInitializing =
    catalogInitializingKey !== undefined &&
    catalogInitializingKey === selectedConnectionId;
  const [catalogActionError, setCatalogActionError] = useState<string>();
  const [
    catalogRefreshPendingByConnection,
    setCatalogRefreshPendingByConnection,
  ] = useState<ReadonlyMap<string, number>>(() => new Map());
  const bootstrapController = getSharedCatalogBootstrapController();
  const resetBudget = useRef(new RootResetBudget());
  const catalogOutputRef = useRef<CatalogOutput | undefined>(undefined);
  const catalogFetchingRef = useRef(false);

  useEffect(() => {
    editGeneration.current += 1;
    setEditError(undefined);
    setEditForm(undefined);
    setCatalogActionError(undefined);
  }, [selectedConnectionId]);

  useEffect(() => {
    if (directConnectionId) {
      setSelectedConnectionId(directConnectionId);
    } else if (scopedConnectionId) {
      setSelectedConnectionId(scopedConnectionId);
    } else if (!hasRouteDetail) {
      setSelectedConnectionId(undefined);
    }
  }, [directConnectionId, hasRouteDetail, scopedConnectionId]);

  const selectedNodeId =
    routeDetail && routeDetail.type !== "data-connection"
      ? routeDetail.id
      : undefined;

  const connections = useMemo(
    () => actions.connections.data?.connections ?? [],
    [actions.connections.data?.connections],
  );
  const schemas = useMemo(
    () => (actions.schemas.data?.schemas ?? []) as readonly ConnectionSchema[],
    [actions.schemas.data?.schemas],
  );
  const refetchConnections = actions.connections.refetch;
  const selectedConnection = connections.find(
    (connection) => connection.id === selectedConnectionId,
  );

  const catalogAvailable = Boolean(
    canBrowseData && selectedConnection && !selectedConnection.isDraft,
  );

  const catalog = useActionQuery(
    "get-data-browser-catalog",
    { connectionId: selectedConnectionId ?? "", first: 1 },
    { enabled: catalogAvailable },
  );
  const refetchCatalog = catalog.refetch;
  const { mutateAsync: refreshCatalog } = useActionMutation(
    "refresh-data-browser-catalog",
  );
  const catalogOutput = catalog.data as CatalogOutput | undefined;
  catalogOutputRef.current = catalogOutput;
  catalogFetchingRef.current = catalog.isFetching;
  useCatalogLeaseWatch({
    data: catalogOutput,
    enabled: catalogAvailable && !catalog.isError,
    refetch: refetchCatalog,
    watchKey: selectedConnectionId,
  });
  const catalogState = catalogOutput
    ? catalogViewState(catalogOutput)
    : catalog.isError
      ? "error"
      : "loading";
  const catalogRevisionToken = catalogOutput
    ? rootReaderRevision(catalogOutput, readerRevision)
    : `catalog-${catalogState}:${readerRevision}`;
  const catalogRefreshPending = connectionRefreshPending(
    catalogRefreshPendingByConnection,
    selectedConnectionId,
  );
  const remoteRefreshing =
    catalogOutput?.refreshState === "refreshing" &&
    catalogOutput.refreshStale === false;
  const catalogRefreshing =
    catalogRefreshPending || catalogInitializing || remoteRefreshing;
  const bootstrapKey = catalogOutput
    ? catalogBootstrapKey(catalogOutput)
    : undefined;
  const bootstrapEligible =
    catalogAvailable && catalogOutput
      ? shouldBootstrapCatalogWithKey(
          catalogOutput,
          canManageMetadata,
          bootstrapKey,
        )
      : false;
  const bootstrapGateOpen =
    bootstrapEligible &&
    bootstrapKey !== undefined &&
    !bootstrapController.hasAttempted(bootstrapKey);
  const rootEnabled =
    catalogAvailable &&
    catalogRootEnabled({
      hasOutput: catalogOutput !== undefined,
      state: catalogState,
      initializing: catalogInitializing,
      bootstrapGateOpen,
      refreshPending: catalogRefreshPending,
      remoteRefreshing,
      fetching: catalog.isFetching,
      queryError: catalog.isError,
    });
  const metadata = useActionQuery(
    "list-data-resource-metadata",
    { connectionId: selectedConnectionId ?? "" },
    {
      method: "POST",
      enabled:
        canManageMetadata &&
        Boolean(selectedConnectionId) &&
        !selectedConnection?.isDraft,
    },
  );
  const statuses = useActionQuery(
    "list-data-statuses",
    {},
    {
      enabled: canManageMetadata,
    },
  );
  const categories = useActionQuery(
    "list-data-categories",
    {},
    {
      enabled: canManageMetadata,
    },
  );
  const { mutateAsync: updateMetadata } = useActionMutation(
    "update-data-resource-metadata",
  );
  const refetchMetadata = metadata.refetch;

  const patchMetadata = useCallback(
    async (resource: DataResourceRef, patch: DataResourceMetadataPatch) => {
      if (!selectedConnectionId) {
        throw new Error("Select a data connection before editing metadata.");
      }
      await updateMetadata({
        connectionId: selectedConnectionId,
        resource,
        patch,
      });
      // The component keeps the editor pending until this resolves, so a write
      // is never shown as saved before the canonical annotation is read back.
      const result = await refetchMetadata();
      if (result.error) throw result.error;
    },
    [refetchMetadata, selectedConnectionId, updateMetadata],
  );

  const metadataResources = metadata.data?.resources ?? [];
  const connectionMetadata = metadataResources.find(
    (resource) =>
      resource.kind === "connection" && resource.id === selectedConnectionId,
  );

  const statusOptions = useMemo<StatusOption[]>(
    () =>
      (statuses.data?.statuses ?? []).map((status) => ({
        id: status.id,
        name: status.name,
        ...(status.color ? { color: status.color } : {}),
      })),
    [statuses.data?.statuses],
  );
  const categoryOptions = useMemo<CategoryOption[]>(
    () =>
      (categories.data?.categories ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        ...(category.color ? { color: category.color } : {}),
      })),
    [categories.data?.categories],
  );
  const statusNames = useMemo(
    () => new Map(statusOptions.map((status) => [status.id, status.name])),
    [statusOptions],
  );

  const resourceMetadata = useMemo(() => {
    const map = new Map<string, SchemaMetadata>();
    for (const resource of metadataResources) {
      if (resource.kind === "connection") continue;
      map.set(resource.id, {
        ...(resource.description ? { description: resource.description } : {}),
        statusId: resource.statusId,
        statusName: resource.statusId
          ? (statusNames.get(resource.statusId) ?? resource.statusId)
          : null,
        categoryIds: resource.categoryIds,
      });
    }
    return map;
  }, [metadataResources, statusNames]);

  const metadataControls = useMemo<ConnectionMetadataControls>(
    () => ({
      resources: resourceMetadata,
      statuses: statusOptions,
      categories: categoryOptions,
      onSetConnectionDescription: (description) =>
        patchMetadata(
          { kind: "connection", id: selectedConnectionId ?? "" },
          { description },
        ),
      onSetResourceDescription: (resource, description) =>
        patchMetadata(resource, { description }),
      onSetResourceStatus: (resource, statusId) =>
        patchMetadata(resource, { statusId }),
      onToggleResourceCategory: (resource, categoryId, added) =>
        patchMetadata(resource, categoryChangePatch(categoryId, added)),
    }),
    [
      categoryOptions,
      patchMetadata,
      resourceMetadata,
      selectedConnectionId,
      statusOptions,
    ],
  );

  const aiUsage = useMemo<AiUsageControls | undefined>(() => {
    if (access.data?.aiEnabled === false) return undefined;
    const refreshState = catalog.data?.refreshState;
    const connectionRef: DataResourceRef = {
      kind: "connection",
      id: selectedConnectionId ?? "",
    };
    return {
      connection:
        canonicalConnectionAiUsage(selectedConnection) ??
        connectionAiUsage(connectionMetadata?.aiUsage),
      resources: resourceAiUsage(metadataResources),
      ...(refreshState !== undefined && refreshState !== "ready"
        ? { needsSchemaRefresh: true }
        : {}),
      onSetConnection: (status) =>
        patchMetadata(connectionRef, { aiUsage: status }),
      onSetResource: (resource, status) =>
        patchMetadata(resource, { aiUsage: status }),
    };
  }, [
    access.data?.aiEnabled,
    catalog.data?.refreshState,
    connectionMetadata?.aiUsage,
    metadataResources,
    patchMetadata,
    selectedConnection,
    selectedConnectionId,
  ]);

  const runCatalogRefresh = useCallback(
    async (connectionId = selectedConnectionId) => {
      if (!connectionId) return false;
      setCatalogRefreshPendingByConnection((current) =>
        withConnectionRefreshPending(current, connectionId, 1),
      );
      if (selectedConnectionIdRef.current === connectionId) {
        setCatalogActionError(undefined);
      }
      try {
        await refreshCatalog({ connectionId });
        // A completed replacement must reset both root readers even when the
        // public revision string does not change. Never let A reset B.
        if (selectedConnectionIdRef.current === connectionId) {
          setReaderRevision((value) => value + 1);
          resetBudget.current.reset();
        }
        return true;
      } catch (error) {
        if (selectedConnectionIdRef.current === connectionId) {
          setCatalogActionError(errorMessage(error));
        }
        return false;
      } finally {
        setCatalogRefreshPendingByConnection((current) =>
          withConnectionRefreshPending(current, connectionId, -1),
        );
        // A late completion from a previous connection must not refresh or
        // gate the currently selected one.
        if (selectedConnectionIdRef.current === connectionId) {
          await settleRefetch(refetchCatalog);
        }
      }
    },
    [refetchCatalog, refreshCatalog, selectedConnectionId],
  );

  useEffect(() => {
    if (!selectedConnectionId || !bootstrapKey || !bootstrapEligible) return;
    const connectionId = selectedConnectionId;
    const pending = bootstrapController.ensure(bootstrapKey, true, async () => {
      await runCatalogRefresh(connectionId);
    });
    if (!pending) return;
    // A remounted route can attach to the shared in-flight run; it still needs
    // its own loading gate while that work settles.
    setCatalogInitializingKey(connectionId);
    void pending.finally(() => {
      setCatalogInitializingKey((current) =>
        current === connectionId ? undefined : current,
      );
    });
  }, [
    bootstrapController,
    bootstrapEligible,
    bootstrapKey,
    runCatalogRefresh,
    selectedConnectionId,
  ]);

  const loadPage = useCallback<DatasetLoader>(
    (input) =>
      loadDatasetPage(input, {
        catalog: async ({ signal, ...request }) => {
          try {
            const output = await callAction(
              "get-data-browser-catalog",
              request,
              {
                method: "GET",
                ...(signal ? { signal } : {}),
              },
            );
            const pageState = catalogViewState(output);
            if (
              pageState !== "blocked" &&
              pageState !== "stale" &&
              shouldCoordinateCatalogResult({
                signalAborted: signal?.aborted === true,
                requestConnectionId: output.connectionId,
                selectedConnectionId: selectedConnectionIdRef.current,
              })
            ) {
              const controllerOutput = catalogOutputRef.current;
              const revisionKey = controllerOutput
                ? catalogRevisionKey(output, controllerOutput)
                : undefined;
              if (revisionKey && controllerOutput) {
                resetBudget.current.setIdentity(
                  `${output.connectionId}:${
                    catalogBootstrapKey(controllerOutput) ?? ""
                  }`,
                );
                if (resetBudget.current.allowRevision(revisionKey)) {
                  setReaderRevision((value) => value + 1);
                  void settleRefetch(refetchCatalog);
                } else if (!catalogFetchingRef.current) {
                  throw new CatalogRevisionSyncError();
                }
              }
            }
            return output;
          } catch (error) {
            const selected = selectedConnectionIdRef.current;
            if (
              isKnownCatalogCursorRestart(error) &&
              shouldCoordinateCatalogResult({
                signalAborted: signal?.aborted === true,
                requestConnectionId: request.connectionId,
                selectedConnectionId: selected,
              })
            ) {
              const controllerOutput = catalogOutputRef.current;
              // Key by the controller snapshot, not the reader's search, so
              // left and right 409s coalesce into one logical restart.
              const key = `${request.connectionId}:${
                controllerOutput ? catalogRevision(controllerOutput) : "first"
              }`;
              resetBudget.current.setIdentity(
                `${request.connectionId}:${
                  controllerOutput
                    ? (catalogBootstrapKey(controllerOutput) ?? "")
                    : ""
                }`,
              );
              if (resetBudget.current.allowStale(key)) {
                setReaderRevision((value) => value + 1);
                void settleRefetch(refetchCatalog);
              }
            }
            throw error;
          }
        },
        provider: ({ signal, ...request }) =>
          callAction("list-connection-datasets", request, {
            method: "GET",
            ...(signal ? { signal } : {}),
          }),
      }),
    [refetchCatalog],
  );

  const save = useCallback<SaveConnection>(
    async (input) => {
      const saved = await actions.save(input);
      try {
        const connections = await refetchConnections();
        if (connections.error) throw connections.error;
        if (
          input.id &&
          !input.draft &&
          selectedConnectionIdRef.current === input.id
        ) {
          setCatalogActionError(undefined);
          const catalog = await refetchCatalog();
          if (catalog.error) throw catalog.error;
        }
      } catch {
        toast.error(t("sources.schemaRefresh.savedReadFailed"));
      }
      return saved;
    },
    [actions.save, refetchConnections, refetchCatalog, t],
  );
  const onSetDefault = useCallback(
    async (id: string | null) => {
      await actions.onSetDefault(id);
      await refetchConnections();
    },
    [actions.onSetDefault, refetchConnections],
  );
  const beginEdit = useCallback(
    (connection: DataConnection) => {
      const request = editGeneration.current + 1;
      editGeneration.current = request;
      setEditError(undefined);
      void actions
        .getForm(connection.id)
        .then((form) => {
          if (
            request !== editGeneration.current ||
            connection.id !== selectedConnectionIdRef.current
          ) {
            return;
          }
          setEditForm({
            connectionId: connection.id,
            isDraft: form.connection.isDraft,
            type: form.connection.type,
            values: form.values as ConnectionValues,
            configuredCredentialFields: form.configuredCredentialFields,
            baseline: form.baseline,
            nativeRevision: form.nativeRevision,
          });
        })
        .catch((error: unknown) => {
          if (
            request !== editGeneration.current ||
            connection.id !== selectedConnectionIdRef.current
          ) {
            return;
          }
          setEditError(errorMessage(error));
        });
    },
    [actions.getForm],
  );

  const onNavigate = useCallback(
    (target: DataBrowserNavigation) => {
      const detail = target.detail;
      if (!detail) {
        setSelectedConnectionId(undefined);
        navigate(dataBrowserHref(target.tab));
        return;
      }
      if (detail.type === "data-connection") {
        setSelectedConnectionId(detail.id);
        navigate(
          dataBrowserHref(target.tab, detail),
          target.replace ? { replace: true } : undefined,
        );
        return;
      }
      if (detail.name) {
        setNodeNames((current) =>
          new Map(current).set(detail.id, detail.name!),
        );
      }
      navigate(dataBrowserHref(target.tab, detail, selectedConnectionId));
    },
    [navigate, selectedConnectionId],
  );

  const [useInProjectPending, setUseInProjectPending] = useState(false);
  const selectedTableName =
    routeDetail && routeDetail.type !== "data-connection"
      ? (nodeNames.get(routeDetail.id) ?? providerResourceName(routeDetail.id))
      : undefined;
  const canCreateProject = capabilityAllowed(
    access.data?.capabilities,
    controls.createProject,
  );

  const selectedNodeDetail =
    canBrowseData &&
    selectedConnection &&
    selectedNodeId &&
    routeDetail &&
    routeDetail.type !== "data-connection" ? (
      <DataResourceDetail
        connectionId={selectedConnection.id}
        connectionName={selectedConnection.name}
        loadPage={loadPage}
        node={{
          type: routeDetail.type,
          id: routeDetail.id,
          name: selectedTableName,
        }}
        onNavigate={onNavigate}
        tab={view}
        onNewThread={() => void navigate("/thread")}
        useInProjectPending={useInProjectPending}
        onUseInProject={
          canCreateProject
            ? () => {
                if (useInProjectPending) return;
                setUseInProjectPending(true);
                void callAction("create-project", {
                  title: selectedTableName || "Untitled project",
                  cells: [
                    {
                      kind: "sql",
                      sourceConnectionId: selectedConnection.id,
                      sql: `SELECT * FROM ${selectedTableName || routeDetail.id} LIMIT 100`,
                    },
                  ],
                })
                  .then((created) => {
                    const id = (created as { id?: string } | undefined)?.id;
                    if (id) void navigate(`/project/${encodeURIComponent(id)}`);
                  })
                  .catch((error) => {
                    toast.error(errorMessage(error));
                  })
                  .finally(() => setUseInProjectPending(false));
              }
            : undefined
        }
      />
    ) : undefined;

  const connectionHeaderActions =
    selectedConnection && access.data?.isAdministrator ? (
      <DataPageAdapterConnectionMenu
        connection={selectedConnection}
        error={editError}
        onEdit={beginEdit}
        onSetDefault={onSetDefault}
      />
    ) : undefined;

  const sourceFamilies = useMemo(
    () => sourceFamiliesForConnections(connections),
    [connections],
  );

  const favoriteTableIds = useMemo(() => {
    const favorites =
      (
        favoritesQuery.data as
          | {
              favorites?: Array<{
                connectionId: string;
                tableId: string;
              }>;
            }
          | undefined
      )?.favorites ?? [];
    const set = new Set<string>();
    if (!selectedConnection) return set;
    for (const item of favorites) {
      if (item.connectionId === selectedConnection.id) set.add(item.tableId);
    }
    return set;
  }, [favoritesQuery.data, selectedConnection]);

  const isTreeTableFavorite = useCallback(
    (tableId: string) => {
      if (!selectedConnection) return false;
      const key = `${selectedConnection.id}:${tableId}`;
      if (key in favoritePending) return favoritePending[key] === true;
      return favoriteTableIds.has(tableId);
    },
    [favoritePending, favoriteTableIds, selectedConnection],
  );

  const handleToggleTreeFavorite = useCallback(
    (item: Dataset, next: boolean) => {
      if (!selectedConnection) return;
      const key = `${selectedConnection.id}:${item.id}`;
      setFavoritePending((current) => ({ ...current, [key]: next }));
      void setFavoriteMutation
        .mutateAsync({
          connectionId: selectedConnection.id,
          tableId: item.id,
          favorited: next,
        })
        .catch(() => {
          toast.error(t("dataBrowser.browse.favoriteTableFailed"));
        })
        .finally(() => {
          setFavoritePending((current) => {
            const copy = { ...current };
            delete copy[key];
            return copy;
          });
        });
    },
    [selectedConnection, setFavoriteMutation, t],
  );

  if (access.isPending) {
    return (
      <DataPageAdapterFrame>
        <DataPageAdapterLoading label="Loading data browser" />
      </DataPageAdapterFrame>
    );
  }
  if (access.isError) {
    return (
      <DataPageAdapterFrame>
        <DataPageAdapterFailure
          title={t("dataBrowser.error.loadingData")}
          detail={errorMessage(access.error)}
          onRetry={() => void access.refetch()}
        />
      </DataPageAdapterFrame>
    );
  }
  if (!access.data) {
    return (
      <DataPageAdapterFrame>
        <DataPageAdapterLoading label="Loading data browser" />
      </DataPageAdapterFrame>
    );
  }
  if (
    access.data.capabilities.some(
      ({ controlId, status }) =>
        controlId === controls.dataBrowse && status === "unreadable",
    )
  ) {
    return (
      <DataPageAdapterFrame>
        <DataPageAdapterFailure
          title={t("dataBrowser.error.loadingData")}
          onRetry={() => void access.refetch()}
        />
      </DataPageAdapterFrame>
    );
  }
  if (!canBrowseData) {
    return <DataPageAdapterNoAccess />;
  }

  const sharedProps = {
    tab: view,
    recommendedEnabled: true,
    canViewSemanticLayer: false,
    recommendedPanel: <DataRecommendedPanel />,
    dataModelsPanel: null,
    recentsPanel: <DataRecentsPanel />,
    favoritesPanel: <DataFavoritesPanel />,
    connections,
    schemas,
    resources: { onInviteAdmin: actions.onInviteAdmin },
    loadPage,
    save,
    testConnection: actions.testConnection,
    selectedConnectionId,
    selectedNodeId,
    selectedNodeDetail,
    onNavigate,
    loading: actions.connections.isPending,
    // Keeps the tab strip and the "Connect your data" card, and adds a demo card
    // that opens the built-in sample source (sprint-analytics-2#117).
    sampleSourcePanel: <SampleSourcePanel />,
    error: actions.connections.isError,
    onRetryConnections: () => void refetchConnections(),
    canAddConnection,
    openRequestedConnection: searchParams.get("connect") === "1",
    onCloseRequestedConnection: () => {
      if (searchParams.get("connect") !== "1") return;
      const next = new URLSearchParams(searchParams);
      next.delete("connect");
      setSearchParams(next, { replace: true });
    },
    connectionHeaderActions,
    sourceFamilies,
    canRefreshCatalog: canManageMetadata && catalogAvailable,
    catalogLastRefreshed: catalogOutput?.lastRefreshed ?? null,
    catalogRefreshing,
    // The refresh handler is not a manager-only capability: a member whose
    // connection permission allows a schema refresh gets an enabled Refresh
    // schema control, and it must do something (census CEN-analytics-2-023).
    // Whether the control is enabled stays the page's decision from its own
    // permission read; metadata editing below stays manager-only.
    catalogRefreshError:
      catalogActionError ??
      (catalogOutput?.refreshState === "failed"
        ? (catalogOutput.refreshError?.message ?? undefined)
        : undefined),
    onRefreshCatalog: () => {
      if (catalogAvailable) void runCatalogRefresh(selectedConnectionId);
    },
    rootRevision: catalogRevisionToken,
    rootEnabled,
    isFavorite: isTreeTableFavorite,
    onToggleFavorite: handleToggleTreeFavorite,
  };

  const pageProps: DataBrowserPageProps = canManageMetadata
    ? {
        ...sharedProps,
        canManageMetadata: true,
        metadata: metadataControls,
        ...(aiUsage ? { aiUsage } : {}),
      }
    : { ...sharedProps, canManageMetadata: false };

  const readError = metadata.isError
    ? metadata.error
    : catalog.isError
      ? catalog.error
      : undefined;

  return (
    <>
      {readError ? (
        <div role="alert" className="data-page-list-status">
          <span>{errorMessage(readError)}</span>
          <button
            type="button"
            className="data-page-link"
            onClick={() => {
              void metadata.refetch();
              void catalog.refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      <DataBrowserPage {...pageProps} />
      <AddDataConnectionDialog
        isOpen={access.data.isAdministrator && editForm !== undefined}
        schemas={schemas}
        resources={{ onInviteAdmin: actions.onInviteAdmin }}
        {...(editForm
          ? {
              initialType: editForm.type,
              initialValues: editForm.values,
              connectionId: editForm.connectionId,
              isDraft: editForm.isDraft,
              baseline: editForm.baseline,
              nativeRevision: editForm.nativeRevision,
              configuredCredentialFields: editForm.configuredCredentialFields,
            }
          : {})}
        onClose={() => {
          setEditForm(undefined);
          void refetchConnections();
        }}
        onSave={save}
        onTest={actions.testConnection}
      />
    </>
  );
}
