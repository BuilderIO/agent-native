import { createHash, randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import {
  saveCredential,
  deleteCredential,
  resolveCredentialForScope,
} from "@agent-native/core/credentials";
import type { DbExec } from "@agent-native/core/db";

import {
  builtinSampleConnection,
  dataConnectionOutput,
  isBuiltinSampleConnection,
} from "./data-connection-dto.js";

export {
  builtinSampleConnection,
  dataConnectionOutput,
  isBuiltinSampleConnection,
} from "./data-connection-dto.js";
import {
  getRequestContext,
  readOrgMemberRole,
} from "@agent-native/core/server";
import {
  getOrgSetting,
  putOrgSetting,
  getUserSetting,
  getUserSettingEntry,
  putUserSetting,
  mutateUserSetting,
  mutateOrgSetting,
} from "@agent-native/core/settings";
import {
  listWorkspaceConnectionsForApp,
  listWorkspaceConnections,
  getWorkspaceConnection,
  deleteWorkspaceConnection,
  assertWorkspaceUserGroupIds,
  credentialKeyMatches,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  resolveWorkspaceConnectionCredentialForApp,
  workspaceUserGroupsIncludeUser,
  getWorkspaceConnectionGrant,
  readWorkspaceCredentialProfile,
  WorkspaceCredentialError,
  type WorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import type { ConnectionValues } from "../../app/components/data/model.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { normalizeServiceAccountJson } from "../../shared/service-account-json.js";
import { ALL_BIGQUERY_DATASETS } from "../../shared/workspace-warehouse-form.js";
import { isPostgresProviderEnabled } from "../execution/postgres-connector.js";
import { getOrganizationBigQueryDetails } from "../lib/org-bigquery-connection-details.js";
import {
  getOrganizationBigQueryCredentialReadiness,
  requireOrganizationBigQueryProjectId,
  withOrganizationBigQueryRequestContext,
} from "../lib/org-bigquery-credentials.js";
import { readOrganizationDbtConfigView } from "../lib/org-bigquery-dbt.js";
import { getAnalytics2ProviderApiRuntime } from "../lib/provider-api.js";
import {
  isOrganizationAdministrator,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { noteUserDataChange } from "./data-change-events.js";
import {
  beginConnectionDeletionPhases,
  finishConnectionDeletionPhases,
  metadataOptions,
  withConnectionGuard,
  withPersonalConnectionGuard,
  withDbTransaction,
} from "./data-connection-mutations.js";
import {
  type ConnectionPresentation,
  isAgentIncluded,
  resolveConnectionPresentation,
} from "./data-connection-policy.js";
import {
  bigQueryMetadataRejection,
  DATA_APP_ID,
  executeQueryPage,
  executeStorageQueryPage,
  cancelWarehouseJob,
  type WarehouseQueryInput,
  requestMetadata,
  runtimeForConnection,
  runtimeForSubmittedServiceAccount,
  validateBigQueryProjectAccess,
  validateSubmittedServiceAccount,
} from "./data-connection-provider.js";
import { validateDbtConfiguration } from "./data-dbt.js";
import {
  type MetadataStoreOptions,
  type StoredMetadata,
  assertConnectionWritable,
  readConnectionAnnotationOverride,
  readConnectionAnnotationOverrides,
  writeDataResourceMetadata,
  readDataResourceMetadata,
  readResourcePolicyRevision,
} from "./data-resource-metadata.js";
import { resourcePolicies } from "./data-resource-policy.js";
import { dataframeProviderType } from "./dataframe-materialization.js";
import {
  POSTGRES_CA_CERTIFICATE,
  POSTGRES_PASSWORD,
  postgresWarehouseActions,
  readPostgresConnectionProfile,
} from "./postgres-connection.js";
import { sampleDatasetPage, SAMPLE_PROJECT_ID } from "./sample-catalog.js";
import { workspaceWarehouseActions } from "./workspace-warehouse-connection.js";
import { warehouseEditOperation } from "./workspace-warehouse-edit-form.js";

const defaultKey = "analytics.data.default-connection";
// Provider requests are bounded to 30s; this lease also covers credential IO.
export const DATA_CONNECTION_SAVE_LEASE_MS = 10 * 60 * 1000;

const connectionValuesSchema = z
  .object({
    name: z.string().max(200),
    description: z.string().max(4000).optional(),
    projectId: z.string().max(200).optional(),
    additionalProjectIds: z.string().max(4000).optional(),
    // A service account limited to individual datasets cannot list the whole
    // project, so the connection can carry the datasets it may reach.
    datasetNames: z.string().max(4000).optional(),
    serviceAccount: z.string().max(65536).optional(),
    queryAccessGroupIds: z.array(z.string().max(200)).max(1000).optional(),
    viewAccessGroupIds: z.array(z.string().max(200)).max(1000).optional(),
    shareWithWorkspace: z.boolean().optional(),
    driveAccess: z.boolean().optional(),
    useBQStorageAPI: z.boolean().optional(),
    customCodeFormatting: z.boolean().optional(),
    includeForAI: z.boolean().optional(),
    disableTablePreviews: z.boolean().optional(),
    canQueryCanRefreshSchema: z.boolean().optional(),
    sqlFluffConfig: z.string().max(65536).optional(),
    hasDbtMetadata: z.boolean().optional(),
    dbtVersion: z.enum(["legacy", "current", ""]).optional(),
    dbtAccountId: z.string().max(200).optional(),
    dbtProjectId: z.string().max(200).optional(),
    dbtEnvironmentId: z.string().max(200).optional(),
    dbtCloudHostname: z.string().max(253).optional(),
    dbtToken: z.string().max(16384).optional(),
  })
  .strict();
export const connectionCanonicalBaselineSchema = z
  .object({
    description: z.string().max(4000),
    aiUsage: z.enum(["included", "excluded"]),
    annotationRevision: z.number().int().nonnegative(),
  })
  .strict();
export const saveConnectionSchema = z
  .object({
    requestId: z.string().uuid(),
    id: z.string().min(1).max(200).optional(),
    type: z.literal("bigquery"),
    values: connectionValuesSchema,
    draft: z.boolean(),
    // Nonsecret edit baseline returned by get-data-connection-form. It carries
    // no credential or config blob.
    baseline: connectionCanonicalBaselineSchema.optional(),
  })
  .strict();
export const datasetQuerySchema = z
  .object({
    connectionId: z.string().min(1).max(200),
    parentId: z.string().max(1000).optional(),
    after: z.string().max(16384).optional(),
    search: z.string().max(200).optional(),
    first: z.number().int().min(1).max(1000).default(50),
  })
  .strict();

export const datasetPageOutput = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["database", "schema", "table"]),
      hasChildren: z.boolean(),
    }),
  ),
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
});

export function connectionContext() {
  const context = getRequestContext();
  if (!context?.userEmail?.trim())
    fail("A signed-in account is required.", {
      errorCode: "data_connection_auth_required",
      statusCode: 401,
    });
  return {
    ...context,
    orgId: context.orgScope === "personal" ? undefined : context.orgId,
    userEmail: context.userEmail.trim().toLowerCase(),
  };
}
/** The canonical connection-form authorization policy (personal or org admin). */
export async function manager() {
  const ctx = connectionContext();
  if (ctx.orgId) {
    const role = await readOrgMemberRole(ctx.orgId, ctx.userEmail);
    if (!isOrganizationAdministrator(role))
      fail("Only workspace admins can view or edit this configuration.", {
        errorCode: "data_connection_admin_required",
        statusCode: 403,
      });
  }
  return ctx;
}
export async function defaultDataConnectionId() {
  const ctx = connectionContext();
  const value = ctx.orgId
    ? await getOrgSetting(ctx.orgId, defaultKey)
    : await getUserSetting(ctx.userEmail, defaultKey);
  if (value === null) return null;
  if (value.id === null || typeof value.id === "string") return value.id;
  fail("The default data connection could not be read.", {
    errorCode: "data_connection_default_unreadable",
    statusCode: 503,
  });
}
function toDto(
  connection: WorkspaceConnectionForApp,
  selected: string | null,
  presentation: ConnectionPresentation,
  nativeAllMembers = false,
): z.infer<typeof dataConnectionOutput> {
  const cfg = connection.config;
  const shared =
    !!connection.orgId &&
    cfg.workspaceConnectionScope !== "user" &&
    connection.credentialRefs.every(
      (ref) => ref.scope === "org" || ref.scope === "workspace",
    ) &&
    connection.allowedUsers.length === 0 &&
    !connection.allowedUserGroups?.length;
  return dataConnectionOutput.parse({
    id: connection.id,
    name: connection.label,
    type: connection.provider,
    description: presentation.description,
    isDefault: selected === connection.id,
    isDraft: cfg.draft === true || cfg.workspaceCredentialDraft === true,
    shared,
    canQuery: shared
      ? "All workspace members"
      : connection.allowedUserGroups?.length
        ? `${connection.allowedUserGroups.length} group${connection.allowedUserGroups.length === 1 ? "" : "s"}`
        : "Admins only",
    aiUsage: presentation.effectiveAiUsage,
    hasDbtMetadata:
      cfg.hasDbtMetadata === true ||
      (cfg.dbt !== undefined &&
        cfg.dbt !== null &&
        typeof cfg.dbt === "object" &&
        Object.keys(cfg.dbt).length > 0),
    canView:
      nativeAllMembers ||
      (Array.isArray(cfg.viewAccessGroupIds) &&
        cfg.viewAccessGroupIds.includes("workspace"))
        ? "All workspace members"
        : Array.isArray(cfg.viewAccessGroupIds) && cfg.viewAccessGroupIds.length
          ? `${cfg.viewAccessGroupIds.length} group${cfg.viewAccessGroupIds.length === 1 ? "" : "s"}`
          : "Admins only",
  });
}
/**
 * One authoritative presentation for a visible connection: canonical
 * annotation fields win once initialized, otherwise the legacy config value is
 * the fallback, and a missing legacy AI boolean resolves to excluded.
 * Personal scopes have no organisation annotation namespace and use legacy
 * values only.
 */
export async function connectionPresentation(
  connection: Pick<WorkspaceConnectionForApp, "id" | "config">,
  options: MetadataStoreOptions = {},
): Promise<ConnectionPresentation> {
  const ctx = connectionContext();
  const override = ctx.orgId
    ? await readConnectionAnnotationOverride(
        { ownerEmail: ctx.userEmail, orgId: ctx.orgId },
        connection.id,
        { bypassCache: true, ...options },
      )
    : null;
  return resolveConnectionPresentation(connection.config, override);
}

export async function connectionPresentations(
  connections: readonly Pick<WorkspaceConnectionForApp, "id" | "config">[],
  options: MetadataStoreOptions = {},
): Promise<ConnectionPresentation[]> {
  const ctx = connectionContext();
  const overrides = ctx.orgId
    ? await readConnectionAnnotationOverrides(
        { ownerEmail: ctx.userEmail, orgId: ctx.orgId },
        connections.map((connection) => connection.id),
        { bypassCache: true, ...options },
      )
    : new Map<string, StoredMetadata | null>();
  return connections.map((connection) =>
    resolveConnectionPresentation(
      connection.config,
      overrides.get(connection.id) ?? null,
    ),
  );
}

/** The canonical AI gate used by every agent-visible connection path. */
export async function connectionIncludedForAgent(
  connection: Pick<WorkspaceConnectionForApp, "id" | "config">,
  options: MetadataStoreOptions = {},
): Promise<boolean> {
  return isAgentIncluded(await connectionPresentation(connection, options));
}

