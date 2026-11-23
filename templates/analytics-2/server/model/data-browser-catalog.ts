import { createHash, randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import type { DbExec } from "@agent-native/core/db";
import {
  deleteSetting,
  deleteSettingIfValue,
  getSettingEntry,
  mutateOrgSetting,
  type StoreMutationOptions,
} from "@agent-native/core/settings";
import { z } from "zod";

import {
  DATA_CATALOG_REFRESH_PAGE_SIZE,
  DATA_CATALOG_SCOPE,
  dataBrowserCatalogOutputSchema,
  dataCatalogErrorSchema,
  dataCatalogProgressSchema,
  dataCatalogRefreshOutputSchema,
  dataCatalogRefreshStateSchema,
  dataCatalogResourceSchema,
  type DataBrowserCatalog,
  type DataCatalogRefreshResult,
  type DataCatalogResource,
  type GetDataBrowserCatalogInput,
} from "../../app/lib/model/data-catalog-contracts.js";
import { ANALYTICS_CONTROL_IDS as controls } from "../../shared/analytics-control-ids.js";
import { ALL_BIGQUERY_DATASETS } from "../../shared/workspace-warehouse-form.js";
import { requireCurrentWorkspaceCapability } from "../lib/analytics-capabilities.js";
import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { filterCatalogResources } from "./data-catalog-search.js";
import { noteOrgDataChange } from "./data-change-events.js";
import { isBuiltinSampleConnection } from "./data-connection-dto.js";
import {
  metadataOptions,
  withConnectionGuard,
} from "./data-connection-mutations.js";
import { describeBigQueryMetadataRejection } from "./data-connection-provider.js";
import {
  connectionIncludedForAgent,
  connectionPresentation,
  listConnectionDatasets,
  readBrowsableDataConnection,
} from "./data-connections.js";
import {
  readConnectionDeletionState,
  readResourcePolicyRevision,
} from "./data-resource-metadata.js";
import { resourcePolicies } from "./data-resource-policy.js";
import { resolveSchemaRefreshAccess } from "./data-schema-refresh-access.js";
import { sampleDatasetPage } from "./sample-catalog.js";
import type { WorkspaceScope } from "./scope.js";

/**
 * A saved catalog is public provider metadata for exactly one readable
 * workspace connection. It lives in the organisation's own settings under a
 * namespace this module owns, so another writer's keys are never rewritten,
 * and one connection's snapshot never shares a row with another's.
 *
 * The snapshot is bound to a server-only fingerprint of the connection source
 * configuration. A changed project, credential reference or connection state
 * makes the saved rows stale rather than letting old names and counts read as
 * current. The fingerprint, credential key material and raw config never leave
 * this module.
 */
const CATALOG_NAMESPACE = "analytics.catalog:v1";

/**
 * A refresh whose heartbeat has not moved inside this window is presented as a
 * stale lease. GET stays read-only and never takes over or clears it.
 */
export const DATA_CATALOG_REFRESH_LOCK_MS = 10 * 60 * 1000;

/**
 * A last-resort bound on provider pages per refresh. Crossing it fails the
 * refresh explicitly and keeps the earlier snapshot; it is not a catalog cap.
 */
const MAX_REFRESH_PAGES = 10_000;

const CATALOG_ERRORS = {
  data_catalog_refresh_denied: {
    status: 403,
    message: "Only workspace managers can refresh a data connection's catalog.",
  },
  data_catalog_scope_root_only: {
    status: 422,
    message:
      "This catalog lists top-level schemas only. Open a schema through the dataset loader to read its tables.",
  },
  data_catalog_cursor_stale: {
    status: 409,
    message: "The catalog page cursor is invalid. Restart from the first page.",
  },
  data_catalog_source_changed: {
    status: 409,
    message:
      "The connection source changed after this catalog was saved. Refresh the catalog.",
  },
  data_catalog_refresh_in_progress: {
    status: 409,
    message: "A catalog refresh is already running for this data connection.",
  },
  data_catalog_refresh_cursor_stuck: {
    status: 502,
    message:
      "The data source repeated a catalog cursor, so the refresh did not finish.",
  },
  data_catalog_refresh_incomplete: {
    status: 502,
    message:
      "The data source did not finish the catalog, so the refresh did not finish.",
  },
  data_catalog_refresh_failed: {
    status: 502,
    message:
      "The catalog could not be refreshed. The last saved catalog is still available.",
  },
  data_catalog_refresh_aborted: {
    status: 409,
    message:
      "The data connection changed or was removed before the refresh finished.",
  },
  data_catalog_snapshot_corrupt: {
    status: 500,
    message:
      "The saved catalog could not be read as a catalog. Refresh it to replace the stored row.",
  },
  data_catalog_transactions_unavailable: {
    status: 503,
    message:
      "This deployment cannot save a catalog refresh because it has no interactive database transactions. Nothing was written; the connection is unchanged.",
  },
  data_catalog_state_persist_failed: {
    status: 500,
    message:
      "The catalog refresh failed and its state could not be saved. The saved catalog was not replaced.",
  },
  data_catalog_cleanup_failed: {
    status: 500,
    message: "The saved catalog could not be removed.",
  },
  data_connection_ai_disabled: {
    status: 403,
    message:
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
  },
  data_connection_not_connected: {
    status: 409,
    message: "This data connection is not connected.",
  },
  data_connection_deleted: {
    status: 409,
    message: "This data connection was deleted.",
  },
  data_connection_deleting: {
    status: 409,
    message: "This data connection is being deleted.",
  },
} as const;

type CatalogErrorCode = keyof typeof CATALOG_ERRORS;

function catalogFail(code: CatalogErrorCode, message?: string): never {
  const entry = CATALOG_ERRORS[code];
  return fail(
    message ??
      (code === "data_catalog_refresh_failed"
        ? "The catalog could not be refreshed. Please try again."
        : entry.message),
    { statusCode: entry.status, errorCode: code },
  );
}

/** Private flow control; never shown to a caller and never written. */
class CatalogAbort extends Error {
  constructor(
    readonly reason: "absent" | "superseded" | "deleted" | "source-changed",
  ) {
    super(reason);
    this.name = "CatalogAbort";
  }
}

const storedSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal(DATA_CATALOG_SCOPE),
    connectionId: z.string().min(1),
    sourceFingerprint: z.string().min(1),
    warehouseFingerprint: z.string().min(1).optional(),
    nativeRevision: z.string().optional(),
    snapshotNeedsRefresh: z.boolean().optional(),
    snapshotToken: z.string().min(1),
    refreshState: dataCatalogRefreshStateSchema,
    refreshId: z.string().nullable(),
    refreshStartedAt: z.number().int().nullable(),
    heartbeatAt: z.number().int().nullable(),
    lastRefreshed: z.string().nullable(),
    refreshError: dataCatalogErrorSchema.nullable(),
    progress: dataCatalogProgressSchema.nullable(),
    totalCount: z.number().int().nonnegative(),
    resources: z.array(dataCatalogResourceSchema),
  })
  .strict()
  .refine(
    (snapshot) => snapshot.totalCount === snapshot.resources.length,
    "Catalog count does not match saved resources",
  );

