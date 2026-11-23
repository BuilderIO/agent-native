import { createHash, randomUUID } from "node:crypto";

import {
  fail,
  isActionContractError,
  type ActionContractError,
} from "@agent-native/core/action";
import {
  createProviderApiRuntime,
  getProviderApiConfig,
  type ProviderApiCredentialResolver,
} from "@agent-native/core/provider-api";
import {
  getRequestContext,
  resolveDeployEnvironment,
} from "@agent-native/core/server";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import {
  phase1WarehouseFixtureKey,
  type WarehouseFixtureBridge,
} from "../../shared/phase1-warehouse-fixture.js";
import { normalizeServiceAccountJson } from "../../shared/service-account-json.js";
import { ALL_BIGQUERY_DATASETS } from "../../shared/workspace-warehouse-form.js";
import {
  createWarehouseStorageClient,
  decodeWarehouseStorageCursor,
  encodeWarehouseStorageCursor,
  normalizeStorageReadFailure,
  readStoragePage,
  releaseWithinBudget,
  warehouseSchemaFingerprint,
  type WarehouseQueryColumn,
  type WarehouseServiceAccount,
  type WarehouseStorageHandle,
  type WarehouseStoragePageRequest,
} from "./data-storage.js";

export const DATA_APP_ID = "analytics-2";

function warehouseFixture() {
  const fixture = (
    globalThis as { [phase1WarehouseFixtureKey]?: WarehouseFixtureBridge }
  )[phase1WarehouseFixtureKey];
  if (fixture && resolveDeployEnvironment() !== "local")
    throw new Error(
      "The Phase 1 warehouse fixture requires the local deployment profile",
    );
  return fixture;
}

type WarehouseAuthenticationOptions = { driveAccess?: boolean | undefined };
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
function warehouseProviderScopes() {
  const provider = getProviderApiConfig("bigquery");
  if (provider.auth.type !== "google-service-account")
    throw new Error("The warehouse authentication configuration is invalid.");
  return provider;
}
function warehouseAuthenticationScopes(
  options: WarehouseAuthenticationOptions,
) {
  const { auth } = warehouseProviderScopes();
  if (auth.type !== "google-service-account")
    throw new Error("The warehouse authentication configuration is invalid.");
  return [
    ...auth.scopes,
    ...(options.driveAccess ? [DRIVE_READONLY_SCOPE] : []),
  ];
}
function authenticationOptions(options: WarehouseAuthenticationOptions) {
  if (!options.driveAccess) return {};
  const provider = warehouseProviderScopes();
  return {
    providerOverrides: [
      {
        ...provider,
        auth: {
          ...provider.auth,
          scopes: warehouseAuthenticationScopes(options),
        },
      },
    ],
  };
}
export const serviceAccountSchema = z
  .object({
    client_email: z.string().email(),
    private_key: z.string().min(1),
    project_id: z.string().min(1),
  })
  .passthrough();