async function organizationDataConnection(
  selectedPromise: Promise<string | null>,
): Promise<z.infer<typeof dataConnectionOutput> | null> {
  const ctx = connectionContext();
  if (!ctx.orgId) return null;
  const detailsPromise = getOrganizationBigQueryDetails({
    orgId: ctx.orgId,
  }).then(
    (details) => ({ ok: true as const, details }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const dbtPromise = readOrganizationDbtConfigView(ctx.orgId).then(
    (view) => view.dbtEnabled,
    () => false,
  );
  const [readiness, selected] = await Promise.all([
    getOrganizationBigQueryCredentialReadiness({
      orgId: ctx.orgId,
      userEmail: ctx.userEmail,
    }),
    selectedPromise,
  ]);
  if (readiness !== "configured") return null;
  const [detailsResult, hasDbtMetadata] = await Promise.all([
    detailsPromise,
    dbtPromise,
  ]);
  if (!detailsResult.ok) throw detailsResult.error;
  const details = detailsResult.details;
  const name = details?.connectionName.trim();
  const description = details?.connectionDescription.trim();
  return dataConnectionOutput.parse({
    id: ORGANIZATION_BIGQUERY_SOURCE_ID,
    name: name || "Organization BigQuery",
    type: "bigquery",
    ...(description ? { description } : {}),
    isDefault: selected === ORGANIZATION_BIGQUERY_SOURCE_ID,
    isDraft: false,
    shared: true,
    canQuery: "All workspace members",
    canView: "All workspace members",
    aiUsage: "included",
    hasDbtMetadata,
  });
}

export async function hasConfiguredDataConnection(): Promise<boolean> {
  const ctx = connectionContext();
  const [bigQueryConnections, postgresConnections, orgReadiness] =
    await Promise.all([
      listWorkspaceConnectionsForApp({
        appId: DATA_APP_ID,
        provider: "bigquery",
        includeDisabled: true,
      }),
      isPostgresProviderEnabled()
        ? listWorkspaceConnectionsForApp({
            appId: DATA_APP_ID,
            provider: "postgres",
          })
        : Promise.resolve([]),
      ctx.orgId
        ? getOrganizationBigQueryCredentialReadiness({
            orgId: ctx.orgId,
            userEmail: ctx.userEmail,
          })
        : Promise.resolve("unconfigured" as const),
    ]);
  if (orgReadiness === "configured") return true;
  return [...bigQueryConnections, ...postgresConnections].some(
    (connection) =>
      connection.id !== ORGANIZATION_BIGQUERY_SOURCE_ID &&
      connection.config?.draft !== true &&
      connection.config?.workspaceCredentialDraft !== true &&
      connection.status === "connected",
  );
}

export async function listDataConnections(
  options: { forAgent?: boolean } = {},
) {
  connectionContext();
  const selectedPromise = defaultDataConnectionId();
  const nativePromise = Promise.all([
    listWorkspaceConnectionsForApp({
      appId: DATA_APP_ID,
      provider: "bigquery",
      includeDisabled: true,
    }),
    isPostgresProviderEnabled()
      ? listWorkspaceConnectionsForApp({
          appId: DATA_APP_ID,
          provider: "postgres",
        })
      : Promise.resolve([]),
  ]).then(async ([bigQueryConnections, postgresConnections]) => {
    const checked = await Promise.all(
      [...bigQueryConnections, ...postgresConnections]
        .filter(
          (connection) => connection.id !== ORGANIZATION_BIGQUERY_SOURCE_ID,
        )
        .map(checkedConnectionProfile),
    );
    const connections = checked.filter((entry) => entry.editable);
    const presentations = await connectionPresentations(
      connections.map(({ connection }) => connection),
      { bypassCache: false },
    );
    const selected = await selectedPromise;
    return connections
      .map(({ connection, nativeAllMembers }, index) => ({
        connection,
        nativeAllMembers,
        presentation: presentations[index]!,
      }))
      .filter(
        ({ connection, presentation }) =>
          !options.forAgent ||
          (isAgentIncluded(presentation) &&
            connection.config.draft !== true &&
            connection.status === "connected"),
      )
      .map(({ connection, presentation, nativeAllMembers }) =>
        toDto(connection, selected, presentation, nativeAllMembers),
      )
      .concat([dataConnectionOutput.parse(builtinSampleConnection())]);
  });
  const [native, organization] = await Promise.all([
    nativePromise,
    organizationDataConnection(selectedPromise),
  ]);
  return organization ? [organization, ...native] : native;
}
async function checkedConnectionProfile(connection: WorkspaceConnectionForApp) {
  if (connection.provider === "postgres") {
    try {
      const profile = await readPostgresConnectionProfile(connection.id);
      return {
        connection: profile.connection,
        editable: true,
        nativeAllMembers: true,
        nativeRevision: profile.revision,
      };
    } catch (error) {
      if (
        isActionContractError(error) &&
        error.errorCode === "data_connection_unavailable"
      )
        return { connection, editable: false, nativeAllMembers: false };
      throw error;
    }
  }
  const signaled =
    connection.config.workspaceCredentialProfile !== undefined ||
    connection.credentialRefs.some(
      (ref) => ref.ref === "workspace-connection",
    ) ||
    connection.explicitGrant?.config.workspaceCredentialProfile !== undefined ||
    connection.explicitGrant?.credentialRefs.some(
      (ref) => ref.ref === "workspace-connection",
    ) === true;
  if (!signaled) return { connection, editable: true, nativeAllMembers: false };
  const profile = await (async () => {
    try {
      return await readWorkspaceCredentialProfile({
        appId: DATA_APP_ID,
        provider: "bigquery",
        connectionId: connection.id,
        requestContext: getRequestContext(),
      });
    } catch (error) {
      if (
        error instanceof WorkspaceCredentialError &&
        error.code === "forbidden"
      ) {
        return null;
      }
      fail("The selected data connection is unavailable.", {
        statusCode: 503,
        errorCode: "data_connection_unavailable",
      });
    }
  })();
  if (!profile) return { connection, editable: false, nativeAllMembers: false };
  return {
    connection: profile.connection,
    editable:
      profile.active ||
      profile.connection.config.workspaceCredentialDraft === true,
    nativeAllMembers: true,
    nativeRevision: profile.revision,
  };
}
/**
 * The organisation BigQuery source is a virtual connection: `listDataConnections`
 * synthesises it from the workspace credential, so it has no row in the
 * workspace-connection store and `readDataConnection` answers "Data connection
 * not found" for its id. A caller that accepts either kind of connection asks
 * this first: it reports whether the workspace credential is configured and
 * whether agents may read it (the source is always included, matching
 * `organizationDataConnection`).
 */
export async function organizationSourceAccess(): Promise<{
  configured: boolean;
  includedForAgent: boolean;
}> {
  const ctx = connectionContext();
  if (!ctx.orgId) return { configured: false, includedForAgent: false };
  const readiness = await getOrganizationBigQueryCredentialReadiness({
    orgId: ctx.orgId,
    userEmail: ctx.userEmail,
  });
  return { configured: readiness === "configured", includedForAgent: true };
}

/**
 * The workspace's organization BigQuery source as the connection record the
 * read paths understand. It is virtual: the credential lives in the org vault
 * and there is no workspace-connection row, so every reader that takes a
 * connection id from the data browser would answer "Data connection not
 * found" for it. Returns null when the workspace has no usable credential.
 */
async function organizationSourceConnection(): Promise<WorkspaceConnectionForApp | null> {
  const ctx = connectionContext();
  if (!ctx.orgId) return null;
  const readiness = await getOrganizationBigQueryCredentialReadiness({
    orgId: ctx.orgId,
    userEmail: ctx.userEmail,
  });
  if (readiness !== "configured") return null;
  const projectId = await requireOrganizationBigQueryProjectId({
    orgId: ctx.orgId,
    userEmail: ctx.userEmail,
  });
  const details = await getOrganizationBigQueryDetails({ orgId: ctx.orgId });
  const now = new Date(0).toISOString();
  return {
    id: ORGANIZATION_BIGQUERY_SOURCE_ID,
    provider: "bigquery",
    label: details?.connectionName.trim() || "Organization BigQuery",
    accountId: projectId,
    accountLabel: projectId,
    status: "connected",
    scopes: [],
    config: { projectId, credentialScope: "org", includeForAI: true },
    allowedApps: [DATA_APP_ID],
    allowedUsers: [],
    credentialRefs: [
      { key: "BIGQUERY_PROJECT_ID", scope: "org", provider: "bigquery" },
      {
        key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        scope: "org",
        provider: "bigquery",
      },
    ],
    ownerEmail: ctx.userEmail,
    orgId: ctx.orgId,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: null,
    lastError: null,
    appAccess: {
      appId: DATA_APP_ID,
      available: true,
      mode: "all-apps",
      reason: "The workspace BigQuery source is shared with every app.",
      grantId: null,
    },
    explicitGrant: null,
  };
}

/**
 * The reader for paths that accept any connection the data browser can show,
 * including the virtual organization source. Write paths keep using
 * `readDataConnection`, which stays strict about real connection rows.
 */
export async function readBrowsableDataConnection(
  id: string,
): Promise<WorkspaceConnectionForApp & { nativeRevision?: string }> {
  if (isBuiltinSampleConnection(id)) {
    const current = await requireCurrentWorkspace();
    const now = new Date(0).toISOString();
    return {
      id,
      provider: "sample",
      label: builtinSampleConnection().name,
      accountId: SAMPLE_PROJECT_ID,
      accountLabel: SAMPLE_PROJECT_ID,
      status: "connected",
      scopes: [],
      config: { projectId: SAMPLE_PROJECT_ID, includeForAI: true },
      allowedApps: [DATA_APP_ID],
      allowedUsers: [],
      credentialRefs: [],
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      lastError: null,
      appAccess: {
        appId: DATA_APP_ID,
        available: true,
        mode: "all-apps",
        reason: "The bundled sample source is available in this app.",
        grantId: null,
      },
      explicitGrant: null,
    };
  }
  if (id === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    const organization = await organizationSourceConnection();
    if (!organization)
      fail("The organization BigQuery connection is not configured.", {
        errorCode: "data_connection_not_connected",
        statusCode: 409,
      });
    return organization;
  }
  return readDataConnection(id);
}

export async function readDataConnection(
  id: string,
): Promise<WorkspaceConnectionForApp & { nativeRevision?: string }> {
  if (isPostgresProviderEnabled()) {
    const stored = await getWorkspaceConnection(id);
    if (stored?.provider === "postgres") {
      const profile = await readPostgresConnectionProfile(id);
      return { ...profile.connection, nativeRevision: profile.revision };
    }
  }
  const rows = await listWorkspaceConnectionsForApp({
    appId: DATA_APP_ID,
    provider: "bigquery",
    includeDisabled: true,
  });
  const candidate = rows.find((row) => row.id === id);
  const checked = candidate ? await checkedConnectionProfile(candidate) : null;
  if (!checked?.editable)
    fail("Data connection not found.", {
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
  return checked.nativeRevision
    ? { ...checked.connection, nativeRevision: checked.nativeRevision }
    : checked.connection;
}

export async function resolveSavedBigQueryTestCredentials(
  connectionId: string,
  options: {
    driveAccess?: boolean | undefined;
    resolveServiceAccount: boolean;
    resolveDbtToken: boolean;
  },
): Promise<{
  runtime?: ReturnType<typeof runtimeForSubmittedServiceAccount> | undefined;
  dbtToken?: string | undefined;
}> {
  await manager();
  const existing = await readDataConnection(connectionId);
  if (existing.provider !== "bigquery")
    fail("Data connection not found.", {
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
  const isLegacyDraft =
    existing.config.draft === true && existing.status === "disabled";
  let runtime: ReturnType<typeof runtimeForSubmittedServiceAccount> | undefined;
  if (options.resolveServiceAccount) {
    const oldKey = serviceAccountKey(existing);
    if (!oldKey)
      fail("Service account configuration (JSON) is required.", {
        errorCode: "data_connection_credentials_required",
        statusCode: 422,
      });
    const authentication = {
      driveAccess: options.driveAccess ?? existing.config.driveAccess === true,
    };
    runtime = isLegacyDraft
      ? runtimeForSubmittedServiceAccount(
          await savedDraftCredential(existing, oldKey),
          authentication,
        )
      : await runtimeForConnection(existing.id, oldKey, authentication);
  }
  let dbtToken: string | undefined;
  if (
    options.resolveDbtToken &&
    typeof existing.config.dbtCredentialKey === "string"
  ) {
    if (isLegacyDraft) {
      dbtToken = await savedDraftCredential(
        existing,
        existing.config.dbtCredentialKey,
      );
    } else {
      const credential = await resolveWorkspaceConnectionCredentialForApp({
        appId: DATA_APP_ID,
        provider: "bigquery",
        connectionId: existing.id,
        key: existing.config.dbtCredentialKey,
      });
      if (credential.status === "error")
        fail(
          "The saved integration credential could not be read. Please try again.",
          {
            errorCode: "data_connection_integration_credentials_unreadable",
            statusCode: 503,
          },
        );
      if (credential.available && credential.value) dbtToken = credential.value;
    }
  }
  return { runtime, dbtToken };
}
export async function canReadConnectionResults(id: string): Promise<boolean> {
  const ctx = connectionContext();
  if (isBuiltinSampleConnection(id)) return true;
  if (id === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    // The workspace BigQuery source is virtual: it has no workspace-connection
    // row, so its result access follows the organisation credential that backs
    // it, and every member of that workspace may read its results. The
    // credential lives in the member's workspace, not in their personal scope,
    // so this asks the workspace the query path runs in: `connectionContext()`
    // blanks orgId for a personal scope, which would refuse the readback of a
    // result the same session was allowed to produce (sprint-analytics-2#819).
    const current = await requireCurrentWorkspace();
    return (
      (await getOrganizationBigQueryCredentialReadiness({
        orgId: current.orgId,
        userEmail: ctx.userEmail,
      })) === "configured"
    );
  }
  const connection = await getWorkspaceConnection(id);
  if (connection?.provider === "postgres") {
    try {
      await readPostgresConnectionProfile(id);
      return true;
    } catch (error) {
      if (
        isActionContractError(error) &&
        error.statusCode === 403 &&
        error.errorCode === "data_connection_unavailable"
      )
        return false;
      throw error;
    }
  }
  if (
    !connection ||
    connection.provider !== "bigquery" ||
    connection.status !== "connected" ||
    connection.config.draft === true
  )
    return false;
  if (
    connection.config.workspaceConnectionScope === "user" &&
    connection.ownerEmail !== ctx.userEmail
  )
    return false;
  if (
    connection.allowedApps.length &&
    !connection.allowedApps.includes(DATA_APP_ID) &&
    !(await getWorkspaceConnectionGrant(id, DATA_APP_ID))
  )
    return false;
  if (!ctx.orgId) return connection.ownerEmail === ctx.userEmail;
  const role = await readOrgMemberRole(ctx.orgId, ctx.userEmail);
  if (role === "owner" || role === "admin") return true;
  if (!role) return false;
  const queryConnections = await listWorkspaceConnectionsForApp({
    appId: DATA_APP_ID,
    provider: "bigquery",
    includeDisabled: true,
  });
  if (queryConnections.some((row) => row.id === id)) return true;
  const groups = z
    .array(z.string())
    .safeParse(
      connection.config.viewAccessGroupIds === undefined
        ? []
        : connection.config.viewAccessGroupIds,
    );
  if (!groups.success)
    fail("The data connection result access settings could not be read.", {
      errorCode: "data_connection_result_access_unreadable",
      statusCode: 503,
    });
  return (
    groups.data.includes("workspace") ||
    (await workspaceUserGroupsIncludeUser(
      ctx.orgId,
      groups.data,
      ctx.userEmail,
    ))
  );
}
function serviceAccountKey(
  connection: Pick<WorkspaceConnectionForApp, "config" | "credentialRefs">,
): string | undefined {
  const saved = connection.config.serviceAccountCredentialKey;
  if (
    typeof saved === "string" &&
    connection.credentialRefs.some((ref) => ref.key === saved)
  )
    return saved;
  return connection.credentialRefs.find((ref) =>
    credentialKeyMatches(
      "bigquery",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      ref.key,
    ),
  )?.key;
}
async function savedDraftCredential(
  connection: { id: string },
  key: string,
): Promise<string> {
  const ctx = await manager();
  const current = await getWorkspaceConnection(connection.id);
  const ref = current?.credentialRefs.find(
    (candidate) => candidate.key === key,
  );
  const expectedScope = ctx.orgId ? "org" : "user";
  if (
    !current ||
    current.config.draft !== true ||
    current.status !== "disabled" ||
    !ref ||
    ref.provider !== "bigquery" ||
    ref.scope !== expectedScope ||
    (current.orgId ?? null) !== (ctx.orgId ?? null) ||
    (!ctx.orgId && current.ownerEmail !== ctx.userEmail)
  )
    fail("The saved draft credential is not accessible in this workspace.", {
      errorCode: "data_connection_draft_credentials_denied",
      statusCode: 403,
    });
  if (ctx.orgId)
    await assertConnectionWritable(
      { ownerEmail: ctx.userEmail, orgId: ctx.orgId },
      connection.id,
      { bypassCache: true },
    );
  let value: string | undefined;
  try {
    value = await resolveCredentialForScope(key, {
      userEmail: ctx.userEmail,
      ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
      scope: expectedScope,
      throwOnUnreadable: true,
    });
  } catch {
    fail("The saved draft credential could not be read. Please try again.", {
      errorCode: "data_connection_draft_credentials_unreadable",
      statusCode: 503,
    });
  }
  if (!value)
    fail(
      "The saved draft credential is missing. Re-enter it before connecting.",
      {
        errorCode: "data_connection_draft_credentials_missing",
        statusCode: 409,
      },
    );
  return value;
}
function canonicalConnectionValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((entry: unknown) => canonicalConnectionValue(entry));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalConnectionValue(entry)]),
    );
  return value;
}
function connectionSaveRevision(
  connection: Pick<
    WorkspaceConnectionForApp,
    | "id"
    | "provider"
    | "ownerEmail"
    | "orgId"
    | "label"
    | "accountId"
    | "status"
    | "config"
    | "credentialRefs"
    | "allowedApps"
    | "allowedUsers"
    | "allowedUserGroups"
  > | null,
): string | null {
  if (!connection) return null;
  const {
    id,
    provider,
    ownerEmail,
    orgId,
    label,
    accountId,
    status,
    config,
    credentialRefs,
    allowedApps,
    allowedUsers,
    allowedUserGroups,
  } = connection;
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalConnectionValue({
          id,
          provider,
          ownerEmail,
          orgId,
          label,
          accountId,
          status,
          config,
          credentialRefs,
          allowedApps,
          allowedUsers,
          allowedUserGroups,
        }),
      ),
    )
    .digest("hex");
}
function operationKey(requestId: string) {
  const ctx = connectionContext();
  return `analytics.data.save:${ctx.orgId ?? "personal"}:${requestId}`;
}
async function finishCommittedCredentialCleanup(requestId: string) {
  const ctx = connectionContext();
  const operation = operationKey(requestId);
  const current = await getUserSetting(ctx.userEmail, operation, {
    bypassCache: true,
  });
  if (current?.status !== "complete")
    fail("The connection save has not completed.", {
      errorCode: "data_connection_save_pending",
      statusCode: 409,
    });
  const keys = z
    .array(z.string())
    .safeParse(current.cleanupKeys === undefined ? [] : current.cleanupKeys);
  if (!keys.success)
    fail("The saved connection credential cleanup record could not be read.", {
      errorCode: "data_connection_save_cleanup_corrupt",
      statusCode: 503,
    });
  if (!keys.data.length) return;
  try {
    const retained = new Set(
      (await listWorkspaceConnections({ includeDisabled: true })).flatMap(
        connectionCredentialKeys,
      ),
    );
    for (const key of keys.data)
      if (!retained.has(key))
        await deleteCredential(key, {
          userEmail: ctx.userEmail,
          ...(ctx.orgId
            ? { orgId: ctx.orgId, scope: "org" as const }
            : { scope: "user" as const }),
        });
    await mutateUserSetting(ctx.userEmail, operation, (fresh) => {
      if (
        fresh?.status !== "complete" ||
        fresh.connectionId !== current.connectionId
      )
        fail("The saved connection changed during credential cleanup.", {
          errorCode: "data_connection_save_cleanup_conflict",
          statusCode: 409,
        });
      return { ...fresh, cleanupKeys: [] };
    });
  } catch {
    fail(
      "The connection was saved but its previous credential could not be removed. Retry this same save request.",
      {
        errorCode: "data_connection_saved_cleanup_pending",
        statusCode: 503,
        details: {
          requestId,
          connectionId: current.connectionId,
          saveCommitted: true,
        },
      },
    );
  }
}
export async function getDataConnectionSaveResult(requestId: string) {
  const ctx = connectionContext();
  const saved = await getUserSetting(ctx.userEmail, operationKey(requestId), {
    bypassCache: true,
  });
  if (!saved || typeof saved.connectionId !== "string")
    fail("The connection save has not completed.", {
      errorCode: "data_connection_save_not_found",
      statusCode: 404,
    });
  if (saved.status !== "complete")
    fail(
      saved.status === "failed"
        ? "The connection save failed. Retry with the same request."
        : "The connection save is still in progress.",
      {
        errorCode:
          saved.status === "failed"
            ? "data_connection_save_failed"
            : "data_connection_save_pending",
        statusCode: 409,
      },
    );
  const pendingCleanup = z
    .array(z.string())
    .safeParse(saved.cleanupKeys === undefined ? [] : saved.cleanupKeys);
  if (!pendingCleanup.success)
    fail("The saved connection credential cleanup record could not be read.", {
      errorCode: "data_connection_save_cleanup_corrupt",
      statusCode: 503,
    });
  if (pendingCleanup.data.length)
    fail(
      "The connection was saved but its previous credential cleanup is pending. Retry this same save request.",
      {
        errorCode: "data_connection_saved_cleanup_pending",
        statusCode: 503,
        details: {
          requestId,
          connectionId: saved.connectionId,
          saveCommitted: true,
        },
      },
    );
  const connection = await readDataConnection(saved.connectionId);
  return toDto(
    connection,
    await defaultDataConnectionId(),
    await connectionPresentation(connection),
  );
}