type StoredSnapshot = z.infer<typeof storedSnapshotSchema>;
type CatalogStoreOptions = {
  transaction?: DbExec;
  bypassCache?: boolean;
};

function catalogKey(connectionId: string) {
  return `${CATALOG_NAMESPACE}:${encodeURIComponent(connectionId)}`;
}

/**
 * The settings store's organisation key prefix. The public org helpers do not
 * expose a transaction-aware delete, so the internal cleanup path needs the
 * exact key to join the caller's transaction. This is a stable dependency on
 * `o:<orgId>:<key>`; the module still reads/writes through public helpers.
 */
function orgKeyLocation(orgId: string, key: string) {
  return `o:${orgId}:${key}`;
}

function catalogOptions(
  options: CatalogStoreOptions = {},
): StoreMutationOptions {
  return {
    ...(options.transaction ? { transaction: options.transaction } : {}),
    bypassCache: options.bypassCache ?? true,
    validateStoredValue: (value: unknown) => {
      const parsed = storedSnapshotSchema.safeParse(value);
      if (!parsed.success) catalogFail("data_catalog_snapshot_corrupt");
    },
  } as StoreMutationOptions;
}

function parseStored(value: unknown): StoredSnapshot | null {
  if (value === undefined) return null;
  const parsed = storedSnapshotSchema.safeParse(value);
  if (!parsed.success) catalogFail("data_catalog_snapshot_corrupt");
  return parsed.data;
}

/**
 * Entry-aware read: a present JSON null, scalar, array or schema mismatch is a
 * typed corruption failure, never an absent snapshot and never resettable by
 * guessing.
 */