const envelope = z.object({
  response: z.object({
    ok: z.boolean(),
    status: z.number(),
    truncated: z.boolean().optional(),
    json: z.unknown().optional(),
  }),
});
const reference = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
});
const datasetResponse = z.object({
  kind: z.literal("bigquery#datasetList"),
  datasets: z
    .array(
      z.object({
        datasetReference: reference,
        friendlyName: z.string().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().min(1).optional(),
  unreachable: z.array(z.string()).optional(),
});
const tableResponse = z.object({
  kind: z.literal("bigquery#tableList"),
  tables: z
    .array(
      z.object({
        tableReference: reference.extend({ tableId: z.string().min(1) }),
        friendlyName: z.string().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().min(1).optional(),
  totalItems: z.number().optional(),
});
const metadataRejectionReason = z.enum([
  "accessDenied",
  "backendError",
  "internalError",
  "invalid",
  "notFound",
  "quotaExceeded",
  "rateLimitExceeded",
]);
const metadataErrorBody = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z
      .array(
        z.object({
          reason: z.string(),
          message: z.string().optional(),
        }),
      )
      .default([]),
  }),
});
const metadataRejection = z.object({
  operation: z.enum(["datasets", "tables"]),
  providerStatus: z.number().int().min(100).max(599),
  providerReason: metadataRejectionReason.optional(),
});

export function bigQueryMetadataRejection(error: unknown) {
  if (
    !isActionContractError(error) ||
    error.errorCode !== "data_connection_rejected"
  )
    return;
  const parsed = metadataRejection.safeParse(error.details);
  if (!parsed.success) return;
  return parsed.data;
}

export function describeBigQueryMetadataRejection(error: unknown) {
  const rejection = bigQueryMetadataRejection(error);
  if (!rejection) return;
  const { operation, providerStatus, providerReason } = rejection;
  return `BigQuery could not list ${operation} (HTTP ${providerStatus}${providerReason ? `, ${providerReason}` : ""}).`;
}

function serviceAccountContext() {
  const ctx = getRequestContext();
  if (!ctx?.userEmail)
    fail("A signed-in account is required.", {
      errorCode: "data_connection_auth_required",
      statusCode: 401,
    });
  const orgId = ctx.orgScope === "personal" ? undefined : ctx.orgId;
  // Select service-account authentication; vault authorization still uses the genuine request context.
  return {
    userEmail: ctx.userEmail,
    ...(orgId ? { orgId, credentialScope: "org" as const } : {}),
  };
}
/**
 * One canonical selected-connection vault read for both transports. Resolver
 * statuses stay distinguishable: an unreadable store is not the same failure
 * as an absent grant or a missing saved secret.
 */
async function selectedConnectionCredential(
  connectionId: string,
  credentialKey: string,
): Promise<string> {
  const resolved = await resolveWorkspaceConnectionCredentialForApp({
    appId: DATA_APP_ID,
    provider: "bigquery",
    connectionId,
    key: credentialKey,
    recordUsage: false,
  });
  if (resolved.status === undefined) {
    // Older resolver shape (and test doubles) only reports availability.
    if (resolved.available && resolved.value) return resolved.value;
    fail("The selected data connection is unavailable.", {
      errorCode: "data_connection_unavailable",
      statusCode: 403,
    });
  }
  if (resolved.status === "resolved" && resolved.value) return resolved.value;
  switch (resolved.status) {
    case "missing_context":
      fail("A signed-in account is required.", {
        errorCode: "data_connection_auth_required",
        statusCode: 401,
      });
    case "missing_secret":
      fail(
        "The saved data connection credential is missing. Re-enter it before connecting.",
        {
          errorCode: "data_connection_credentials_missing",
          statusCode: 409,
        },
      );
    case "not_available":
    case "missing_ref":
      fail("The selected data connection is unavailable.", {
        errorCode: "data_connection_unavailable",
        statusCode: 403,
      });
    default:
      fail(
        "The saved data connection credentials could not be read. Please try again.",
        {
          errorCode: "data_connection_credentials_unreadable",
          statusCode: 503,
        },
      );
  }
}

export async function runtimeForConnection(
  connectionId: string,
  credentialKey: string,
  options: WarehouseAuthenticationOptions = {},
) {
  const credential = await selectedConnectionCredential(
    connectionId,
    credentialKey,
  );
  const identity = createHash("sha256")
    .update(connectionId)
    .update(credential)
    .digest("hex");
  const resolver: ProviderApiCredentialResolver = async ({ key }) =>
    key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
      ? {
          key,
          value: credential,
          source: "workspace_connection",
          provider: "bigquery",
          connectionId,
        }
      : null;
  const client = createProviderApiRuntime({
    appId: `${DATA_APP_ID}:warehouse:${identity}`,
    providerIds: ["bigquery"],
    resolveCredential: resolver,
    getCredentialContext: serviceAccountContext,
    ...authenticationOptions(options),
  });
  return {
    ...client,
    authorityRevision: identity,
    async executeRequest(args: Parameters<typeof client.executeRequest>[0]) {
      return (
        warehouseFixture()?.rest(connectionId, args) ??
        client.executeRequest({ ...args, connectionId })
      );
    },
  };
}

function savedServiceAccountCredential(raw: string): WarehouseServiceAccount {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("The saved data connection credentials could not be read.", {
      errorCode: "warehouse_query_credentials_invalid",
      statusCode: 502,
    });
  }
  const parsed = serviceAccountSchema.safeParse(input);
  if (!parsed.success)
    fail("The saved data connection credentials could not be read.", {
      errorCode: "warehouse_query_credentials_invalid",
      statusCode: 502,
    });
  return {
    client_email: parsed.data.client_email,
    private_key: parsed.data.private_key,
    project_id: parsed.data.project_id,
  };
}

/**
 * Resolves the selected connection credential through the same canonical vault
 * path as the REST transport and hands it to the Storage client with the
 * approved BigQuery scope list. There is no ADC or environment fallback here.
 */
export async function storageClientForConnection(
  connectionId: string,
  credentialKey: string,
  options: WarehouseAuthenticationOptions = {},
) {
  const credential = savedServiceAccountCredential(
    await selectedConnectionCredential(connectionId, credentialKey),
  );
  try {
    return await createWarehouseStorageClient(
      credential,
      warehouseAuthenticationScopes(options),
    );
  } catch (error) {
    throw normalizeStorageReadFailure(error, { storagePhase: "client_init" });
  }
}

export async function requestMetadata(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  projectId: string,
  {
    datasetId,
    after,
    first = 50,
    signal,
    maxBytes = 2_000_000,
    timeoutMs = 30_000,
  }: {
    datasetId?: string | undefined;
    after?: string | undefined;
    first?: number | undefined;
    signal?: AbortSignal | undefined;
    maxBytes?: number | undefined;
    timeoutMs?: number | undefined;
  } = {},
) {
  const path = `/projects/${encodeURIComponent(projectId)}/datasets${datasetId ? `/${encodeURIComponent(datasetId)}/tables` : ""}`;
  let raw: unknown;
  try {
    raw = await runtime.executeRequest({
      provider: "bigquery",
      method: "GET",
      path,
      query: { maxResults: first, ...(after ? { pageToken: after } : {}) },
      maxBytes,
      timeoutMs,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    const authRejected =
      error instanceof Error &&
      /^Google OAuth error (400|401|403):/.test(error.message);
    fail(
      "Error connecting to data source. Please check your connection details and user permissions, then try again, or save as draft.",
      {
        errorCode: authRejected
          ? "data_connection_auth_rejected"
          : "data_connection_provider_error",
        statusCode: 502,
      },
    );
  }
  const result = envelope.safeParse(raw);
  if (!result.success || result.data.response.truncated)
    fail("The data source returned an incomplete response. Please try again.", {
      errorCode: "data_connection_incomplete",
      statusCode: 502,
    });
  const response = result.data.response;
  if (!response.ok) {
    const body = metadataErrorBody.safeParse(response.json);
    const reason = metadataRejectionReason.safeParse(
      body.data?.error.errors[0]?.reason,
    );
    const providerMessage =
      body.data?.error.message?.trim() ||
      body.data?.error.errors[0]?.message?.trim() ||
      undefined;
    fail(
      "Error connecting to data source. Please check your connection details and user permissions, then try again, or save as draft.",
      {
        errorCode: "data_connection_rejected",
        statusCode:
          response.status === 401 || response.status === 403 ? 403 : 502,
        details: {
          operation: datasetId ? "tables" : "datasets",
          providerStatus: response.status,
          ...(reason.success ? { providerReason: reason.data } : {}),
          ...(providerMessage ? { providerMessage } : {}),
        },
      },
    );
  }
  if (datasetId) {
    const body = tableResponse.safeParse(response.json);
    if (!body.success)
      fail("The data source returned an unreadable table list.", {
        errorCode: "data_connection_bad_response",
        statusCode: 502,
      });
    if (
      body.data.tables?.some(
        (item) =>
          item.tableReference.projectId !== projectId ||
          item.tableReference.datasetId !== datasetId,
      ) ||
      (after && body.data.nextPageToken === after)
    )
      fail("The data source returned an invalid table page.", {
        errorCode: "data_connection_bad_response",
        statusCode: 502,
      });
    return {
      items: (body.data.tables ?? []).map((item) => ({
        id: `table:${encodeURIComponent(item.tableReference.projectId)}:${encodeURIComponent(item.tableReference.datasetId)}:${encodeURIComponent(item.tableReference.tableId)}`,
        name: item.tableReference.tableId,
        kind: "table" as const,
        hasChildren: false,
      })),
      nextPageToken: body.data.nextPageToken,
    };
  }
  const body = datasetResponse.safeParse(response.json);
  if (!body.success)
    fail("The data source returned an incomplete dataset list.", {
      errorCode: "data_connection_bad_response",
      statusCode: 502,
    });
  if (
    body.data.datasets?.some(
      (item) => item.datasetReference.projectId !== projectId,
    ) ||
    (after && body.data.nextPageToken === after)
  )
    fail("The data source returned an invalid dataset page.", {
      errorCode: "data_connection_bad_response",
      statusCode: 502,
    });
  return {
    items: (body.data.datasets ?? []).map((item) => ({
      id: `schema:${encodeURIComponent(item.datasetReference.projectId)}:${encodeURIComponent(item.datasetReference.datasetId)}`,
      name: item.datasetReference.datasetId,
      kind: "schema" as const,
      hasChildren: true,
    })),
    nextPageToken: body.data.nextPageToken,
  };
}

export function runtimeForSubmittedServiceAccount(
  submitted: string,
  options: WarehouseAuthenticationOptions = {},
) {
  const raw = normalizeServiceAccountJson(submitted);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("Service account configuration (JSON) is invalid.", {
      errorCode: "data_connection_invalid_credentials",
      statusCode: 422,
    });
  }
  const parsed = serviceAccountSchema.safeParse(input);
  if (!parsed.success)
    fail("Service account configuration (JSON) is invalid.", {
      errorCode: "data_connection_invalid_credentials",
      statusCode: 422,
    });
  return createProviderApiRuntime({
    appId: `${DATA_APP_ID}:validate:${randomUUID()}`,
    providerIds: ["bigquery"],
    ...authenticationOptions(options),
    getCredentialContext: serviceAccountContext,
    resolveCredential: async ({ key }) =>
      key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
        ? {
            key,
            value: raw,
            source: "submitted_workspace_credential",
            provider: "bigquery",
          }
        : null,
  });
}

async function dryRunBigQueryProjectAccess(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  projectId: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  rejection?: {
    providerStatus: number;
    providerReason?: z.infer<typeof metadataRejectionReason> | undefined;
    providerMessage?: string | undefined;
  };
}> {
  let raw: unknown;
  try {
    raw = await runtime.executeRequest({
      provider: "bigquery",
      method: "POST",
      path: `/projects/${encodeURIComponent(projectId)}/jobs`,
      query: { alt: "json" },
      body: {
        configuration: {
          dryRun: true,
          query: {
            query: "SELECT 1 AS ok WHERE FALSE",
            useLegacySql: false,
          },
        },
      },
      maxBytes: 65_536,
      timeoutMs: 10_000,
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { ok: false };
  }
  const parsedEnvelope = envelope.safeParse(raw);
  if (!parsedEnvelope.success || parsedEnvelope.data.response.truncated)
    return { ok: false };
  const { ok, status, json } = parsedEnvelope.data.response;
  if (!ok || status !== 200) {
    const body = metadataErrorBody.safeParse(json);
    const reason = metadataRejectionReason.safeParse(
      body.data?.error.errors[0]?.reason,
    );
    const providerMessage =
      body.data?.error.message?.trim() ||
      body.data?.error.errors[0]?.message?.trim() ||
      undefined;
    return {
      ok: false,
      rejection: {
        providerStatus: status,
        ...(reason.success ? { providerReason: reason.data } : {}),
        ...(providerMessage ? { providerMessage } : {}),
      },
    };
  }
  if (!json || typeof json !== "object" || Array.isArray(json))
    return { ok: false };
  if ("error" in json) return { ok: false };
  const typed = json as Record<string, unknown>;
  const jobStatus = typed.status as Record<string, unknown> | undefined;
  if (
    jobStatus &&
    typeof jobStatus === "object" &&
    "errorResult" in jobStatus &&
    jobStatus.errorResult
  )
    return { ok: false };
  const configuration = typed.configuration as
    | Record<string, unknown>
    | undefined;
  return {
    ok: typed.kind === "bigquery#job" || configuration?.dryRun === true,
  };
}

export async function validateBigQueryProjectAccess(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  projectId: string,
  signal?: AbortSignal,
) {
  try {
    await requestMetadata(runtime, projectId, {
      first: 1,
      ...(signal ? { signal, maxBytes: 65_536, timeoutMs: 10_000 } : {}),
    });
    return;
  } catch (error) {
    if (bigQueryMetadataRejection(error)?.providerStatus !== 403) throw error;
    signal?.throwIfAborted();
    const dryRun = await dryRunBigQueryProjectAccess(
      runtime,
      projectId,
      signal,
    );
    signal?.throwIfAborted();
    if (dryRun.ok) return;
    if (dryRun.rejection) {
      fail(
        "Error connecting to data source. Please check your connection details and user permissions, then try again, or save as draft.",
        {
          errorCode: "data_connection_rejected",
          statusCode:
            dryRun.rejection.providerStatus === 401 ||
            dryRun.rejection.providerStatus === 403
              ? 403
              : 502,
          details: {
            operation: "datasets",
            providerStatus: dryRun.rejection.providerStatus,
            ...(dryRun.rejection.providerReason
              ? { providerReason: dryRun.rejection.providerReason }
              : {}),
            ...(dryRun.rejection.providerMessage
              ? { providerMessage: dryRun.rejection.providerMessage }
              : {}),
          },
        },
      );
    }
    throw error;
  }
}

export async function validateSubmittedServiceAccount(
  projectId: string,
  raw: string,
  options: WarehouseAuthenticationOptions & { signal?: AbortSignal } = {},
) {
  await validateBigQueryProjectAccess(
    runtimeForSubmittedServiceAccount(raw, options),
    projectId,
    options.signal,
  );
}

export async function validateConfiguredBigQueryDatasetsWithRuntime(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  projectId: string,
  configured: string,
  signal: AbortSignal,
) {
  if (configured === ALL_BIGQUERY_DATASETS) return;
  const datasetIds = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!datasetIds.length) return;
  if (
    datasetIds.length > 100 ||
    new Set(datasetIds).size !== datasetIds.length ||
    datasetIds.some((dataset) => !/^[\w]{1,1024}$/.test(dataset))
  )
    fail("Enter a comma-separated list of distinct dataset names.", {
      errorCode: "data_connection_dataset_invalid",
      statusCode: 400,
      details: { field: "datasetNames" },
    });
  for (let index = 0; index < datasetIds.length; index += 5) {
    signal.throwIfAborted();
    await Promise.all(
      datasetIds.slice(index, index + 5).map(async (dataset) => {
        try {
          await requestMetadata(runtime, projectId, {
            datasetId: dataset,
            first: 1,
            maxBytes: 65_536,
            timeoutMs: 10_000,
            signal,
          });
        } catch (error) {
          const rejection = bigQueryMetadataRejection(error);
          if (
            rejection?.providerStatus === 403 ||
            rejection?.providerStatus === 404
          )
            fail(
              `Dataset ${dataset} could not be verified. Check its name and access.`,
              {
                errorCode: "data_connection_dataset_unverified",
                statusCode: 400,
                details: { field: "datasetNames", dataset },
              },
            );
          throw error;
        }
      }),
    );
  }
}

export async function validateConfiguredBigQueryDatasets(
  projectId: string,
  credential: string,
  configured: string,
  signal: AbortSignal,
) {
  await validateConfiguredBigQueryDatasetsWithRuntime(
    runtimeForSubmittedServiceAccount(credential, {}),
    projectId,
    configured,
    signal,
  );
}

/**
 * A saved query's whole result, not one page, is capped: 50,000 rows over at
 * most 20 pages. Callers pass what is left of that budget into every page so a
 * continuation can never grow past it.
 */
export const WAREHOUSE_QUERY_MAX_TOTAL_ROWS = 50_000;
export const WAREHOUSE_QUERY_MAX_TOTAL_PAGES = 20;
export interface WarehouseQueryInput {
  query?: string;
  requestId?: string;
  parameters?: Array<{
    name: string;
    parameterType: { type: "STRING" | "INT64" | "FLOAT64" };
    parameterValue: { value: string };
  }>;
  job?: { projectId: string; jobId: string; location?: string | undefined };
  pageToken?: string;
  rowOffset?: number;
  first?: number;
  /** Rows still allowed for this saved query after the pages already read. */
  remainingRows?: number;
}
const jobReferenceSchema = z.object({
  projectId: z.string().min(1),
  jobId: z.string().min(1),
  location: z.string().optional(),
});

export async function cancelWarehouseJob(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  job: { projectId: string; jobId: string; location: string },
  operation: "request" | "status",
): Promise<"pending" | "cancelled" | "complete" | "failed"> {
  let raw: unknown;
  try {
    raw = await runtime.executeRequest({
      provider: "bigquery",
      method: operation === "request" ? "POST" : "GET",
      path: `/projects/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.jobId)}${operation === "request" ? "/cancel" : ""}`,
      query: { location: job.location },
      timeoutMs: 30_000,
      maxBytes: 2_000_000,
    });
  } catch {
    fail("The query cancellation outcome could not be confirmed.", {
      errorCode: "warehouse_query_cancel_unknown",
      statusCode: 502,
    });
  }
  const response = envelope.safeParse(raw);
  if (
    !response.success ||
    !response.data.response.ok ||
    response.data.response.truncated
  )
    fail("The query cancellation outcome could not be confirmed.", {
      errorCode: "warehouse_query_cancel_unknown",
      statusCode: 502,
    });
  const payload =
    operation === "request"
      ? z.object({ job: z.unknown() }).safeParse(response.data.response.json)
      : null;
  const result = z
    .object({
      jobReference: jobReferenceSchema,
      status: z.object({
        state: z.enum(["PENDING", "RUNNING", "DONE"]),
        errorResult: z.object({ reason: z.string() }).optional(),
      }),
    })
    .safeParse(
      operation === "request"
        ? payload?.success
          ? payload.data.job
          : null
        : response.data.response.json,
    );
  if (!result.success)
    fail("The query cancellation outcome could not be confirmed.", {
      errorCode: "warehouse_query_cancel_unknown",
      statusCode: 502,
    });
  resolveQueryJobReference(job.projectId, job, result.data.jobReference);
  if (result.data.status.state !== "DONE") return "pending";
  if (result.data.status.errorResult?.reason === "stopped") return "cancelled";
  return result.data.status.errorResult ? "failed" : "complete";
}
function resolveQueryJobReference(
  projectId: string,
  savedJob: WarehouseQueryInput["job"],
  returnedJob: z.infer<typeof jobReferenceSchema> | undefined,
) {
  const jobId = returnedJob?.jobId ?? savedJob?.jobId;
  if (
    !jobId ||
    (returnedJob !== undefined && returnedJob.projectId !== projectId) ||
    (savedJob !== undefined && jobId !== savedJob.jobId)
  )
    fail("The query did not return a valid job reference.", {
      errorCode: "warehouse_query_job_invalid",
      statusCode: 502,
    });
  if (
    savedJob?.location !== undefined &&
    returnedJob?.location !== undefined &&
    returnedJob.location !== savedJob.location
  )
    fail("This query job is not in the selected connection.", {
      errorCode: "warehouse_query_job_denied",
      statusCode: 403,
    });
  const location = savedJob?.location ?? returnedJob?.location;
  return { projectId, jobId, ...(location === undefined ? {} : { location }) };
}
const warehouseQueryColumnSchema: z.ZodType<WarehouseQueryColumn> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    mode: z.string().optional(),
    fields: z.array(warehouseQueryColumnSchema).optional(),
  }),
);
const queryResponseSchema = z.object({
  jobComplete: z.boolean(),
  jobReference: jobReferenceSchema.optional(),
  schema: z
    .object({
      fields: z.array(warehouseQueryColumnSchema),
    })
    .optional(),
  rows: z
    .array(z.object({ f: z.array(z.object({ v: z.unknown() })) }))
    .optional(),
  totalRows: z.string().optional(),
  totalBytesProcessed: z.string().optional(),
  pageToken: z.string().min(1).optional(),
  errors: z
    .array(
      z.object({
        reason: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});
const queryErrorBody = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z
      .array(
        z.object({
          message: z.string().optional(),
          reason: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
const queryFailureMessage =
  "Error running query. Check your SQL and connection permissions, then try again.";

function queryErrorMessage(...messages: (string | undefined)[]) {
  return messages
    .map((message) => message?.trim().slice(0, 2000))
    .find(Boolean);
}
function warehouseQueryPageFirst(input: WarehouseQueryInput): number {
  const requested = input.first ?? 1000;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 1000)
    fail("The query page size is invalid.", {
      errorCode: "warehouse_query_page_invalid",
      statusCode: 422,
    });
  if (
    input.remainingRows !== undefined &&
    (!Number.isSafeInteger(input.remainingRows) || input.remainingRows < 0)
  )
    fail("The remaining query row budget is invalid.", {
      errorCode: "warehouse_query_budget_invalid",
      statusCode: 422,
    });
  // A continuation may only ask for what is left of the global row budget, and
  // a response that comes back larger than that budget is refused rather than
  // reported as a complete result.
  const first =
    input.remainingRows === undefined
      ? requested
      : Math.min(requested, input.remainingRows);
  if (first < 1)
    fail("This query has already returned the maximum number of rows.", {
      errorCode: "bigquery_result_page_limit_exceeded",
      statusCode: 502,
    });
  return first;
}

async function requestQueryResult(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  projectId: string,
  input: WarehouseQueryInput,
  {
    first,
    fields,
    pageToken,
    startIndex,
  }: {
    first: number;
    fields?: string;
    pageToken?: string | undefined;
    startIndex?: bigint | undefined;
  },
) {
  const metadataFields = fields ? { fields } : {};
  if (input.job && input.job.projectId !== projectId)
    fail("This query job is not in the selected connection.", {
      errorCode: "warehouse_query_job_denied",
      statusCode: 403,
    });
  let raw: unknown;
  try {
    raw = input.job
      ? await runtime.executeRequest({
          provider: "bigquery",
          method: "GET",
          path: `/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(input.job.jobId)}`,
          query: {
            maxResults: first,
            timeoutMs: 10000,
            ...metadataFields,
            ...(pageToken ? { pageToken } : {}),
            ...(startIndex !== undefined
              ? { startIndex: startIndex.toString() }
              : {}),
            ...(input.job.location ? { location: input.job.location } : {}),
          },
          maxBytes: 2_000_000,
          timeoutMs: 30_000,
        })
      : await runtime.executeRequest({
          provider: "bigquery",
          method: "POST",
          path: `/projects/${encodeURIComponent(projectId)}/queries`,
          ...(fields ? { query: metadataFields } : {}),
          body: {
            query: input.query,
            ...(input.parameters?.length
              ? { parameterMode: "NAMED", queryParameters: input.parameters }
              : {}),
            useLegacySql: false,
            maxResults: first,
            timeoutMs: 10000,
            requestId: input.requestId ?? randomUUID(),
          },
          maxBytes: 2_000_000,
          timeoutMs: 30_000,
        });
  } catch {
    fail(queryFailureMessage, {
      errorCode: "warehouse_query_failed",
      statusCode: 502,
    });
  }
  const response = envelope.safeParse(raw);
  if (!response.success)
    fail("The query result could not be read completely.", {
      errorCode: "warehouse_query_incomplete",
      statusCode: 502,
    });
  const { ok, status, json, truncated } = response.data.response;
  if (!ok) {
    const providerError =
      !truncated && [400, 401, 403, 404, 422].includes(status)
        ? queryErrorBody.safeParse(json).data?.error
        : undefined;
    const details = {
      providerStatus: status,
      providerReason: providerError?.errors?.[0]?.reason ?? String(status),
    };
    const message = queryErrorMessage(
      providerError?.message,
      providerError?.errors?.[0]?.message,
    );
    if (status === 401 || status === 403)
      fail(
        message ??
          "Access to this query result was denied. Check the selected connection's permissions.",
        { errorCode: "warehouse_query_denied", statusCode: 403, details },
      );
    if (status === 409)
      fail("The query result is not available in its current state.", {
        errorCode: "warehouse_query_conflict",
        statusCode: 409,
        details,
      });
    fail(message ?? queryFailureMessage, {
      errorCode: "warehouse_query_failed",
      statusCode: status === 400 || status === 404 ? 422 : 502,
      details,
    });
  }
  if (truncated)
    fail("The query result could not be read completely.", {
      errorCode: "warehouse_query_incomplete",
      statusCode: 502,
    });
  const parsed = queryResponseSchema.safeParse(json);
  if (!parsed.success)
    fail("The query result is unreadable.", {
      errorCode: "warehouse_query_unreadable",
      statusCode: 502,
    });
  const result = parsed.data;
  if (result.errors?.length)
    fail(queryErrorMessage(result.errors[0]?.message) ?? queryFailureMessage, {
      errorCode:
        result.errors[0]?.reason === "accessDenied"
          ? "warehouse_query_denied"
          : "warehouse_query_failed",
      statusCode: result.errors[0]?.reason === "accessDenied" ? 403 : 422,
      details: { providerReason: result.errors[0]?.reason ?? "provider_error" },
    });
  const job = resolveQueryJobReference(
    projectId,
    input.job,
    result.jobReference,
  );
  if (result.jobComplete && !result.schema)
    fail("The completed query did not return its column schema.", {
      errorCode: "warehouse_query_schema_missing",
      statusCode: 502,
    });
  return { result, job };
}

const REST_AFTER_STORAGE_PREFIX = "rest:";

export async function executeQueryPage(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  projectId: string,
  input: WarehouseQueryInput,
  startIndex = input.rowOffset === undefined
    ? undefined
    : BigInt(input.rowOffset),
) {
  const first = warehouseQueryPageFirst(input);
  const restCursor = input.pageToken?.startsWith(REST_AFTER_STORAGE_PREFIX);
  const pageToken = restCursor
    ? input.pageToken?.slice(REST_AFTER_STORAGE_PREFIX.length)
    : input.pageToken;
  const usingRestAfterStorage = restCursor || startIndex !== undefined;
  const { result, job } = await requestQueryResult(runtime, projectId, input, {
    first,
    pageToken,
    startIndex,
  });
  if (usingRestAfterStorage && !result.jobComplete)
    fail("The completed query result is no longer available.", {
      errorCode: "warehouse_query_unreadable",
      statusCode: 502,
    });
  const columns = result.schema?.fields ?? [];
  const rows = (result.rows ?? []).map((row) => row.f.map((cell) => cell.v));
  if (
    rows.some((row) => row.length !== columns.length) ||
    (pageToken && result.pageToken === pageToken)
  )
    fail("The query result page is invalid.", {
      errorCode: "warehouse_query_page_invalid",
      statusCode: 502,
    });
  if (rows.length > first)
    fail("The query returned more rows than the remaining result budget.", {
      errorCode: "bigquery_result_page_limit_exceeded",
      statusCode: 502,
    });
  const nextPageToken = result.pageToken ?? null;
  return {
    jobComplete: result.jobComplete,
    status: result.jobComplete ? ("complete" as const) : ("running" as const),
    jobReference: job,
    columns,
    rows,
    totalRows: result.totalRows ?? null,
    totalBytesProcessed: result.totalBytesProcessed ?? null,
    pageToken:
      nextPageToken && usingRestAfterStorage
        ? REST_AFTER_STORAGE_PREFIX + nextPageToken
        : nextPageToken,
    hasNextPage: !!nextPageToken,
  };
}

// Google partial-response selector: metadata only, never the wide result rows.
// https://cloud.google.com/apis/docs/system-parameters#definitions (`fields`)
const QUERY_METADATA_FIELDS =
  "jobComplete,jobReference/projectId,jobReference/jobId,jobReference/location,schema,totalRows,totalBytesProcessed,errors";

async function readQueryStoragePage(
  storage: WarehouseStorageHandle,
  request: WarehouseStoragePageRequest,
  connectionId: string,
) {
  const close = () => releaseWithinBudget(() => storage.close());
  let result: Awaited<ReturnType<typeof readStoragePage>>;
  try {
    warehouseFixture()?.beforeStorageRead(
      connectionId,
      request.projectId,
      request.jobId,
    );
    result = await readStoragePage(storage, request);
  } catch (error) {
    const closeOutcome = await close();
    throw normalizeStorageReadFailure(error, {
      storagePhase: "read_rows",
      ...(closeOutcome === "released" ? {} : { unreleasedStorageClient: true }),
    });
  }
  if ((await close()) !== "released")
    fail("The query result could not be closed cleanly. Retry the query.", {
      errorCode: "warehouse_query_cleanup_failed",
      statusCode: 502,
      details: { unreleasedStorageClient: true },
    });
  return result;
}

function canReadJobThroughRest(error: unknown): error is ActionContractError {
  if (!isActionContractError(error) || !error.details?.storagePhase)
    return false;
  return (
    error.errorCode === "warehouse_query_timeout" ||
    error.errorCode === "warehouse_query_failed" ||
    error.errorCode === "warehouse_query_denied" ||
    error.errorCode === "warehouse_query_result_invalid" ||
    error.errorCode === "warehouse_query_type_unsupported" ||
    error.errorCode === "warehouse_query_cleanup_failed"
  );
}

/**
 * Completed-job read through the BigQuery Storage Read API. Paging is a
 * cursor over row offsets in the same job stream, so a page costs only the
 * rows it asks for and the location always comes from the provider job.
 */
export async function executeStorageQueryPage(
  runtime: ReturnType<typeof createProviderApiRuntime>,
  connection: {
    connectionId: string;
    credentialKey: string;
    projectId: string;
    input: WarehouseQueryInput;
    options?: WarehouseAuthenticationOptions | undefined;
    onStorageFallback?: (error: ActionContractError) => never;
  },
) {
  const { connectionId, credentialKey, projectId, input, options } = connection;
  if (input.pageToken?.startsWith(REST_AFTER_STORAGE_PREFIX))
    return executeQueryPage(runtime, projectId, input);

  const first = warehouseQueryPageFirst(input);
  const { result: metadata, job } = await requestQueryResult(
    runtime,
    projectId,
    input,
    {
      first: 1,
      fields: QUERY_METADATA_FIELDS,
    },
  );
  const columns = metadata.schema?.fields ?? [];
  if (!metadata.jobComplete)
    return {
      jobComplete: false,
      status: "running" as const,
      jobReference: job,
      columns,
      rows: [],
      totalRows: null,
      totalBytesProcessed: metadata.totalBytesProcessed ?? null,
      pageToken: null,
      hasNextPage: false,
    };
  const location = job.location;
  if (!location)
    fail("The query job did not return the location required to read it.", {
      errorCode: "warehouse_query_job_invalid",
      statusCode: 502,
    });
  if (!metadata.totalRows || !/^\d+$/.test(metadata.totalRows))
    fail("The completed query did not return its row count.", {
      errorCode: "warehouse_query_row_count_missing",
      statusCode: 502,
    });
  const totalRows = BigInt(metadata.totalRows);
  const schemaFingerprint = warehouseSchemaFingerprint(columns);
  let offset = input.rowOffset === undefined ? 0n : BigInt(input.rowOffset);
  if (input.pageToken) {
    if (!input.job)
      fail("The query result cursor is invalid.", {
        errorCode: "warehouse_query_cursor_invalid",
        statusCode: 422,
      });
    const cursor = decodeWarehouseStorageCursor(input.pageToken, {
      projectId,
      jobId: job.jobId,
      location,
      schemaFingerprint,
    });
    offset = cursor.offset;
  }
  const remaining = totalRows - offset;
  if (remaining < 0n)
    fail("The query result cursor is invalid.", {
      errorCode: "warehouse_query_cursor_invalid",
      statusCode: 422,
    });
  const page = {
    jobComplete: true,
    status: "complete" as const,
    jobReference: job,
    columns,
    rows: [] as unknown[][],
    totalRows: metadata.totalRows,
    totalBytesProcessed: metadata.totalBytesProcessed ?? null,
    pageToken: null as string | null,
    hasNextPage: false,
  };
  if (remaining === 0n) {
    if (offset > 0n)
      fail("The query result cursor is invalid.", {
        errorCode: "warehouse_query_cursor_invalid",
        statusCode: 422,
      });
    return page;
  }
  const pageFirst = Number(
    remaining < BigInt(first) ? remaining : BigInt(first),
  );
  let result: Awaited<ReturnType<typeof readStoragePage>>;
  try {
    const storage = await storageClientForConnection(
      connectionId,
      credentialKey,
      options,
    );
    result = await readQueryStoragePage(
      storage,
      {
        projectId,
        jobId: job.jobId,
        location,
        offset,
        first: pageFirst,
        totalRows,
        columns,
      },
      connectionId,
    );
  } catch (error) {
    if (!canReadJobThroughRest(error)) throw error;
    if (connection.onStorageFallback) connection.onStorageFallback(error);
    const details = { ...error.details, storageErrorCode: error.errorCode };
    console.warn(
      "BigQuery Storage read failed. Reading the job through REST.",
      details,
    );
    try {
      const restPage = await executeQueryPage(
        runtime,
        projectId,
        { job, first: pageFirst },
        offset,
      );
      if (
        !restPage.hasNextPage &&
        offset + BigInt(restPage.rows.length) !== totalRows
      )
        fail("The query result could not be read completely.", {
          errorCode: "warehouse_query_incomplete",
          statusCode: 502,
        });
      return restPage;
    } catch (restError) {
      if (!isActionContractError(restError)) throw restError;
      const failure = restError.statusCode < 500 ? restError : error;
      fail(failure.message, {
        errorCode: failure.errorCode,
        statusCode: failure.statusCode,
        details: {
          ...details,
          ...restError.details,
          restErrorCode: restError.errorCode,
        },
      });
    }
  }
  const nextOffset = offset + BigInt(result.rows.length);
  const hasNextPage = nextOffset < totalRows;
  return {
    ...page,
    rows: result.rows,
    pageToken: hasNextPage
      ? encodeWarehouseStorageCursor({
          projectId,
          jobId: job.jobId,
          location,
          offset: nextOffset,
          schemaFingerprint,
        })
      : null,
    hasNextPage,
  };
}