export async function saveDataConnection(
  input: z.infer<typeof saveConnectionSchema>,
) {
  const ctx = await manager();
  const operation = operationKey(input.requestId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const previous = input.id ? await readDataConnection(input.id) : null;
  // Native row, grant and vault updates must stay on the same credential
  // substrate; the legacy writer cannot preserve that profile.
  if (
    previous &&
    (previous.config.workspaceCredentialProfile !== undefined ||
      previous.credentialRefs.some((ref) => ref.ref === "workspace-connection"))
  )
    fail("This connection cannot be updated.", {
      errorCode: "data_connection_profile_conflict",
      statusCode: 409,
    });
  const attemptId = randomUUID();
  const reservation = await mutateUserSetting(
    ctx.userEmail,
    operation,
    async (current) => {
      if (current) {
        const requestedTarget = input.id ?? null;
        const modeMismatch =
          Object.hasOwn(current, "targetId") &&
          current.targetId !== requestedTarget;
        const idMismatch =
          input.id !== undefined && current.connectionId !== input.id;
        const legacyEditAsCreate =
          current.status !== "complete" &&
          !Object.hasOwn(current, "targetId") &&
          input.id === undefined &&
          typeof current.connectionId === "string" &&
          (await getWorkspaceConnection(current.connectionId));
        if (modeMismatch || idMismatch || legacyEditAsCreate)
          fail("This save request belongs to a different connection.", {
            statusCode: 409,
            errorCode: "data_connection_request_conflict",
          });
      }
      if (current?.status === "complete") {
        if (current.fingerprint !== fingerprint)
          fail("This save request was already used. Please try again.", {
            errorCode: "data_connection_request_conflict",
            statusCode: 409,
          });
        return current;
      }
      if (
        current?.status === "pending" &&
        (typeof current.reservedAtMs !== "number" ||
          Date.now() - current.reservedAtMs < DATA_CONNECTION_SAVE_LEASE_MS)
      )
        fail("This connection save is already in progress.", {
          errorCode: "data_connection_save_pending",
          statusCode: 409,
        });
      return {
        connectionId:
          typeof current?.connectionId === "string"
            ? current.connectionId
            : (previous?.id ?? randomUUID()),
        fingerprint,
        attemptId,
        targetId: input.id ?? null,
        status: "pending",
        reservedAtMs: Date.now(),
        cleanupKeys: [
          ...new Set([
            ...(Array.isArray(current?.cleanupKeys) ? current.cleanupKeys : []),
            ...(Array.isArray(current?.stagedKeys) ? current.stagedKeys : []),
          ]),
        ],
        stagedKeys: [],
      };
    },
  );
  if (reservation.status === "complete") {
    await finishCommittedCredentialCleanup(input.requestId);
    return getDataConnectionSaveResult(input.requestId);
  }
  if (typeof reservation.connectionId !== "string")
    fail("The connection save could not be reserved.", {
      errorCode: "data_connection_save_unavailable",
      statusCode: 503,
    });
  const id = reservation.connectionId;
  const values = input.values;
  const stagedKeys: string[] = [];
  const pendingCleanupKeys = new Set(
    Array.isArray(reservation.cleanupKeys)
      ? reservation.cleanupKeys.filter(
          (key): key is string => typeof key === "string",
        )
      : [],
  );
  let committed = false;
  const scope = ctx.orgId
    ? { ownerEmail: ctx.userEmail, orgId: ctx.orgId }
    : null;
  const credentialScope = {
    userEmail: ctx.userEmail,
    ...(ctx.orgId
      ? { orgId: ctx.orgId, scope: "org" as const }
      : { scope: "user" as const }),
  };
  const persistStage = async () => {
    await mutateUserSetting(ctx.userEmail, operation, (current) => {
      if (current?.attemptId !== attemptId || current.status !== "pending")
        fail("This save attempt was superseded. Retry this same request.", {
          statusCode: 409,
          errorCode: "data_connection_save_superseded",
        });
      return {
        ...current,
        cleanupKeys: [...pendingCleanupKeys],
        stagedKeys: [...stagedKeys],
      };
    });
  };
  try {
    if (pendingCleanupKeys.size) {
      const retained = new Set(
        (await listWorkspaceConnections({ includeDisabled: true })).flatMap(
          connectionCredentialKeys,
        ),
      );
      for (const key of pendingCleanupKeys) {
        if (typeof key !== "string")
          fail("The save cleanup record could not be read.", {
            statusCode: 500,
            errorCode: "data_connection_save_cleanup_corrupt",
          });
        if (!retained.has(key)) await deleteCredential(key, credentialScope);
        pendingCleanupKeys.delete(key);
      }
    }
    const existing = previous ?? (await getWorkspaceConnection(id));
    const validatedRevision = connectionSaveRevision(existing);
    if (existing && existing.provider !== "bigquery")
      fail("This connection cannot be updated.", {
        errorCode: "data_connection_conflict",
        statusCode: 409,
      });
    const name = values.name.trim();
    if (!name)
      fail("Name is required.", {
        errorCode: "data_connection_name_required",
        statusCode: 422,
      });
    const projectId =
      values.projectId?.trim() ||
      (typeof existing?.config.projectId === "string"
        ? existing.config.projectId
        : "");
    const raw = normalizeServiceAccountJson(values.serviceAccount ?? "");
    const oldKey = existing ? serviceAccountKey(existing) : undefined;
    if (!input.draft) {
      if (!projectId)
        fail("Project ID is required.", {
          errorCode: "data_connection_project_required",
          statusCode: 422,
        });
      const authentication = {
        driveAccess:
          values.driveAccess ?? existing?.config.driveAccess === true,
      };
      if (raw)
        await validateSubmittedServiceAccount(projectId, raw, authentication);
      else if (
        existing?.config.draft === true &&
        existing.status === "disabled" &&
        oldKey
      )
        await validateSubmittedServiceAccount(
          projectId,
          await savedDraftCredential(existing, oldKey),
          authentication,
        );
      else if (existing && oldKey)
        await validateBigQueryProjectAccess(
          await runtimeForConnection(existing.id, oldKey, authentication),
          projectId,
        );
      else
        fail("Service account configuration (JSON) is required.", {
          errorCode: "data_connection_credentials_required",
          statusCode: 422,
        });
      const integration = { ...(existing?.config ?? {}), ...values };
      if (integration.hasDbtMetadata === true) {
        let token = values.dbtToken;
        if (
          !token &&
          existing &&
          typeof existing.config.dbtCredentialKey === "string"
        ) {
          if (
            existing.config.draft === true &&
            existing.status === "disabled"
          ) {
            token = await savedDraftCredential(
              existing,
              existing.config.dbtCredentialKey,
            );
          } else {
            const credential = await resolveWorkspaceConnectionCredentialForApp(
              {
                appId: DATA_APP_ID,
                provider: "bigquery",
                connectionId: existing.id,
                key: existing.config.dbtCredentialKey,
              },
            );
            if (credential.status === "error")
              fail(
                "The saved integration credential could not be read. Please try again.",
                {
                  errorCode:
                    "data_connection_integration_credentials_unreadable",
                  statusCode: 503,
                },
              );
            if (credential.available && credential.value)
              token = credential.value;
          }
        }
        if (!token)
          fail("Service token is required.", {
            errorCode: "data_connection_integration_credentials_required",
            statusCode: 422,
          });
        await validateDbtConfiguration(integration, token);
      }
    }
    const hasAccessChange =
      values.queryAccessGroupIds !== undefined ||
      values.shareWithWorkspace !== undefined;
    const sharing =
      values.shareWithWorkspace !== undefined
        ? values.shareWithWorkspace
        : hasAccessChange
          ? values.queryAccessGroupIds?.includes("workspace") === true
          : existing
            ? existing.allowedUsers.length === 0 &&
              !existing.allowedUserGroups?.length &&
              existing.config.workspaceConnectionScope !== "user"
            : !!ctx.orgId;
    const groups =
      values.queryAccessGroupIds?.filter((group) => group !== "workspace") ??
      existing?.allowedUserGroups ??
      [];
    if (hasAccessChange && ctx.orgId)
      await assertWorkspaceUserGroupIds(groups, ctx.orgId);
    if (values.viewAccessGroupIds !== undefined && ctx.orgId)
      await assertWorkspaceUserGroupIds(
        values.viewAccessGroupIds.filter((group) => group !== "workspace"),
        ctx.orgId,
      );

    // Provider validation and credential staging happen outside the short DB
    // transaction. Only keys this attempt created are tracked for cleanup.
    const credentialKey = `DATA_CONNECTION_${attemptId.split("-").join("_").toUpperCase()}_SERVICE_ACCOUNT`;
    if (raw) {
      stagedKeys.push(credentialKey);
      await persistStage();
      await saveCredential(credentialKey, raw, credentialScope);
    }
    const dbtKey =
      values.dbtToken && values.hasDbtMetadata !== false
        ? `${credentialKey}_DBT`
        : undefined;
    if (dbtKey) {
      stagedKeys.push(dbtKey);
      await persistStage();
      await saveCredential(dbtKey, values.dbtToken!, credentialScope);
    }

    await persistStage();

    const publicFields = [
      "additionalProjectIds",
      "datasetNames",
      "queryAccessGroupIds",
      "viewAccessGroupIds",
      "driveAccess",
      "useBQStorageAPI",
      "customCodeFormatting",
      "hasDbtMetadata",
      "disableTablePreviews",
      "canQueryCanRefreshSchema",
      "dbtVersion",
      "dbtAccountId",
      "dbtProjectId",
      "dbtEnvironmentId",
      "dbtCloudHostname",
      "sqlFluffConfig",
    ] as const;

    const submittedDescription = values.description;
    const submittedAiUsage =
      values.includeForAI === undefined
        ? undefined
        : values.includeForAI
          ? ("included" as const)
          : ("excluded" as const);
    const descriptionDirty =
      submittedDescription !== undefined &&
      (!input.baseline || submittedDescription !== input.baseline.description);
    const aiUsageDirty =
      submittedAiUsage !== undefined &&
      (!input.baseline || submittedAiUsage !== input.baseline.aiUsage);
    const canonicalDirty = descriptionDirty || aiUsageDirty;

    // One transaction holds the connection guard and commits the row, grant,
    // canonical fields and this exact operation journal together. A failure in
    // any of them rolls all of them back and never marks the operation complete.
    const commit = async (tx?: DbExec) => {
      if (!scope) {
        const deletion = await getUserSettingEntry(
          ctx.userEmail,
          `analytics.data.delete:personal:${id}`,
          { bypassCache: true, ...(tx ? { transaction: tx } : {}) },
        );
        if (deletion.found) {
          const parsed = deletionIntentSchema.safeParse(deletion.value);
          if (
            !parsed.success ||
            parsed.data.connectionId !== id ||
            parsed.data.scope !== "personal"
          )
            fail("The connection cleanup record could not be read.", {
              statusCode: 500,
              errorCode: "data_connection_deletion_corrupt",
            });
          fail(
            parsed.data.status === "deleted"
              ? "This data connection was deleted."
              : "This data connection is being deleted.",
            {
              statusCode: 409,
              errorCode:
                parsed.data.status === "deleted"
                  ? "data_connection_deleted"
                  : "data_connection_deleting",
            },
          );
        }
      }
      const fresh = await getWorkspaceConnection(id);
      if (input.id && !fresh)
        fail("Data connection not found.", {
          errorCode: "data_connection_not_found",
          statusCode: 404,
        });
      if (fresh && fresh.provider !== "bigquery")
        fail("This connection cannot be updated.", {
          errorCode: "data_connection_conflict",
          statusCode: 409,
        });
      if (connectionSaveRevision(fresh) !== validatedRevision)
        fail(
          "This connection changed while its credentials were being validated. Reopen it and try again.",
          { errorCode: "data_connection_validation_stale", statusCode: 409 },
        );
      const base = fresh ?? existing;
      const freshOldKey = base ? serviceAccountKey(base) : undefined;
      const config: Record<string, unknown> = {
        ...(base?.config ?? {}),
        projectId,
        draft: input.draft,
        lastSaveRequestId: input.requestId,
      };
      for (const field of publicFields)
        if (values[field] !== undefined) config[field] = values[field];
      // Personal presentation uses its own connection config, without an org store.
      if (!scope) {
        if (values.description !== undefined)
          config.description = values.description;
        if (values.includeForAI !== undefined)
          config.includeForAI = values.includeForAI;
      }
      if (
        values.shareWithWorkspace !== undefined ||
        (!base && values.queryAccessGroupIds === undefined)
      )
        config.queryAccessGroupIds = sharing ? ["workspace"] : [];
      const refs = [...(base?.credentialRefs ?? [])];
      const obsoleteKeys: string[] = [];
      if (raw) {
        config.serviceAccountCredentialKey = credentialKey;
        const index = refs.findIndex((ref) => ref.key === freshOldKey);
        if (index >= 0) refs.splice(index, 1);
        if (freshOldKey) obsoleteKeys.push(freshOldKey);
        refs.push({
          key: credentialKey,
          provider: "bigquery",
          scope: ctx.orgId ? "org" : "user",
        });
      }
      if (dbtKey || values.hasDbtMetadata === false) {
        const previousDbtKey = base?.config.dbtCredentialKey;
        const index = refs.findIndex((ref) => ref.key === previousDbtKey);
        if (index >= 0) refs.splice(index, 1);
        if (typeof previousDbtKey === "string")
          obsoleteKeys.push(previousDbtKey);
        if (dbtKey)
          refs.push({
            key: dbtKey,
            provider: "bigquery",
            scope: ctx.orgId ? "org" : "user",
          });
        if (dbtKey) config.dbtCredentialKey = dbtKey;
        else delete config.dbtCredentialKey;
      }

      if (scope) {
        await assertConnectionWritable(
          scope,
          id,
          tx ? { transaction: tx } : {},
        );
        const currentOverride = await readConnectionAnnotationOverride(
          scope,
          id,
          tx ? { transaction: tx, bypassCache: true } : { bypassCache: true },
        );
        if (
          input.id &&
          !input.baseline &&
          ((descriptionDirty &&
            currentOverride?.descriptionInitialized === true) ||
            (aiUsageDirty && currentOverride?.aiUsageInitialized === true))
        )
          fail("Reopen the connection form before editing these fields.", {
            statusCode: 409,
            errorCode: "data_connection_baseline_required",
          });
        if (input.baseline) {
          const current = resolveConnectionPresentation(
            base?.config ?? {},
            currentOverride,
          );
          if (
            canonicalDirty &&
            current.annotationRevision !== input.baseline.annotationRevision
          ) {
            fail(
              "This connection changed since the form was opened. Reopen it and retry.",
              {
                statusCode: 409,
                errorCode: "data_connection_canonical_conflict",
              },
            );
          }
        }
      }

      await upsertWorkspaceConnection({
        id,
        provider: "bigquery",
        label: name,
        accountId: projectId || null,
        status: input.draft ? "disabled" : "connected",
        allowedApps: base
          ? base.allowedApps.length
            ? [...new Set([...base.allowedApps, DATA_APP_ID])]
            : []
          : [DATA_APP_ID],
        allowedUsers: hasAccessChange
          ? sharing
            ? []
            : [...new Set([...(base?.allowedUsers ?? []), ctx.userEmail])]
          : (base?.allowedUsers ?? (sharing ? [] : [ctx.userEmail])),
        allowedUserGroups: hasAccessChange
          ? sharing
            ? []
            : groups
          : (base?.allowedUserGroups ?? []),
        config,
        credentialRefs: refs,
      });
      await upsertWorkspaceConnectionGrant({
        connectionId: id,
        appId: DATA_APP_ID,
        provider: "bigquery",
      });
      if (scope && canonicalDirty) {
        if (!tx) throw new Error("The connection transaction is unavailable.");
        await writeDataResourceMetadata(
          scope,
          id,
          { kind: "connection", id },
          {
            ...(descriptionDirty ? { description: submittedDescription } : {}),
            ...(aiUsageDirty ? { aiUsage: submittedAiUsage } : {}),
          },
          metadataOptions(tx),
        );
      }
      // Only the committed journal entry may say complete. rowCommitted is
      // never used as a success signal.
      await mutateUserSetting(
        ctx.userEmail,
        operation,
        (current) => {
          if (current?.attemptId !== attemptId || current.status !== "pending")
            fail("This save attempt was superseded. Retry this same request.", {
              statusCode: 409,
              errorCode: "data_connection_save_superseded",
            });
          return {
            ...current,
            status: "complete",
            cleanupKeys: obsoleteKeys,
            stagedKeys: [],
          };
        },
        tx ? { transaction: tx } : undefined,
      );
      if (tx) noteUserDataChange(ctx.userEmail, operation);
    };

    if (scope) await withConnectionGuard(scope, id, (tx) => commit(tx));
    else
      await withPersonalConnectionGuard(ctx.userEmail, id, (tx) => commit(tx));
    committed = true;
  } catch (error) {
    if (!committed) {
      const cleanupKeys: string[] = [];
      const keys = new Set([...pendingCleanupKeys, ...stagedKeys]);
      let retained: Set<string> | undefined;
      if (keys.size) {
        try {
          retained = new Set(
            (await listWorkspaceConnections({ includeDisabled: true })).flatMap(
              connectionCredentialKeys,
            ),
          );
        } catch {
          retained = undefined;
        }
      }
      for (const key of keys) {
        if (retained === undefined) {
          cleanupKeys.push(key);
          continue;
        }
        if (retained.has(key)) continue;
        try {
          await deleteCredential(key, credentialScope);
        } catch {
          cleanupKeys.push(key);
        }
      }
      try {
        await mutateUserSetting(ctx.userEmail, operation, (current) => {
          if (
            current?.status === "complete" ||
            current?.attemptId !== attemptId
          )
            return current ?? reservation;
          return { ...current, status: "failed", cleanupKeys, stagedKeys: [] };
        });
      } catch {
        fail(
          "The connection save failed and its recovery state could not be saved. Retry this same request after service recovery.",
          {
            errorCode: "data_connection_save_recovery_unavailable",
            statusCode: 503,
          },
        );
      }
    }
    throw error;
  }
  // Recovery after a committed response is lost: the same request id reads the
  // completed journal instead of re-running the attempt or creating a new row.
  await finishCommittedCredentialCleanup(input.requestId);
  return getDataConnectionSaveResult(input.requestId);
}

export async function getDataConnectionForm(id: string, requestId?: string) {
  const ctx = await manager();
  const checked = await checkedConnectionProfile(await readDataConnection(id));
  if (!checked.editable)
    fail("Data connection not found.", {
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
  const connection = checked.connection;
  if (
    requestId &&
    (!checked.nativeAllMembers ||
      !ctx.orgId ||
      connection.config.warehouseEditOperation !==
        warehouseEditOperation(
          { orgId: ctx.orgId, ownerEmail: ctx.userEmail },
          requestId,
        ))
  ) {
    fail("The connection update could not be confirmed.", {
      errorCode: "data_connection_edit_unconfirmed",
      statusCode: 409,
    });
  }
  const presentation = await connectionPresentation(connection);
  const values: ConnectionValues = {
    name: connection.label,
    description: presentation.description,
    queryAccessGroupIds:
      connection.allowedUsers.length === 0 &&
      !connection.allowedUserGroups?.length
        ? ["workspace"]
        : (connection.allowedUserGroups ?? []),
  };
  for (const field of [
    "host",
    "port",
    "database",
    "username",
    "projectId",
    "additionalProjectIds",
    "datasetNames",
    "viewAccessGroupIds",
    "driveAccess",
    "useBQStorageAPI",
    "customCodeFormatting",
    "hasDbtMetadata",
    "disableTablePreviews",
    "canQueryCanRefreshSchema",
    "dbtVersion",
    "dbtAccountId",
    "dbtProjectId",
    "dbtEnvironmentId",
    "dbtCloudHostname",
    "sqlFluffConfig",
  ]) {
    const value = connection.config[field];
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      (field === "port" && typeof value === "number") ||
      (Array.isArray(value) && value.every((item) => typeof item === "string"))
    )
      values[field] =
        field === "datasetNames" && value === ALL_BIGQUERY_DATASETS
          ? ""
          : value;
  }
  values.includeForAI = presentation.effectiveAiUsage === "included";
  if (checked.nativeAllMembers) {
    values.queryAccessGroupIds = ["workspace"];
    values.viewAccessGroupIds = ["workspace"];
  }
  return {
    connection: toDto(
      connection,
      await defaultDataConnectionId(),
      presentation,
      checked.nativeAllMembers,
    ),
    values,
    baseline: {
      description: presentation.description,
      aiUsage: presentation.effectiveAiUsage,
      annotationRevision: presentation.annotationRevision,
    },
    ...(checked.nativeAllMembers
      ? { nativeRevision: checked.nativeRevision }
      : {}),
    configuredCredentialFields: [
      ...(connection.provider === "postgres" &&
      connection.credentialRefs.some(({ key }) => key === POSTGRES_PASSWORD)
        ? ["password"]
        : []),
      ...(connection.provider === "postgres" &&
      connection.credentialRefs.some(
        ({ key }) => key === POSTGRES_CA_CERTIFICATE,
      )
        ? ["caCertificate"]
        : []),
      ...(serviceAccountKey(connection) ? ["serviceAccount"] : []),
      ...(typeof connection.config.dbtCredentialKey === "string"
        ? ["dbtToken"]
        : []),
    ],
  };
}
export async function setDefaultDataConnection(id: string | null) {
  const ctx = await manager();
  if (id === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    if (!ctx.orgId)
      fail("The organization BigQuery source belongs to a workspace.", {
        errorCode: "data_connection_default_workspace_required",
        statusCode: 409,
      });
    const readiness = await getOrganizationBigQueryCredentialReadiness({
      orgId: ctx.orgId,
      userEmail: ctx.userEmail,
    });
    if (readiness !== "configured")
      fail("The organization BigQuery connection is not configured.", {
        errorCode: "data_connection_default_not_connected",
        statusCode: 409,
      });
  } else if (id !== null) {
    const connection = await readDataConnection(id);
    const dto = toDto(
      connection,
      null,
      await connectionPresentation(connection),
    );
    if (!dto.shared || dto.isDraft || connection.status !== "connected")
      fail(
        "Only data connections shared with workspace can be set as default",
        { errorCode: "data_connection_default_not_shared", statusCode: 409 },
      );
  }
  if (ctx.orgId) await putOrgSetting(ctx.orgId, defaultKey, { id });
  else await putUserSetting(ctx.userEmail, defaultKey, { id });
  const saved = await defaultDataConnectionId();
  if (saved !== id)
    fail("Failed to set default data connection", {
      errorCode: "data_connection_default_unverified",
      statusCode: 503,
    });
  return { id: saved };
}

export const deleteConnectionSchema = z
  .object({ id: z.string().min(1).max(200) })
  .strict();
export const deleteConnectionOutput = z.object({
  id: z.string(),
  deleted: z.boolean(),
});
/** Persist exact cleanup intent, remove the connection, then resume remaining cleanup. */
const deletionIntentSchema = z
  .object({
    version: z.literal(1),
    connectionId: z.string(),
    scope: z.string(),
    status: z.enum(["deleting", "deleted"]),
    credentialKeys: z.array(z.string()),
  })
  .strict();

function connectionCredentialKeys(connection: {
  credentialRefs: readonly { key: string }[];
  config: Record<string, unknown>;
}): string[] {
  return [
    ...new Set([
      ...connection.credentialRefs.map((ref) => ref.key),
      ...[
        connection.config.dbtCredentialKey,
        connection.config.serviceAccountCredentialKey,
      ].filter((key): key is string => typeof key === "string"),
    ]),
  ];
}

export async function deleteDataConnection(
  input: z.infer<typeof deleteConnectionSchema>,
) {
  const ctx = await manager();
  // Native credentials use an isolated encrypted vault, not the legacy
  // credential store. Never run their references through legacy deletion.
  const rawConnection = await getWorkspaceConnection(input.id);
  const nativeCandidate =
    rawConnection &&
    (rawConnection.config.workspaceCredentialProfile !== undefined ||
      rawConnection.credentialRefs.some(
        (ref) => ref.ref === "workspace-connection",
      ));
  if (nativeCandidate) {
    const postgres = rawConnection.provider === "postgres";
    const profile = await readWorkspaceCredentialProfile({
      appId: DATA_APP_ID,
      provider: postgres ? "postgres" : "bigquery",
      connectionId: input.id,
      requestContext: getRequestContext(),
    });
    if (!profile || !ctx.orgId)
      fail("The selected data connection cannot be removed.", {
        errorCode: "data_connection_unavailable",
        statusCode: 403,
      });
    const scope = { ownerEmail: ctx.userEmail, orgId: ctx.orgId };
    const verifyManager = async () => {
      const fresh = await manager();
      const after = connectionContext();
      if (
        [fresh, after].some(
          (candidate) =>
            candidate.userEmail !== ctx.userEmail ||
            candidate.orgId !== ctx.orgId ||
            candidate.authUserId !== ctx.authUserId,
        )
      )
        fail("The selected data connection cannot be removed.", {
          errorCode: "data_connection_unavailable",
          statusCode: 403,
        });
    };
    await verifyManager();
    const actions = postgres
      ? postgresWarehouseActions
      : workspaceWarehouseActions;
    const archived = await actions.archiveConnection.run(
      { connectionId: input.id },
      { caller: "frontend" },
    );
    if (!archived.archived)
      fail("The data connection could not be removed.", {
        errorCode: "data_connection_delete_incomplete",
        statusCode: 409,
      });
    // Join the same app lifecycle as legacy removal, so late annotation and
    // catalog writers see the terminal deletion intent after archival.
    // The tombstone and cleanup can be resumed by this durable ID on error.
    await withDbTransaction(async (tx) => {
      await verifyManager();
      await beginConnectionDeletionPhases(scope, input.id, tx);
      await verifyManager();
    });
    // Recheck authorization on every settings CAS attempt. The archive may
    // have committed before a membership or request identity change.
    await mutateOrgSetting(ctx.orgId, defaultKey, async (current) => {
      await verifyManager();
      return current?.id === input.id
        ? { ...current, id: null }
        : (current ?? { id: null });
    });
    await withDbTransaction(async (tx) => {
      await verifyManager();
      await finishConnectionDeletionPhases(scope, input.id, tx);
      await verifyManager();
    });
    return { id: input.id, deleted: true };
  }
  const scope = ctx.orgId
    ? { ownerEmail: ctx.userEmail, orgId: ctx.orgId }
    : null;
  const scopeId = ctx.orgId ?? "personal";
  const journal = `analytics.data.delete:${scopeId}:${input.id}`;
  let connection: WorkspaceConnectionForApp | null = null;
  let intent: z.infer<typeof deletionIntentSchema>;
  try {
    connection = await readDataConnection(input.id);
  } catch (error) {
    // A persisted cleanup intent can resume only a row that is actually gone;
    // a still-existing row denied by the current grant is never a retry bypass.
    if (await getWorkspaceConnection(input.id)) throw error;
    const saved = await getUserSetting(ctx.userEmail, journal, {
      bypassCache: true,
    });
    if (saved === null) throw error;
    const parsed = deletionIntentSchema.safeParse(saved);
    if (
      !parsed.success ||
      parsed.data.connectionId !== input.id ||
      parsed.data.scope !== scopeId
    )
      fail("The connection cleanup record could not be read.", {
        statusCode: 500,
        errorCode: "data_connection_deletion_corrupt",
      });
    intent = parsed.data;
  }
  if (connection) {
    const prepare = async (tx: DbExec) => {
      const fresh = await getWorkspaceConnection(input.id);
      if (!fresh)
        fail("Data connection not found.", {
          statusCode: 404,
          errorCode: "data_connection_not_found",
        });
      const next = {
        version: 1 as const,
        connectionId: input.id,
        scope: scopeId,
        status: "deleting" as const,
        credentialKeys: connectionCredentialKeys(fresh),
      };
      await mutateUserSetting(ctx.userEmail, journal, () => next, {
        transaction: tx,
      });
      noteUserDataChange(ctx.userEmail, journal);
      if (scope) await beginConnectionDeletionPhases(scope, input.id, tx);
      return next;
    };
    intent = scope
      ? await withConnectionGuard(scope, input.id, prepare)
      : await withPersonalConnectionGuard(ctx.userEmail, input.id, prepare);
    const deleted = await deleteWorkspaceConnection(input.id);
    if (!deleted && (await getWorkspaceConnection(input.id)))
      fail("The data connection could not be removed.", {
        statusCode: 409,
        errorCode: "data_connection_delete_incomplete",
      });
  }
  // Every key is captured before removing the row. Keep references still used
  // by a sibling connection, including another app or a disabled connection.
  try {
    const siblings = await listWorkspaceConnections({ includeDisabled: true });
    const retained = new Set(siblings.flatMap(connectionCredentialKeys));
    for (const key of intent!.credentialKeys) {
      if (!retained.has(key))
        await deleteCredential(key, {
          userEmail: ctx.userEmail,
          ...(ctx.orgId
            ? { orgId: ctx.orgId, scope: "org" as const }
            : { scope: "user" as const }),
        });
    }
  } catch {
    fail(
      "The data connection was deleted but its stored credential could not be removed. Retry the deletion.",
      {
        errorCode: "data_connection_credential_cleanup_failed",
        statusCode: 500,
      },
    );
  }
  // An intervening selection of a different default must survive cleanup.
  const clearDefault = (current: Record<string, unknown> | null) =>
    current?.id === input.id
      ? { ...current, id: null }
      : (current ?? { id: null });
  if (ctx.orgId) await mutateOrgSetting(ctx.orgId, defaultKey, clearDefault);
  else await mutateUserSetting(ctx.userEmail, defaultKey, clearDefault);
  if (scope) await finishConnectionDeletionPhases(scope, input.id);
  await mutateUserSetting(ctx.userEmail, journal, (current) => ({
    ...current,
    ...intent!,
    status: "deleted",
  }));
  return { id: input.id, deleted: true };
}

const cursorSchema = z
  .object({
    connectionId: z.string(),
    parentId: z.string().nullable(),
    search: z.string(),
    projectIndex: z.number().int().nonnegative(),
    policyRevision: z.number().int().nonnegative().default(0),
    pageToken: z.string().optional(),
  })
  .strict();

type DatasetPageItem = z.infer<typeof datasetPageOutput>["items"][number];

const DATASET_PAGE_SCAN_LIMIT = 4;

async function scanDatasetPages<Cursor>(options: {
  start: Cursor;
  first: number;
  needle: string;
  readPage: (
    cursor: Cursor,
    first: number,
  ) => Promise<{ items: DatasetPageItem[]; next: Cursor | null }>;
}) {
  const items: DatasetPageItem[] = [];
  let cursor: Cursor | null = options.start;
  for (
    let reads = 0;
    cursor !== null && reads < DATASET_PAGE_SCAN_LIMIT;
    reads++
  ) {
    const page = await options.readPage(cursor, options.first - items.length);
    items.push(
      ...page.items.filter(
        (item) =>
          !options.needle || item.name.toLowerCase().includes(options.needle),
      ),
    );
    cursor = page.next;
    if (items.length > 0 && (!options.needle || items.length >= options.first))
      break;
  }
  return { items, next: cursor };
}

async function listOrganizationConnectionDatasets(
  input: z.infer<typeof datasetQuerySchema>,
  ctx: ReturnType<typeof connectionContext>,
) {
  if (!ctx.orgId)
    fail("The organization BigQuery source belongs to a workspace.", {
      errorCode: "data_connection_workspace_required",
      statusCode: 403,
    });
  const projectId = await requireOrganizationBigQueryProjectId({
    orgId: ctx.orgId,
    userEmail: ctx.userEmail,
  });
  let parent: { project: string; dataset: string } | undefined;
  if (input.parentId) {
    const parts = input.parentId.split(":");
    if (parts.length !== 3 || parts[0] !== "schema")
      fail("The selected dataset is invalid.", {
        errorCode: "data_connection_dataset_invalid",
        statusCode: 422,
      });
    try {
      parent = {
        project: decodeURIComponent(parts[1] ?? ""),
        dataset: decodeURIComponent(parts[2] ?? ""),
      };
    } catch {
      fail("The selected dataset is invalid.", {
        errorCode: "data_connection_dataset_invalid",
        statusCode: 422,
      });
    }
    if (parent.project !== projectId)
      fail("The selected dataset is not in this connection.", {
        errorCode: "data_connection_dataset_denied",
        statusCode: 403,
      });
  }
  let pageToken: string | undefined;
  if (input.after) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        Buffer.from(input.after, "base64url").toString("utf8"),
      );
    } catch {
      fail("The dataset cursor is invalid.", {
        errorCode: "data_connection_cursor_invalid",
        statusCode: 422,
      });
    }
    const parsed = cursorSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.connectionId !== ORGANIZATION_BIGQUERY_SOURCE_ID ||
      parsed.data.parentId !== (input.parentId ?? null) ||
      parsed.data.search !== (input.search ?? "")
    )
      fail("The dataset cursor is invalid.", {
        errorCode: "data_connection_cursor_invalid",
        statusCode: 422,
      });
    pageToken = parsed.data.pageToken;
  }
  const search = input.search ?? "";
  const scanned = await withOrganizationBigQueryRequestContext(
    { orgId: ctx.orgId, userEmail: ctx.userEmail },
    () =>
      scanDatasetPages({
        start: { pageToken },
        first: input.first,
        needle: search.toLowerCase(),
        readPage: async (at, first) => {
          const page = await requestMetadata(
            getAnalytics2ProviderApiRuntime(),
            projectId,
            { datasetId: parent?.dataset, after: at.pageToken, first },
          );
          return {
            items: page.items,
            next: page.nextPageToken ? { pageToken: page.nextPageToken } : null,
          };
        },
      }),
  );
  const cursor = {
    connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
    parentId: input.parentId ?? null,
    search,
    projectIndex: 0,
    policyRevision: 0,
    pageToken: scanned.next?.pageToken,
  };
  return {
    items: scanned.items,
    endCursor: scanned.next
      ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
      : null,
    hasNextPage: scanned.next !== null,
  };
}