async function readStored(
  scope: WorkspaceScope,
  connectionId: string,
  options: CatalogStoreOptions = {},
): Promise<StoredSnapshot | null> {
  let entry;
  try {
    entry = await getSettingEntry(
      orgKeyLocation(scope.orgId, catalogKey(connectionId)),
      {
        bypassCache: options.bypassCache ?? true,
        ...(options.transaction ? { transaction: options.transaction } : {}),
      },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      catalogFail("data_catalog_snapshot_corrupt");
    throw error;
  }
  if (!entry.found) return null;
  return parseStored(entry.value);
}

export async function warehouseCatalogSnapshotToken(
  scope: WorkspaceScope,
  connectionId: string,
) {
  if (isBuiltinSampleConnection(connectionId)) return null;
  const snapshot = await readStored(scope, connectionId);
  return snapshot?.lastRefreshed ? snapshot.snapshotToken : null;
}

async function mutateCatalog(
  scope: WorkspaceScope,
  connectionId: string,
  updater: (
    current: StoredSnapshot | null,
  ) => StoredSnapshot | Promise<StoredSnapshot>,
  options: CatalogStoreOptions = {},
): Promise<StoredSnapshot> {
  try {
    const mutationOptions: StoreMutationOptions = catalogOptions(options);
    const next = await mutateOrgSetting(
      scope.orgId,
      catalogKey(connectionId),
      (raw) =>
        updater(raw === null ? null : parseStored(raw)) as unknown as Record<
          string,
          unknown
        >,
      mutationOptions,
    );
    if (options.transaction)
      noteOrgDataChange(scope.orgId, catalogKey(connectionId));
    return parseStored(next)!;
  } catch (error) {
    if (error instanceof SyntaxError)
      catalogFail("data_catalog_snapshot_corrupt");
    throw error;
  }
}

/**
 * Server-only source fingerprint. It covers the fields that determine which
 * public datasets the provider lists, plus credential-reference metadata with
 * each key hashed. No raw config value or credential key is stored or returned.
 */
function connectionSourceFingerprint(
  connection: Awaited<ReturnType<typeof readBrowsableDataConnection>>,
  includeDatasets: boolean,
): string {
  const config = connection.config;
  const projectId =
    typeof config.projectId === "string" ? config.projectId : null;
  const additionalProjectIds =
    typeof config.additionalProjectIds === "string"
      ? config.additionalProjectIds
      : null;
  const savedCredentialKeyHash =
    typeof config.serviceAccountCredentialKey === "string"
      ? createHash("sha256")
          .update(config.serviceAccountCredentialKey)
          .digest("hex")
      : null;
  const datasetNames =
    typeof config.datasetNames === "string" &&
    config.datasetNames !== ALL_BIGQUERY_DATASETS
      ? config.datasetNames.trim()
      : "";
  const credentialRefs = (connection.credentialRefs ?? [])
    .map((ref) => ({
      keyHash: createHash("sha256").update(String(ref.key)).digest("hex"),
      provider: ref.provider ?? null,
      scope: ref.scope ?? null,
    }))
    .sort((left, right) => left.keyHash.localeCompare(right.keyHash));
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: connection.provider,
        status: connection.status,
        accountId: connection.accountId,
        projectId,
        additionalProjectIds,
        ...(includeDatasets && datasetNames ? { datasetNames } : {}),
        savedCredentialKeyHash,
        credentialRefs,
      }),
    )
    .digest("hex");
}

function normalizeSearch(search: string | undefined) {
  return (search ?? "").trim().toLowerCase();
}

const cursorSchema = z
  .object({
    v: z.literal(2),
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    snapshotToken: z.string().min(1),
    policyRevision: z.number().int().nonnegative(),
    resourcePolicyRevision: z.number().int().nonnegative().default(0),
    search: z.string(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

type CursorContext = {
  orgId: string;
  connectionId: string;
  snapshotToken: string | null;
  policyRevision: number;
  resourcePolicyRevision: number;
  search: string;
};

function encodeCursor(context: CursorContext, offset: number) {
  const snapshotToken = context.snapshotToken;
  if (!snapshotToken) catalogFail("data_catalog_cursor_stale");
  return Buffer.from(
    JSON.stringify({ v: 2, ...context, snapshotToken, offset }),
    "utf8",
  ).toString("base64url");
}

function readOffset(after: string | undefined, context: CursorContext) {
  if (!after) return 0;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
  } catch {
    catalogFail("data_catalog_cursor_stale");
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.orgId !== context.orgId ||
    parsed.data.connectionId !== context.connectionId ||
    parsed.data.snapshotToken !== context.snapshotToken ||
    parsed.data.policyRevision !== context.policyRevision ||
    parsed.data.resourcePolicyRevision !== context.resourcePolicyRevision ||
    parsed.data.search !== context.search
  )
    catalogFail("data_catalog_cursor_stale");
  return parsed.data.offset;
}

function isStaleLease(stored: StoredSnapshot) {
  const heartbeat = stored.heartbeatAt ?? stored.refreshStartedAt;
  return (
    stored.refreshState === "refreshing" &&
    heartbeat !== null &&
    Date.now() - heartbeat >= DATA_CATALOG_REFRESH_LOCK_MS
  );
}

function refreshResult(
  connectionId: string,
  stored: StoredSnapshot | null,
): DataCatalogRefreshResult {
  return dataCatalogRefreshOutputSchema.parse({
    connectionId,
    refreshState: stored?.refreshState ?? "never",
    lastRefreshed: stored?.lastRefreshed ?? null,
    refreshError: stored?.refreshError ?? null,
    refreshProgress:
      stored?.refreshState === "refreshing" ? stored.progress : null,
    refreshStale: stored ? isStaleLease(stored) : false,
    totalCount: stored?.totalCount ?? 0,
  });
}

async function assertNotDeleted(
  scope: WorkspaceScope,
  connectionId: string,
  options: CatalogStoreOptions,
) {
  const state = await readConnectionDeletionState(scope, connectionId, options);
  if (state !== null) throw new CatalogAbort("deleted");
}

async function currentSource(connectionId: string) {
  const connection = await readBrowsableDataConnection(connectionId);
  return {
    connection,
    fingerprint: connectionSourceFingerprint(connection, true),
    warehouseFingerprint: connectionSourceFingerprint(connection, false),
  };
}

function matchesSource(
  stored: StoredSnapshot,
  fingerprint: string,
  nativeRevision: string | undefined,
) {
  return (
    stored.sourceFingerprint === fingerprint &&
    (stored.nativeRevision === undefined ||
      stored.nativeRevision === nativeRevision)
  );
}

function canRetainSnapshot(
  stored: StoredSnapshot,
  source: Awaited<ReturnType<typeof currentSource>>,
) {
  if (stored.lastRefreshed === null) return false;
  if (
    stored.sourceFingerprint === source.fingerprint ||
    (stored.warehouseFingerprint ?? stored.sourceFingerprint) ===
      source.warehouseFingerprint
  )
    return true;
  const { connection } = source;
  if (
    stored.warehouseFingerprint !== undefined ||
    stored.nativeRevision === undefined ||
    connection.nativeRevision === undefined ||
    connection.status !== "connected" ||
    connection.config.workspaceCredentialDraft === true
  )
    return false;
  const project = connection.config.projectId ?? connection.accountId;
  if (typeof project !== "string" || !project) return false;
  const prefix = `schema:${encodeURIComponent(project)}:`;
  return (
    stored.resources.length > 0 &&
    stored.resources.every(({ id }) => id.startsWith(prefix))
  );
}

/** Read one page of the saved catalog. This never writes. */
export async function readDataBrowserCatalog(
  input: GetDataBrowserCatalogInput,
  caller?: string,
): Promise<DataBrowserCatalog> {
  const current = await requireCurrentWorkspaceCapability(controls.dataBrowse);
  const scope: WorkspaceScope = {
    ownerEmail: current.ownerEmail,
    orgId: current.orgId,
  };
  const forAgent = caller !== "frontend";
  // Authorize the connection and its current AI policy before reading a cache
  // row, so an unreadable or opted-out id never reveals snapshot existence.
  const source = await currentSource(input.connectionId);
  const { connection, fingerprint } = source;
  if (forAgent && !(await connectionIncludedForAgent(connection)))
    catalogFail("data_connection_ai_disabled");
  if (
    forAgent &&
    (connection.status !== "connected" || connection.config.draft === true)
  )
    catalogFail("data_connection_not_connected");
  const builtin = isBuiltinSampleConnection(connection.id);
  const [deletion, stored, presentation, resourcePolicyRevision] =
    await Promise.all([
      readConnectionDeletionState(scope, connection.id),
      builtin ? null : readStored(scope, connection.id),
      connectionPresentation(connection),
      readResourcePolicyRevision(scope, connection.id, { bypassCache: true }),
    ]);
  if (deletion === "deleted") catalogFail("data_connection_deleted");
  if (deletion === "deleting") catalogFail("data_connection_deleting");
  if (input.parentId) catalogFail("data_catalog_scope_root_only");
  const sameSource =
    stored === null ||
    matchesSource(stored, fingerprint, connection.nativeRevision);
  const visibleSnapshot =
    stored !== null &&
    ((sameSource && !stored.snapshotNeedsRefresh) ||
      (!forAgent && canRetainSnapshot(stored, source)));
  const search = normalizeSearch(input.search);

  let resources: DataCatalogResource[] = builtin
    ? sampleDatasetPage({ first: DATA_CATALOG_REFRESH_PAGE_SIZE }).items
    : [];
  let refreshState = builtin ? "ready" : (stored?.refreshState ?? "never");
  let refreshError = stored?.refreshError ?? null;
  let refreshProgress = stored?.progress ?? null;
  const refreshStale = sameSource && stored !== null && isStaleLease(stored);
  let snapshotToken: string | null = builtin ? "builtin:root-schemas:v1" : null;

  if (visibleSnapshot) {
    resources = stored.resources;
    snapshotToken = stored.snapshotToken;
  }
  if (!sameSource) {
    refreshState = "stale";
    refreshError = {
      code: "data_catalog_source_changed",
      message: CATALOG_ERRORS.data_catalog_source_changed.message,
    };
    refreshProgress = null;
  }

  if (caller !== "frontend") {
    const policies = await resourcePolicies(
      scope,
      connection.id,
      resources,
      "included",
      { bypassCache: true },
    );
    resources = resources.filter(
      (resource) =>
        policies.get(`${resource.kind}:${resource.id}`) === "included",
    );
    if (
      (await readResourcePolicyRevision(scope, connection.id, {
        bypassCache: true,
      })) !== resourcePolicyRevision
    )
      catalogFail("data_catalog_cursor_stale");
  }
  const matching = filterCatalogResources(resources, search, builtin);
  const cursorContext: CursorContext = {
    orgId: scope.orgId,
    connectionId: connection.id,
    snapshotToken,
    policyRevision: presentation.annotationRevision,
    resourcePolicyRevision,
    search,
  };
  if (!builtin) {
    const latest = await currentSource(connection.id);
    if (
      latest.fingerprint !== fingerprint ||
      latest.connection.nativeRevision !== connection.nativeRevision
    )
      catalogFail("data_catalog_source_changed");
    if (
      forAgent &&
      !(await connectionIncludedForAgent(latest.connection, {
        bypassCache: true,
      }))
    )
      catalogFail("data_connection_ai_disabled");
  }
  const offset = readOffset(input.after, cursorContext);
  if (offset > 0 && offset >= matching.length)
    catalogFail("data_catalog_cursor_stale");
  const page = matching.slice(offset, offset + input.first);
  const nextOffset = offset + page.length;
  return dataBrowserCatalogOutputSchema.parse({
    connectionId: connection.id,
    scope: DATA_CATALOG_SCOPE,
    bootstrapKey: createHash("sha256")
      .update(JSON.stringify([scope.orgId, connection.id, fingerprint]))
      .digest("base64url"),
    resources: page,
    totalCount: matching.length,
    hasNextPage: nextOffset < matching.length,
    endCursor:
      nextOffset < matching.length
        ? encodeCursor(cursorContext, nextOffset)
        : null,
    refreshState,
    hasSuccessfulSnapshot:
      builtin || (visibleSnapshot && stored.lastRefreshed !== null),
    revision:
      snapshotToken === null
        ? null
        : createHash("sha256")
            .update(
              JSON.stringify([
                snapshotToken,
                presentation.annotationRevision,
                resourcePolicyRevision,
              ]),
            )
            .digest("base64url"),
    lastRefreshed: visibleSnapshot ? stored.lastRefreshed : null,
    refreshError,
    refreshProgress:
      !forAgent && refreshState === "refreshing" ? refreshProgress : null,
    refreshStale,
  });
}

type DatasetPage = Awaited<ReturnType<typeof listConnectionDatasets>>;
type ListPage = (
  input: { connectionId: string; first: number; after?: string },
  options: { forAgent: boolean },
) => Promise<DatasetPage>;

/**
 * Which gate admits this refresh. `manager` is the original contract and stays
 * the default for every direct/internal call; `connection` also admits actors
 * the connection read grants when its `canQueryCanRefreshSchema` flag is not
 * disabled.
 *
 * This is an authorization mode, not a bypass: every connection-mode denial is
 * the same `data_catalog_refresh_denied` refusal, and no mode skips the
 * workspace, AI-policy or active-connection checks below.
 */
export type SchemaRefreshAuthorization = "manager" | "connection";

export type RefreshCatalogOptions = {
  caller?: string | undefined;
  authorization?: SchemaRefreshAuthorization | undefined;
  revision?: string | undefined;
  /** Test seam only; production uses the existing provider loader. */
  listPage?: ListPage;
};

/** Refresh the saved catalog. Manager-or-above on the current workspace. */
export async function refreshDataBrowserCatalog(
  connectionId: string,
  options: RefreshCatalogOptions = {},
): Promise<DataCatalogRefreshResult> {
  const current = await requireCurrentWorkspace();
  const capabilities = await currentWorkspaceCapabilities(current);
  const authorization = options.authorization ?? "manager";
  // Connection mode re-reads the canonical permission at every guard: the
  // fingerprint ignores flags and roles, so a revocation mid-refresh would
  // otherwise commit. The manager contract below is unchanged and never
  // rechecks.
  let authorizedOnce = false;
  // The workspace and its capabilities were resolved above, outside any write
  // guard. Re-resolving them from inside the guard opened a second read against
  // the same pool while the guard transaction held its connection, which the
  // hosted deployment answered as a failed write on every refresh.
  const assertConnectionModeAccess = async () => {
    if (authorization !== "connection") return;
    let access: Awaited<ReturnType<typeof resolveSchemaRefreshAccess>>;
    try {
      access = await resolveSchemaRefreshAccess(connectionId, {
        current,
        capabilities,
      });
    } catch (error) {
      const code = (error as { errorCode?: unknown } | null)?.errorCode;
      // Losing the grant reads as a 404 once access has already been granted.
      if (authorizedOnce && code === "data_connection_not_found")
        catalogFail("data_catalog_refresh_denied");
      throw error;
    }
    if (!access.allowed) catalogFail("data_catalog_refresh_denied");
    authorizedOnce = true;
  };
  if (authorization === "manager") {
    if (!capabilities.isManagerOrAbove)
      catalogFail("data_catalog_refresh_denied");
  } else {
    await assertConnectionModeAccess();
  }
  const scope: WorkspaceScope = {
    ownerEmail: current.ownerEmail,
    orgId: current.orgId,
  };
  const forAgent = options.caller !== "frontend";
  const listPage: ListPage =
    options.listPage ??
    ((input, listOptions) =>
      listConnectionDatasets(
        {
          connectionId: input.connectionId,
          first: input.first,
          ...(input.after ? { after: input.after } : {}),
        },
        listOptions,
      ));

  const authorized = await currentSource(connectionId);
  if (
    options.revision !== undefined &&
    options.revision !== authorized.connection.nativeRevision
  )
    catalogFail("data_catalog_source_changed");
  if (forAgent && !(await connectionIncludedForAgent(authorized.connection)))
    catalogFail("data_connection_ai_disabled");

  if (isBuiltinSampleConnection(authorized.connection.id)) {
    const deletion = await readConnectionDeletionState(scope, connectionId);
    if (deletion === "deleted") catalogFail("data_connection_deleted");
    if (deletion === "deleting") catalogFail("data_connection_deleting");
    return dataCatalogRefreshOutputSchema.parse({
      connectionId,
      refreshState: "ready",
      lastRefreshed: null,
      refreshError: null,
      refreshProgress: null,
      refreshStale: false,
      totalCount: sampleDatasetPage({ first: DATA_CATALOG_REFRESH_PAGE_SIZE })
        .items.length,
    });
  }

  const refreshId = randomUUID();
  const startedAt = Date.now();

  let reservation: StoredSnapshot;
  try {
    reservation = await withConnectionGuard(
      scope,
      authorized.connection.id,
      async (tx) => {
        await assertNotDeleted(
          scope,
          authorized.connection.id,
          metadataOptions(tx),
        );
        // Re-read the permission inside the guard, so a revocation between the
        // entry check and this lease writes neither the lease nor a page.
        await assertConnectionModeAccess();
        const fresh = await currentSource(authorized.connection.id);
        const { nativeRevision } = fresh.connection;
        if (
          options.revision !== undefined &&
          options.revision !== nativeRevision
        )
          catalogFail("data_catalog_source_changed");
        if (forAgent && !(await connectionIncludedForAgent(fresh.connection)))
          catalogFail("data_connection_ai_disabled");
        return mutateCatalog(
          scope,
          authorized.connection.id,
          (stored) => {
            const sameSource =
              stored !== null &&
              matchesSource(stored, fresh.fingerprint, nativeRevision);
            if (
              sameSource &&
              stored.refreshState === "refreshing" &&
              stored.refreshId !== null &&
              (stored.heartbeatAt ?? stored.refreshStartedAt) !== null &&
              startedAt -
                (stored.heartbeatAt ?? stored.refreshStartedAt ?? startedAt) <
                DATA_CATALOG_REFRESH_LOCK_MS
            )
              catalogFail("data_catalog_refresh_in_progress");
            const retain = stored !== null && canRetainSnapshot(stored, fresh);
            return {
              schemaVersion: 1,
              scope: DATA_CATALOG_SCOPE,
              connectionId: authorized.connection.id,
              sourceFingerprint: fresh.fingerprint,
              warehouseFingerprint: fresh.warehouseFingerprint,
              ...(nativeRevision === undefined ? {} : { nativeRevision }),
              snapshotNeedsRefresh:
                retain && (!sameSource || stored.snapshotNeedsRefresh === true),
              snapshotToken: retain ? stored.snapshotToken : randomUUID(),
              refreshState: "refreshing",
              refreshId,
              refreshStartedAt: startedAt,
              heartbeatAt: startedAt,
              lastRefreshed: retain ? stored.lastRefreshed : null,
              refreshError: null,
              progress: { collectedCount: 0, pages: 0 },
              totalCount: retain ? stored.totalCount : 0,
              resources: retain ? stored.resources : [],
            };
          },
          metadataOptions(tx),
        );
      },
    );
  } catch (error) {
    if (error instanceof CatalogAbort)
      catalogFail("data_catalog_refresh_aborted");
    if (isCatalogError(error)) throw error;
    // A runtime without interactive transactions cannot hold the guard while it
    // reserves the refresh, and reporting that as a lost write sends people
    // looking at their saved catalog. It is a deployment limit, so say so.
    if (
      error instanceof Error &&
      error.message.includes("no interactive transaction support")
    )
      catalogFail("data_catalog_transactions_unavailable");
    catalogFail("data_catalog_state_persist_failed");
  }

  const assertReservedSource = async () => {
    const fresh = await currentSource(authorized.connection.id);
    if (
      fresh.fingerprint !== reservation.sourceFingerprint ||
      fresh.connection.nativeRevision !== reservation.nativeRevision
    )
      throw new CatalogAbort("source-changed");
    if (forAgent && !(await connectionIncludedForAgent(fresh.connection)))
      catalogFail("data_connection_ai_disabled");
  };

  const merged = new Map<string, DataCatalogResource>();
  const seenCursors = new Set<string>();
  let after: string | undefined;
  let pages = 0;

  const presentRefresh = async (stored: StoredSnapshot | null) => {
    const result = refreshResult(authorized.connection.id, stored);
    if (!forAgent) return result;
    const visible = await readDataBrowserCatalog(
      { connectionId: authorized.connection.id, first: 1 },
      options.caller,
    );
    return { ...result, totalCount: visible.totalCount, refreshProgress: null };
  };
  const superseded = async () => {
    const stored = await readStored(scope, authorized.connection.id);
    return presentRefresh(stored);
  };

  try {
    for (;;) {
      const page = await listPage(
        {
          connectionId: authorized.connection.id,
          first: DATA_CATALOG_REFRESH_PAGE_SIZE,
          ...(after ? { after } : {}),
        },
        { forAgent: false },
      );
      pages += 1;
      for (const item of page.items)
        if (!merged.has(item.id))
          merged.set(item.id, {
            id: item.id,
            name: item.name,
            kind: item.kind,
            ...(item.hasChildren === undefined
              ? {}
              : { hasChildren: item.hasChildren }),
          });
      if (!page.hasNextPage) break;
      if (!page.endCursor) catalogFail("data_catalog_refresh_incomplete");
      if (seenCursors.has(page.endCursor))
        catalogFail("data_catalog_refresh_cursor_stuck");
      seenCursors.add(page.endCursor);
      after = page.endCursor;
      if (pages >= MAX_REFRESH_PAGES)
        catalogFail("data_catalog_refresh_incomplete");

      await savingRefreshState(() =>
        withConnectionGuard(scope, authorized.connection.id, async (tx) => {
          const txOptions = metadataOptions(tx);
          await assertNotDeleted(scope, authorized.connection.id, txOptions);
          await assertConnectionModeAccess();
          await assertReservedSource();
          await mutateCatalog(
            scope,
            authorized.connection.id,
            (stored) => {
              if (stored === null) throw new CatalogAbort("absent");
              if (stored.refreshId !== refreshId)
                throw new CatalogAbort("superseded");
              return {
                ...stored,
                heartbeatAt: Date.now(),
                progress: { collectedCount: merged.size, pages },
              };
            },
            txOptions,
          );
        }),
      );
    }

    const resources = [...merged.values()];
    let visibleCount = resources.length;
    const completion = await savingRefreshState(() =>
      withConnectionGuard(scope, authorized.connection.id, async (tx) => {
        const txOptions = metadataOptions(tx);
        await assertNotDeleted(scope, authorized.connection.id, txOptions);
        await assertConnectionModeAccess();
        await assertReservedSource();
        if (forAgent) {
          const policies = await resourcePolicies(
            scope,
            authorized.connection.id,
            resources,
            "included",
            metadataOptions(tx),
          );
          visibleCount = resources.filter(
            (resource) =>
              policies.get(`${resource.kind}:${resource.id}`) === "included",
          ).length;
        }
        return mutateCatalog(
          scope,
          authorized.connection.id,
          (stored) => {
            if (stored === null) throw new CatalogAbort("absent");
            if (stored.refreshId !== refreshId)
              throw new CatalogAbort("superseded");
            return {
              ...stored,
              refreshState: "ready",
              snapshotNeedsRefresh: false,
              snapshotToken: randomUUID(),
              refreshId: null,
              refreshStartedAt: null,
              heartbeatAt: null,
              lastRefreshed: new Date().toISOString(),
              refreshError: null,
              progress: { collectedCount: resources.length, pages },
              totalCount: resources.length,
              resources,
            };
          },
          txOptions,
        );
      }),
    );
    return {
      ...refreshResult(authorized.connection.id, completion),
      totalCount: visibleCount,
      refreshProgress: null,
    };
  } catch (error) {
    if (error instanceof CatalogAbort) {
      if (error.reason === "superseded") return superseded();
      if (error.reason === "source-changed") {
        await persistFailure(
          scope,
          authorized.connection.id,
          refreshId,
          "data_catalog_source_changed",
        );
        catalogFail("data_catalog_source_changed");
      }
      catalogFail("data_catalog_refresh_aborted");
    }
    const resolved = resolveCatalogFailure(error);
    const diagnostic =
      resolved.message ?? describeBigQueryMetadataRejection(error);
    await persistFailure(
      scope,
      authorized.connection.id,
      refreshId,
      resolved.code,
      diagnostic,
    );
    if (resolved.statusCode !== undefined)
      return fail(
        diagnostic ?? "The catalog could not be refreshed. Please try again.",
        {
          statusCode: resolved.statusCode,
          errorCode: resolved.code,
        },
      );
    catalogFail(resolved.code as CatalogErrorCode, diagnostic);
  }
}

async function savingRefreshState<T>(save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (error instanceof CatalogAbort || isCatalogError(error)) throw error;
    return catalogFail("data_catalog_state_persist_failed");
  }
}

function isCatalogError(error: unknown): boolean {
  const code = (error as { errorCode?: unknown })?.errorCode;
  return typeof code === "string" && code in CATALOG_ERRORS;
}

function resolveCatalogFailure(error: unknown): {
  code: string;
  statusCode?: number;
  message?: string;
} {
  if (isActionContractError(error)) {
    if (error.errorCode in CATALOG_ERRORS) {
      return {
        code: error.errorCode,
        ...(error.errorCode === "data_connection_dataset_unreadable"
          ? { message: error.message }
          : {}),
      };
    }
    if (error.errorCode.startsWith("data_connection_")) {
      return {
        code: error.errorCode,
        statusCode: error.statusCode,
        message: error.message,
      };
    }
  }
  return { code: "data_catalog_refresh_failed" };
}

async function persistFailure(
  scope: WorkspaceScope,
  connectionId: string,
  refreshId: string,
  code: string,
  diagnostic?: string,
): Promise<void> {
  try {
    await withConnectionGuard(scope, connectionId, async (tx) => {
      const txOptions = metadataOptions(tx);
      await assertNotDeleted(scope, connectionId, txOptions);
      await mutateCatalog(
        scope,
        connectionId,
        (stored) => {
          if (stored === null) throw new CatalogAbort("absent");
          if (stored.refreshId !== refreshId)
            throw new CatalogAbort("superseded");
          return {
            ...stored,
            refreshState: "failed",
            refreshId: null,
            refreshStartedAt: null,
            heartbeatAt: null,
            refreshError: {
              code,
              message:
                diagnostic ??
                (code in CATALOG_ERRORS &&
                !(
                  code === "data_catalog_refresh_failed" &&
                  stored.lastRefreshed === null
                )
                  ? CATALOG_ERRORS[code as CatalogErrorCode].message
                  : "The catalog could not be refreshed. Please try again."),
            },
            progress: null,
          };
        },
        txOptions,
      );
    });
  } catch (error) {
    if (error instanceof CatalogAbort) return;
    if (isCatalogError(error)) throw error;
    catalogFail("data_catalog_state_persist_failed");
  }
}

/**
 * Removes the saved catalog for a connection. Internal post-delete cleanup:
 * the caller passes the already-authorized exact organisation and connection
 * id, so this does not require the deleted connection to still be visible. A
 * personal (no-organisation) caller skips it. Failures are not swallowed.
 */
export async function clearDataBrowserCatalog(
  scope: WorkspaceScope,
  connectionId: string,
  options: CatalogStoreOptions = {},
): Promise<void> {
  const location = orgKeyLocation(scope.orgId, catalogKey(connectionId));
  try {
    if (options.transaction) {
      const entry = await getSettingEntry(location, {
        transaction: options.transaction,
        bypassCache: options.bypassCache ?? true,
      });
      if (!entry.found) return;
      const removed = await deleteSettingIfValue(
        location,
        entry.value as Record<string, unknown>,
        { transaction: options.transaction },
      );
      if (!removed) catalogFail("data_catalog_cleanup_failed");
      noteOrgDataChange(scope.orgId, catalogKey(connectionId));
      return;
    }
    await deleteSetting(location);
  } catch {
    catalogFail("data_catalog_cleanup_failed");
  }
}