export function configuredDatasetNames(config: {
  datasetNames?: unknown;
}): string[] {
  if (
    typeof config.datasetNames !== "string" ||
    config.datasetNames === ALL_BIGQUERY_DATASETS
  )
    return [];
  const seen = new Set<string>();
  for (const raw of config.datasetNames.split(",")) {
    const name = raw.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

export function configuredDatasetPage(
  project: string,
  names: readonly string[],
): Awaited<ReturnType<typeof requestMetadata>> {
  return {
    items: names.map((name) => ({
      id: `schema:${encodeURIComponent(project)}:${encodeURIComponent(name)}`,
      name,
      kind: "schema" as const,
      hasChildren: true,
    })),
    nextPageToken: undefined,
  };
}

async function listConfiguredDatasetPage(
  runtime: Awaited<ReturnType<typeof runtimeForConnection>>,
  projectId: string,
  names: readonly string[],
  after: string | undefined,
  first: number,
): Promise<Awaited<ReturnType<typeof requestMetadata>>> {
  const offset = after === undefined ? 0 : Number(after);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= names.length)
    fail("The dataset cursor is invalid.", {
      errorCode: "data_connection_cursor_invalid",
      statusCode: 422,
    });
  if (names.some((name) => !/^[A-Za-z0-9_]{1,1024}$/.test(name)))
    fail(
      "Datasets must contain comma-separated BigQuery dataset IDs using letters, numbers, or underscores.",
      {
        errorCode: "data_connection_dataset_unreadable",
        statusCode: 422,
      },
    );
  const page = names.slice(offset, offset + Math.min(first, 10));
  const refusals = await Promise.all(
    page.map(async (datasetId) => {
      try {
        await requestMetadata(runtime, projectId, { datasetId, first: 1 });
        return null;
      } catch (error) {
        const refusal = bigQueryMetadataRejection(error);
        if (!refusal || ![403, 404].includes(refusal.providerStatus))
          throw error;
        const { providerStatus, providerReason } = refusal;
        return `${datasetId} (HTTP ${providerStatus}${providerReason ? `, ${providerReason}` : ""})`;
      }
    }),
  );
  const unreadable = refusals.filter((reason) => reason !== null);
  if (unreadable.length)
    fail(
      `Datasets: BigQuery could not list tables in ${unreadable.join(", ")}. Check the dataset IDs and service account access.`,
      {
        errorCode: "data_connection_dataset_unreadable",
        statusCode: 422,
      },
    );
  const nextOffset = offset + page.length;
  return {
    items: page.map((name) => ({
      id: `schema:${encodeURIComponent(projectId)}:${encodeURIComponent(name)}`,
      name,
      kind: "schema" as const,
      hasChildren: true,
    })),
    nextPageToken: nextOffset < names.length ? String(nextOffset) : undefined,
  };
}

export async function listConnectionDatasets(
  input: z.infer<typeof datasetQuerySchema>,
  options: { forAgent?: boolean } = {},
) {
  const ctx = connectionContext();
  if (input.connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID)
    return listOrganizationConnectionDatasets(input, ctx);
  if (isBuiltinSampleConnection(input.connectionId))
    return sampleDatasetPage(input);
  const connection = await readDataConnection(input.connectionId);
  if (options.forAgent && !(await connectionIncludedForAgent(connection)))
    fail(
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
      {
        errorCode: "data_connection_ai_disabled",
        statusCode: 403,
      },
    );
  if (connection.status !== "connected" || connection.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  if (connection.provider === "postgres") {
    const { listPostgresCatalogPage } = await import("./postgres-catalog.js");
    return listPostgresCatalogPage(
      input,
      await requireCurrentWorkspace(),
      options.forAgent === true,
    );
  }
  const project = connection.config.projectId ?? connection.accountId;
  if (typeof project !== "string" || !project)
    fail("Project ID is required.", {
      errorCode: "data_connection_project_required",
      statusCode: 422,
    });
  const extra =
    typeof connection.config.additionalProjectIds === "string"
      ? connection.config.additionalProjectIds
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  const projects = [...new Set([project, ...extra])];
  const configuredDatasets = configuredDatasetNames(connection.config);
  let parent: { project: string; dataset: string } | undefined;
  if (input.parentId) {
    const parts = input.parentId.split(":");
    if (parts.length !== 3 || parts[0] !== "schema")
      fail("The selected dataset is invalid.", {
        errorCode: "data_connection_dataset_invalid",
        statusCode: 422,
      });
    try {
      parent = {
        project: decodeURIComponent(parts[1] ?? ""),
        dataset: decodeURIComponent(parts[2] ?? ""),
      };
    } catch {
      fail("The selected dataset is invalid.", {
        errorCode: "data_connection_dataset_invalid",
        statusCode: 422,
      });
    }
    if (!projects.includes(parent.project))
      fail("The selected dataset is not in this connection.", {
        errorCode: "data_connection_dataset_denied",
        statusCode: 403,
      });
    if (
      parent.project === project &&
      configuredDatasets.length > 0 &&
      !configuredDatasets.includes(parent.dataset)
    )
      fail("The selected dataset is not in this connection.", {
        errorCode: "data_connection_dataset_denied",
        statusCode: 403,
      });
  }
  const policyScope =
    options.forAgent && ctx.orgId
      ? { ownerEmail: ctx.userEmail, orgId: ctx.orgId }
      : null;
  const policyRevision = policyScope
    ? await readResourcePolicyRevision(policyScope, connection.id, {
        bypassCache: true,
      })
    : 0;
  if (policyScope && input.parentId) {
    const parentPolicy = await resourcePolicies(
      policyScope,
      connection.id,
      [{ kind: "schema", id: input.parentId }],
      "included",
      { bypassCache: true },
    );
    if (parentPolicy.get(`schema:${input.parentId}`) !== "included")
      fail(
        "This data resource is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          statusCode: 403,
          errorCode: "data_resource_ai_disabled",
        },
      );
  }
  let cursor: z.infer<typeof cursorSchema> = {
    connectionId: connection.id,
    parentId: input.parentId ?? null,
    search: input.search ?? "",
    projectIndex: 0,
    policyRevision,
  };
  if (input.after) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        Buffer.from(input.after, "base64url").toString("utf8"),
      );
    } catch {
      fail("The dataset cursor is invalid.", {
        errorCode: "data_connection_cursor_invalid",
        statusCode: 422,
      });
    }
    const parsed = cursorSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.connectionId !== connection.id ||
      parsed.data.parentId !== (input.parentId ?? null) ||
      parsed.data.search !== (input.search ?? "") ||
      parsed.data.projectIndex >= projects.length ||
      parsed.data.policyRevision !== policyRevision
    )
      fail("The dataset cursor is invalid.", {
        errorCode: "data_connection_cursor_invalid",
        statusCode: 422,
      });
    cursor = parsed.data;
  }
  const credentialKey = serviceAccountKey(connection);
  if (!credentialKey)
    fail("This data connection has no credentials.", {
      errorCode: "data_connection_credentials_missing",
      statusCode: 409,
    });
  const runtime = await runtimeForConnection(connection.id, credentialKey, {
    driveAccess: connection.config.driveAccess === true,
  });
  const scanned = await scanDatasetPages({
    start: cursor,
    first: input.first,
    needle: (input.search ?? "").toLowerCase(),
    readPage: async (at, first) => {
      const projectId = parent?.project ?? projects[at.projectIndex];
      if (!projectId)
        fail("The dataset cursor is invalid.", {
          errorCode: "data_connection_cursor_invalid",
          statusCode: 422,
        });
      const names = !parent && at.projectIndex === 0 ? configuredDatasets : [];
      const page = names.length
        ? await listConfiguredDatasetPage(
            runtime,
            projectId,
            names,
            at.pageToken,
            first,
          )
        : await requestMetadata(runtime, projectId, {
            datasetId: parent?.dataset,
            after: at.pageToken,
            first,
          });
      const next = page.nextPageToken
        ? { ...at, pageToken: page.nextPageToken }
        : !parent && at.projectIndex + 1 < projects.length
          ? {
              ...at,
              projectIndex: at.projectIndex + 1,
              pageToken: undefined,
            }
          : null;
      let items: Array<(typeof page.items)[number]> = page.items;
      if (policyScope) {
        const policies = await resourcePolicies(
          policyScope,
          connection.id,
          items,
          "included",
          { bypassCache: true },
        );
        items = items.filter(
          (item) => policies.get(`${item.kind}:${item.id}`) === "included",
        );
        if (
          (await readResourcePolicyRevision(policyScope, connection.id, {
            bypassCache: true,
          })) !== policyRevision
        )
          fail("The dataset policy changed. Restart from the first page.", {
            statusCode: 409,
            errorCode: "data_connection_cursor_stale",
          });
      }
      return { items, next };
    },
  });
  if (options.forAgent) {
    const latest = await readDataConnection(connection.id);
    if (!(await connectionIncludedForAgent(latest, { bypassCache: true })))
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          statusCode: 403,
          errorCode: "data_connection_ai_disabled",
        },
      );
    if (
      policyScope &&
      (await readResourcePolicyRevision(policyScope, connection.id, {
        bypassCache: true,
      })) !== policyRevision
    )
      fail("The dataset policy changed. Restart from the first page.", {
        statusCode: 409,
        errorCode: "data_connection_cursor_stale",
      });
  }
  return {
    items: scanned.items,
    endCursor: scanned.next
      ? Buffer.from(JSON.stringify(scanned.next)).toString("base64url")
      : null,
    hasNextPage: scanned.next !== null,
  };
}

async function assertAgentResourcePolicy(
  connectionId: string,
  userEmail: string,
  orgId: string,
) {
  const annotations = await readDataResourceMetadata(
    { ownerEmail: userEmail, orgId },
    connectionId,
  );
  if (
    annotations.resources.some(
      (resource) =>
        resource.kind !== "connection" && resource.aiUsage === "excluded",
    )
  )
    fail(
      "Agent SQL queries are unavailable while this connection contains excluded data resources.",
      {
        statusCode: 403,
        errorCode: "warehouse_query_resource_policy_unavailable",
      },
    );
}

async function assertConnectionQueryPolicy(
  connection: Pick<WorkspaceConnectionForApp, "id" | "status" | "config">,
  caller: string | undefined,
  userEmail: string,
  orgId: string | null | undefined,
) {
  if (connection.status !== "connected" || connection.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  if (caller !== "frontend") {
    const override = orgId
      ? await readConnectionAnnotationOverride(
          { ownerEmail: userEmail, orgId },
          connection.id,
          { bypassCache: true },
        )
      : null;
    if (
      !isAgentIncluded(
        resolveConnectionPresentation(connection.config, override),
      )
    )
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          errorCode: "data_connection_ai_disabled",
          statusCode: 403,
        },
      );
    if (orgId) await assertAgentResourcePolicy(connection.id, userEmail, orgId);
  }
}

export async function assertConnectionResultsAccess(
  id: string,
  caller: string,
) {
  if (!(await canReadConnectionResults(id)))
    fail("The data connection results are no longer accessible.", {
      errorCode: "data_connection_result_access_denied",
      statusCode: 403,
    });
  if (caller === "frontend" || isBuiltinSampleConnection(id)) return;
  const ctx = connectionContext();
  if (id === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    const workspace = await requireCurrentWorkspace();
    const override = await readConnectionAnnotationOverride(
      { ownerEmail: ctx.userEmail, orgId: workspace.orgId },
      id,
      { bypassCache: true },
    );
    if (
      !isAgentIncluded(
        resolveConnectionPresentation({ includeForAI: true }, override),
      )
    )
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          errorCode: "data_connection_ai_disabled",
          statusCode: 403,
        },
      );
    await assertAgentResourcePolicy(id, ctx.userEmail, workspace.orgId);
    return;
  }
  const stored = await getWorkspaceConnection(id);
  if (!stored)
    fail("The data connection results are no longer accessible.", {
      errorCode: "data_connection_result_access_denied",
      statusCode: 403,
    });
  const connection =
    stored.provider === "postgres"
      ? (await readPostgresConnectionProfile(id)).connection
      : stored;
  let policyOrgId = ctx.orgId;
  if (!policyOrgId && stored.orgId) {
    const workspace = await requireCurrentWorkspace();
    if (workspace.orgId !== stored.orgId)
      fail("The data connection results are no longer accessible.", {
        errorCode: "data_connection_result_access_denied",
        statusCode: 403,
      });
    policyOrgId = workspace.orgId;
  }
  await assertConnectionQueryPolicy(
    connection,
    caller,
    ctx.userEmail,
    policyOrgId,
  );
}

export async function assertDataframeConnectionAccess(
  id: string,
  caller: string,
) {
  await assertConnectionResultsAccess(id, caller);
  if (isBuiltinSampleConnection(id) || id === ORGANIZATION_BIGQUERY_SOURCE_ID)
    return;
  const ctx = connectionContext();
  const connection = await readDataConnection(id);
  await assertConnectionQueryPolicy(
    connection,
    caller,
    ctx.userEmail,
    ctx.orgId ?? connection.orgId,
  );
}

async function executeOrganizationConnectionQuery(
  input: WarehouseQueryInput & { connectionId: string },
) {
  const ctx = connectionContext();
  if (input.parameters?.length)
    fail("Parameterized queries are not available on this connection.", {
      errorCode: "warehouse_query_parameters_unsupported",
      statusCode: 422,
    });
  if (!ctx.orgId)
    fail("The organization BigQuery source belongs to a workspace.", {
      errorCode: "data_connection_workspace_required",
      statusCode: 403,
    });
  const projectId = await requireOrganizationBigQueryProjectId({
    orgId: ctx.orgId,
    userEmail: ctx.userEmail,
  });
  // Loaded here so model-only callers do not pull the organization query
  // action's error catalog and its action-layer imports into module load.
  const { runOrganizationWarehouseQueryInternal } =
    await import("../lib/organization-warehouse-query.js");
  const {
    output: result,
    providerTypes,
    jobIdentity,
  } = !input.job
    ? await runOrganizationWarehouseQueryInternal({
        operation: "start",
        connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        sql: input.query ?? "",
        maxRows: Math.min(Math.max(input.first ?? 1000, 1), 50_000),
      })
    : await runOrganizationWarehouseQueryInternal({
        operation: input.pageToken ? "next-page" : "poll",
        queryId: input.job.jobId,
      });
  const columns = result.columns.map((column, index) => {
    const providerType = providerTypes[index];
    if (!providerType)
      fail("BigQuery omitted the result schema.", {
        errorCode: "warehouse_query_schema_unreadable",
        statusCode: 502,
      });
    return {
      name: column.name,
      type: column.type,
      [dataframeProviderType]: providerType,
    };
  });
  const rows = result.rows.map((row) =>
    columns.map((column) => row[column.name] ?? null),
  );
  const jobComplete = result.jobComplete || result.complete;
  const queryId = result.queryId ?? input.job?.jobId ?? null;
  return {
    jobComplete,
    status: jobComplete ? ("complete" as const) : ("running" as const),
    jobReference: queryId ? { projectId, jobId: queryId } : null,
    jobIdentity,
    columns,
    rows,
    totalRows: result.totalRows,
    totalBytesProcessed: null,
    pageToken: result.nextPageToken ?? null,
    hasNextPage: result.hasMore,
  };
}

export async function cancelConnectionQuery(
  input: {
    connectionId: string;
    job: { projectId: string; jobId: string; location?: string | undefined };
    operation: "request" | "status";
  },
  scope: { userEmail: string; orgId?: string | null; caller?: string },
) {
  const ctx = connectionContext();
  if (
    scope.userEmail.trim().toLowerCase() !== ctx.userEmail ||
    (scope.orgId ?? null) !== (ctx.orgId ?? null)
  )
    fail("The query scope does not match the signed-in account.", {
      errorCode: "warehouse_query_scope_denied",
      statusCode: 403,
    });
  if (input.connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    const { cancelOrganizationWarehouseQuery } =
      await import("../lib/organization-warehouse-query.js");
    return cancelOrganizationWarehouseQuery(input.job.jobId, input.operation);
  }
  const connection = await readDataConnection(input.connectionId);
  if (connection.status !== "connected" || connection.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  if (
    scope.caller !== "frontend" &&
    !(await connectionIncludedForAgent(connection))
  )
    fail(
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
      {
        errorCode: "data_connection_ai_disabled",
        statusCode: 403,
      },
    );
  const projectId = connection.config.projectId ?? connection.accountId;
  const credentialKey = serviceAccountKey(connection);
  if (typeof projectId !== "string" || !projectId || !credentialKey)
    fail("The selected data connection is incomplete.", {
      errorCode: "data_connection_credentials_missing",
      statusCode: 409,
    });
  if (input.job.projectId !== projectId || !input.job.location)
    fail("The query job identity is unavailable.", {
      errorCode: "warehouse_query_job_invalid",
      statusCode: 409,
    });
  const runtime = await runtimeForConnection(connection.id, credentialKey, {
    driveAccess: connection.config.driveAccess === true,
  });
  return cancelWarehouseJob(
    runtime,
    { ...input.job, location: input.job.location },
    input.operation,
  );
}

export async function executeConnectionQuery(
  input: WarehouseQueryInput & { connectionId: string },
  scope: { userEmail: string; orgId?: string | null; caller?: string },
) {
  const ctx = connectionContext();
  if (
    scope.userEmail.trim().toLowerCase() !== ctx.userEmail ||
    (scope.orgId ?? null) !== (ctx.orgId ?? null)
  )
    fail("The query scope does not match the signed-in account.", {
      errorCode: "warehouse_query_scope_denied",
      statusCode: 403,
    });
  if (input.connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID)
    return executeOrganizationConnectionQuery(input);
  const connection = await readDataConnection(input.connectionId);
  const queryPolicyScope =
    scope.caller !== "frontend" && ctx.orgId
      ? { ownerEmail: ctx.userEmail, orgId: ctx.orgId }
      : null;
  const queryPolicyRevision = queryPolicyScope
    ? await readResourcePolicyRevision(queryPolicyScope, connection.id, {
        bypassCache: true,
      })
    : 0;
  if (connection.status !== "connected" || connection.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  if (
    scope.caller !== "frontend" &&
    !(await connectionIncludedForAgent(connection))
  )
    fail(
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
      {
        errorCode: "data_connection_ai_disabled",
        statusCode: 403,
      },
    );
  if (scope.caller !== "frontend" && ctx.orgId) {
    const policyScope = { ownerEmail: ctx.userEmail, orgId: ctx.orgId };
    const annotations = await readDataResourceMetadata(
      policyScope,
      connection.id,
    );
    if (
      annotations.resources.some(
        (resource) =>
          resource.kind !== "connection" && resource.aiUsage === "excluded",
      )
    )
      fail(
        "Agent SQL queries are unavailable while this connection contains excluded data resources.",
        {
          statusCode: 403,
          errorCode: "warehouse_query_resource_policy_unavailable",
        },
      );
  }
  if (!input.job) {
    if (!input.query?.trim())
      fail("The SQL query is empty.", {
        errorCode: "warehouse_query_empty",
        statusCode: 422,
      });
    const { requireOrganizationReadOnlySql } =
      await import("../lib/organization-warehouse-query.js");
    try {
      requireOrganizationReadOnlySql(input.query);
    } catch {
      fail("Only a single read-only SQL query is supported.", {
        errorCode: "warehouse_query_not_readonly",
        statusCode: 422,
      });
    }
  }
  const projectId = connection.config.projectId ?? connection.accountId;
  const credentialKey = serviceAccountKey(connection);
  if (typeof projectId !== "string" || !projectId || !credentialKey)
    fail("The selected data connection is incomplete.", {
      errorCode: "data_connection_credentials_missing",
      statusCode: 409,
    });
  const authentication = {
    driveAccess: connection.config.driveAccess === true,
  };
  const runtime = await runtimeForConnection(
    connection.id,
    credentialKey,
    authentication,
  );
  const result =
    connection.config.useBQStorageAPI === true
      ? await executeStorageQueryPage(runtime, {
          connectionId: connection.id,
          credentialKey,
          projectId,
          input,
          options: authentication,
        })
      : await executeQueryPage(runtime, projectId, input);
  const latest = await readDataConnection(connection.id);
  if (latest.status !== "connected" || latest.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  if (scope.caller !== "frontend") {
    if (!(await connectionIncludedForAgent(latest, { bypassCache: true })))
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          statusCode: 403,
          errorCode: "data_connection_ai_disabled",
        },
      );
    if (
      queryPolicyScope &&
      (await readResourcePolicyRevision(queryPolicyScope, connection.id, {
        bypassCache: true,
      })) !== queryPolicyRevision
    )
      fail("The data resource policy changed while the query was running.", {
        statusCode: 409,
        errorCode: "data_resource_policy_changed",
      });
  }
  return result;
}

export async function resolveNotebookWarehouseConnection(
  id: string,
  caller: string,
) {
  const connection = await readDataConnection(id);
  if (connection.status !== "connected" || connection.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  const ctx = connectionContext();
  const scope = ctx.orgId
    ? { ownerEmail: ctx.userEmail, orgId: ctx.orgId }
    : null;
  if (caller !== "frontend") {
    if (!(await connectionIncludedForAgent(connection, { bypassCache: true })))
      fail(
        "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
        {
          errorCode: "data_connection_ai_disabled",
          statusCode: 403,
        },
      );
    const metadata = scope && (await readDataResourceMetadata(scope, id));
    if (
      metadata &&
      metadata.resources.some(
        (resource) =>
          resource.kind !== "connection" && resource.aiUsage === "excluded",
      )
    )
      fail(
        "Agent SQL queries are unavailable while this connection contains excluded data resources.",
        {
          errorCode: "warehouse_query_resource_policy_unavailable",
          statusCode: 403,
        },
      );
  }
  const projectId = connection.config.projectId ?? connection.accountId;
  const credentialKey = serviceAccountKey(connection);
  if (typeof projectId !== "string" || !projectId || !credentialKey)
    fail("The selected data connection is incomplete.", {
      errorCode: "data_connection_credentials_missing",
      statusCode: 409,
    });
  const options = { driveAccess: connection.config.driveAccess === true };
  const runtime = await runtimeForConnection(id, credentialKey, options);
  const [defaultDatasetId, ...otherDatasets] = configuredDatasetNames(
    connection.config,
  );
  return {
    projectId,
    ...(defaultDatasetId &&
    otherDatasets.length === 0 &&
    /^[A-Za-z0-9_]{1,1024}$/.test(defaultDatasetId)
      ? { defaultDatasetId }
      : {}),
    location:
      typeof connection.config.location === "string"
        ? connection.config.location
        : "US",
    runtime,
    storage:
      connection.config.useBQStorageAPI === true
        ? { connectionId: id, credentialKey, options }
        : null,
    revision: [
      runtime.authorityRevision,
      connection.updatedAt,
      connection.nativeRevision,
      scope &&
        (await readResourcePolicyRevision(scope, id, { bypassCache: true })),
    ],
  };
}
