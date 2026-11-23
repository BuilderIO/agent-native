import { fail } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { dbtAccessUrls } from "../model/data-dbt-access-url.js";
import { parseDiscoveryResponse } from "../model/dbt-discovery-result.js";

export type DbtConfiguration = {
  hasDbtMetadata?: boolean | undefined;
  dbtVersion?: string | undefined;
  dbtAccountId?: string | undefined;
  dbtProjectId?: string | undefined;
  dbtEnvironmentId?: string | undefined;
  dbtCloudHostname?: string | undefined;
};
const freshnessThresholdSchema = z.object({
  count: z.number().int().nullable(),
  period: z.string().nullable(),
});
const freshnessCriteriaSchema = z.object({
  warnAfter: freshnessThresholdSchema.nullable(),
  errorAfter: freshnessThresholdSchema.nullable(),
});
export const dbtTableMetadataSchema = z.object({
  uniqueId: z.string(),
  resourceType: z.enum(["model", "source"]),
  name: z.string(),
  description: z.string().nullable(),
  columns: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      type: z.string().nullable(),
    }),
  ),
  lastRefreshed: z.string().datetime({ offset: true }).nullable(),
  freshness: z.string().nullable(),
  freshnessCriteria: freshnessCriteriaSchema.nullish(),
  tests: z.array(
    z.object({
      name: z.string(),
      status: z.string().nullable(),
      columnName: z.string().nullable(),
    }),
  ),
  parents: z.array(
    z.object({
      uniqueId: z.string(),
      name: z.string(),
      resourceType: z.string(),
    }),
  ),
  docsUrl: z.string().url().nullable(),
  runUrl: z.string().url().nullable(),
});
export type DbtTableMetadata = z.infer<typeof dbtTableMetadataSchema>;
export type TableIdentity = {
  projectId: string;
  datasetId: string;
  tableId: string;
};
type Connection = {
  id: string;
  config: Record<string, unknown>;
  credentialRefs: readonly { key: string }[];
};
const configurationSchema = z.object({
  hasDbtMetadata: z.boolean().optional(),
  dbtVersion: z.string().optional(),
  dbtAccountId: z.string().optional(),
  dbtProjectId: z.string().optional(),
  dbtEnvironmentId: z.string().optional(),
  dbtCloudHostname: z.string().optional(),
});
const idSchema = z.string().regex(/^[1-9][0-9]*$/);
const columnSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  type: z.string().nullish(),
});
const testSchema = z.object({
  name: z.string().nullable(),
  columnName: z.string().nullish(),
  status: z.string().nullish(),
  executionInfo: z.object({ lastRunStatus: z.string().nullable() }).nullish(),
});
const parentSchema = z.object({
  uniqueId: z.string(),
  name: z.string().nullable(),
  resourceType: z.string(),
});
const nodeSchema = z.object({
  uniqueId: z.string(),
  name: z.string().nullable(),
  database: z.string().nullable(),
  schema: z.string().nullable(),
  description: z.string().nullish(),
  alias: z.string().nullish(),
  identifier: z.string().nullish(),
  accountId: z.union([z.string(), z.number()]).optional(),
  projectId: z.union([z.string(), z.number()]).optional(),
  catalog: z
    .object({
      columns: z.array(columnSchema).nullable(),
      runId: z.union([z.string(), z.number()]).nullish(),
      runGeneratedAt: z.string().datetime({ offset: true }).nullish(),
    })
    .nullish(),
  columns: z.array(columnSchema).nullish(),
  executionInfo: z
    .object({
      executeCompletedAt: z.string().datetime({ offset: true }).nullable(),
      lastSuccessRunId: z.union([z.string(), z.number()]).nullish(),
    })
    .nullish(),
  executeCompletedAt: z.string().datetime({ offset: true }).nullish(),
  freshness: z
    .object({
      freshnessStatus: z.string().nullable(),
      maxLoadedAt: z.string().datetime({ offset: true }).nullable(),
      freshnessRunId: z.union([z.string(), z.number()]).nullish(),
      criteria: freshnessCriteriaSchema.nullish(),
    })
    .nullish(),
  criteria: freshnessCriteriaSchema.nullish(),
  state: z.string().nullish(),
  maxLoadedAt: z.string().datetime({ offset: true }).nullish(),
  tests: z.array(testSchema),
  parents: z.array(parentSchema).optional(),
  parentsModels: z.array(parentSchema).optional(),
  parentsSources: z.array(parentSchema).optional(),
  paginationCursor: z.string().nullish(),
  runId: z.union([z.string(), z.number()]).optional(),
  runGeneratedAt: z.string().datetime({ offset: true }).nullish(),
});
type ProviderNode = z.infer<typeof nodeSchema>;
const pageSchema = z.object({
  edges: z.array(z.object({ node: nodeSchema })),
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
});
const responseLimit = 4 * 1024 * 1024;
type RequestBudget = { deadline: number };
function requestBudget(): RequestBudget {
  return { deadline: Date.now() + 20_000 };
}
function assertBudget(budget: RequestBudget) {
  if (Date.now() >= budget.deadline)
    fail(
      "dbt metadata could not finish within this request. Narrow the integration to an Environment ID and try again.",
      { errorCode: "data_dbt_request_budget_exhausted", statusCode: 503 },
    );
}

function invalid(message: string): never {
  return fail(message, {
    errorCode: "data_dbt_configuration_invalid",
    statusCode: 422,
  });
}
function providerFailure(): never {
  return fail(
    "There was a problem fetching dbt metadata. Check the integration settings and try again.",
    { errorCode: "data_dbt_metadata_failed", statusCode: 502 },
  );
}
function accessUrls(config: DbtConfiguration) {
  try {
    return dbtAccessUrls(config.dbtCloudHostname);
  } catch {
    return invalid("Enter a valid dbt Access URL.");
  }
}

export function resolveDbtSemanticLayerEndpoint(
  config: DbtConfiguration,
): string {
  return accessUrls(config).semantic;
}

async function requestJson(
  url: string,
  token: string,
  body: Record<string, unknown> | undefined,
  budget: RequestBudget,
): Promise<unknown> {
  assertBudget(budget);
  let response: Response;
  try {
    response = await ssrfSafeFetch(
      url,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Token ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(Math.max(1, budget.deadline - Date.now())),
      },
      { httpsOnly: true, followRedirects: false, requireDispatcher: true },
    );
  } catch {
    return providerFailure();
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      fail(
        "The dbt Service token could not access this project. Check its Metadata Only and Job Admin permissions.",
        { errorCode: "data_dbt_access_denied", statusCode: response.status },
      );
    if (response.status === 429)
      fail(
        "dbt is rate limiting metadata requests. Please try again shortly.",
        { errorCode: "data_dbt_rate_limited", statusCode: 429 },
      );
    return providerFailure();
  }
  const reader = response.body?.getReader();
  if (!reader) return providerFailure();
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > responseLimit) {
        await reader.cancel();
        return providerFailure();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    assertBudget(budget);
    return JSON.parse(text) as unknown;
  } catch (error) {
    assertBudget(budget);
    throw error && typeof error === "object" && "errorCode" in error
      ? error
      : providerFailure();
  }
}
async function graphqlResult(
  config: DbtConfiguration,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  budget: RequestBudget,
) {
  return parseDiscoveryResponse(
    await requestJson(
      accessUrls(config).metadata,
      token,
      { query, variables },
      budget,
    ),
  );
}
async function graphql(
  config: DbtConfiguration,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  budget: RequestBudget,
) {
  return (await graphqlResult(config, token, query, variables, budget)).data;
}
function requireId(value: string | undefined, label: string) {
  if (!value || !idSchema.safeParse(value.trim()).success)
    return invalid(`Enter a valid dbt ${label}.`);
  return value.trim();
}
const jobSchema = z.object({
  id: z.union([z.number().int().positive(), idSchema]),
  project_id: z.union([z.number(), z.string()]),
  environment_id: z.union([z.number(), z.string()]).nullish(),
  generate_docs: z.boolean(),
});
async function legacyJobs(
  config: DbtConfiguration,
  token: string,
  budget: RequestBudget,
) {
  const account = requireId(config.dbtAccountId, "Account ID");
  const project = requireId(config.dbtProjectId, "Project ID");
  const env = config.dbtEnvironmentId
    ? requireId(config.dbtEnvironmentId, "Environment ID")
    : undefined;
  const base = accessUrls(config).admin;
  const jobs: z.infer<typeof jobSchema>[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const params = new URLSearchParams({
      project_id: project,
      limit: "100",
      offset: String(offset),
      ...(env ? { environment_id: env } : {}),
    });
    const result = z
      .object({
        data: z.array(jobSchema),
        status: z.object({ is_success: z.boolean() }).optional(),
      })
      .safeParse(
        await requestJson(
          `${base}/api/v2/accounts/${account}/jobs/?${params}`,
          token,
          undefined,
          budget,
        ),
      );
    if (!result.success || result.data.status?.is_success === false)
      return providerFailure();
    for (const job of result.data.data)
      if (
        String(job.project_id) === project &&
        (!env || String(job.environment_id) === env) &&
        job.generate_docs
      )
        jobs.push(job);
    if (result.data.data.length < 100) {
      if (!jobs.length)
        invalid(
          "No dbt jobs found for this project. Enable Generate docs on a scheduled job and run it successfully.",
        );
      return jobs;
    }
  }
  return fail(
    "dbt job pagination did not finish. Narrow the integration to an Environment ID.",
    { errorCode: "data_dbt_pagination_failed", statusCode: 502 },
  );
}

export async function validateDbtConfiguration(
  config: DbtConfiguration,
  token: string,
): Promise<void> {
  if (!config.hasDbtMetadata) return;
  const budget = requestBudget();
  accessUrls(config);
  if (!token.trim()) return invalid("Enter a dbt Service token.");
  if (config.dbtVersion === "current") {
    const environmentId = requireId(config.dbtEnvironmentId, "Environment ID");
    const result = await graphql(
      config,
      token,
      "query ValidateEnvironment($environmentId: BigInt!) { environment(id: $environmentId) { applied { models(first: 1) { edges { node { uniqueId } } } } } }",
      { environmentId },
      budget,
    );
    if (
      !z
        .object({
          environment: z.object({
            applied: z.object({
              models: z.object({ edges: z.array(z.unknown()) }),
            }),
          }),
        })
        .safeParse(result).success
    )
      invalid(
        "The dbt environment could not be read. Check the Environment ID and Service token.",
      );
  } else if (config.dbtVersion === "legacy") {
    const jobs = await legacyJobs(config, token, budget);
    let forbidden = 0;
    for (const job of jobs) {
      const { data: result, unreadableJob } = await graphqlResult(
        config,
        token,
        "query ValidateJob($jobId: BigInt!) { job(id: $jobId) { models(first: 1) { uniqueId } } }",
        { jobId: String(job.id) },
        budget,
      );
      if (unreadableJob) {
        if (unreadableJob === "forbidden") forbidden++;
        continue;
      }
      if (
        !z
          .object({
            job: z.object({
              models: z.array(z.object({ uniqueId: z.string() })),
            }),
          })
          .safeParse(result).success
      )
        return providerFailure();
      return;
    }
    if (forbidden === jobs.length)
      fail(
        "The dbt Service token could not access this project. Check its Metadata Only and Job Admin permissions.",
        { errorCode: "data_dbt_access_denied", statusCode: 403 },
      );
    invalid(
      "No dbt metadata was found for this job. Run its scheduled job successfully with Generate docs enabled.",
    );
  } else invalid("Choose a dbt Version.");
}
const commonFields =
  "uniqueId name description database schema accountId projectId";
const currentFields =
  "catalog { runId runGeneratedAt columns { name description type } } tests { name columnName executionInfo { lastRunStatus } }";
const modelFields = `${commonFields} alias ${currentFields} executionInfo { executeCompletedAt lastSuccessRunId } parents { uniqueId name resourceType }`;
const sourceFields = `${commonFields} identifier ${currentFields} freshness { freshnessStatus maxLoadedAt freshnessRunId criteria { warnAfter { count period } errorAfter { count period } } }`;
async function currentTable(
  config: DbtConfiguration,
  token: string,
  table: TableIdentity,
  kind: "models" | "sources",
  budget: RequestBudget,
) {
  const environmentId = requireId(config.dbtEnvironmentId, "Environment ID");
  const query = `query TableMetadata($environmentId: BigInt!, $database: String!, $schema: String!, $identifier: String!, $after: String) { environment(id: $environmentId) { applied { ${kind}(first: 100, after: $after, filter: { database: $database, schema: $schema, identifier: $identifier }) { edges { node { ${kind === "models" ? modelFields : sourceFields} } } pageInfo { hasNextPage endCursor } } } } }`;
  let after: string | null = null;
  const cursors = new Set<string>();
  for (let page = 0; page < 1000; page++) {
    const data = await graphql(
      config,
      token,
      query,
      {
        environmentId,
        database: table.projectId,
        schema: table.datasetId,
        identifier: table.tableId,
        after,
      },
      budget,
    );
    const envelope = z
      .object({
        environment: z.object({ applied: z.record(z.string(), z.unknown()) }),
      })
      .safeParse(data);
    if (!envelope.success) return providerFailure();
    const result = pageSchema.safeParse(
      envelope.data.environment.applied[kind],
    );
    if (!result.success) return providerFailure();
    for (const { node } of result.data.edges)
      if (matches(node, table)) return node;
    if (!result.data.pageInfo.hasNextPage) return null;
    after = result.data.pageInfo.endCursor;
    if (!after || cursors.has(after)) break;
    cursors.add(after);
  }
  return fail(
    "dbt metadata pagination did not finish. Refresh the connection and try again.",
    { errorCode: "data_dbt_pagination_failed", statusCode: 502 },
  );
}
async function legacyTable(
  config: DbtConfiguration,
  token: string,
  table: TableIdentity,
  kind: "models" | "sources",
  jobs: z.infer<typeof jobSchema>[],
  budget: RequestBudget,
) {
  const candidates: ProviderNode[] = [];
  const fields =
    kind === "models"
      ? `${commonFields} alias runId runGeneratedAt columns { name description type } executeCompletedAt tests { name status columnName } parentsModels { uniqueId name resourceType } parentsSources { uniqueId name resourceType }`
      : `${commonFields} identifier runId runGeneratedAt columns { name description type } maxLoadedAt state criteria { warnAfter { count period } errorAfter { count period } } tests { name status columnName }`;
  const query = `query JobTableMetadata($jobId: BigInt!, $database: String!, $schema: String!, $identifier: String!, $after: String) { job(id: $jobId) { ${kind}(first: 100, after: $after, database: $database, schema: $schema, identifier: $identifier) { ${fields} paginationCursor } } }`;
  for (const job of jobs) {
    let after: string | null = null;
    const cursors = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const data = await graphql(
        config,
        token,
        query,
        {
          jobId: String(job.id),
          database: table.projectId,
          schema: table.datasetId,
          identifier: table.tableId,
          after,
        },
        budget,
      );
      if (data.job === null) break;
      const envelope = z
        .object({ job: z.record(z.string(), z.unknown()) })
        .safeParse(data);
      if (!envelope.success) return providerFailure();
      const result = z.array(nodeSchema).safeParse(envelope.data.job[kind]);
      if (!result.success) return providerFailure();
      for (const node of result.data)
        if (matches(node, table)) candidates.push(node);
      if (result.data.length < 100) break;
      after = result.data.at(-1)?.paginationCursor ?? null;
      if (!after || cursors.has(after) || page === 999)
        return fail("dbt metadata pagination did not finish.", {
          errorCode: "data_dbt_pagination_failed",
          statusCode: 502,
        });
      cursors.add(after);
    }
  }
  if (candidates.length === 1) return candidates[0] ?? null;
  if (!candidates.length) return null;
  const dated = candidates.map((node) => {
    const timestamp =
      node.runGeneratedAt ??
      node.catalog?.runGeneratedAt ??
      node.executeCompletedAt ??
      node.executionInfo?.executeCompletedAt ??
      node.maxLoadedAt;
    if (!timestamp)
      fail(
        "The latest dbt metadata could not be determined. Set an Environment ID to select the intended job.",
        { errorCode: "data_dbt_metadata_recency_unknown", statusCode: 502 },
      );
    return { node, timestamp: Date.parse(timestamp) };
  });
  dated.sort((left, right) => right.timestamp - left.timestamp);
  return dated[0]?.node ?? null;
}
function matches(node: ProviderNode, table: TableIdentity) {
  return (
    node.database === table.projectId &&
    node.schema === table.datasetId &&
    (node.alias ?? node.identifier ?? node.name) === table.tableId
  );
}
function present(
  node: ProviderNode,
  config: DbtConfiguration,
  resourceType: "model" | "source",
): DbtTableMetadata {
  const account = node.accountId ?? config.dbtAccountId;
  const project = node.projectId ?? config.dbtProjectId;
  const run = config.dbtVersion === "legacy" ? node.runId : node.catalog?.runId;
  const docsUrl =
    account && project && run
      ? `${accessUrls(config).admin}/accounts/${encodeURIComponent(String(account))}/runs/${encodeURIComponent(String(run))}/docs/#!/${resourceType}/${encodeURIComponent(node.uniqueId)}`
      : null;
  return dbtTableMetadataSchema.parse({
    uniqueId: node.uniqueId,
    resourceType,
    name: node.name ?? node.uniqueId,
    description: node.description ?? null,
    columns: (node.catalog?.columns ?? node.columns ?? []).map((column) => ({
      name: column.name,
      description: column.description ?? null,
      type: column.type ?? null,
    })),
    lastRefreshed:
      resourceType === "model"
        ? (node.executionInfo?.executeCompletedAt ??
          node.executeCompletedAt ??
          null)
        : (node.freshness?.maxLoadedAt ?? node.maxLoadedAt ?? null),
    freshness: node.freshness?.freshnessStatus ?? node.state ?? null,
    freshnessCriteria:
      resourceType === "source"
        ? (node.freshness?.criteria ?? node.criteria ?? null)
        : null,
    tests: (node.tests ?? []).map((test) => ({
      name: test.name ?? "",
      status: test.executionInfo?.lastRunStatus ?? test.status ?? null,
      columnName: test.columnName ?? null,
    })),
    parents: (
      node.parents ?? [
        ...(node.parentsModels ?? []),
        ...(node.parentsSources ?? []),
      ]
    ).map((parent) => ({ ...parent, name: parent.name ?? parent.uniqueId })),
    docsUrl,
    runUrl:
      account && project && run
        ? `${accessUrls(config).admin}/deploy/${encodeURIComponent(String(account))}/projects/${encodeURIComponent(String(project))}/runs/${encodeURIComponent(String(run))}`
        : null,
  });
}
export async function readDbtTableMetadata(
  connection: Connection,
  table: TableIdentity,
): Promise<DbtTableMetadata | null> {
  const parsed = configurationSchema.safeParse(connection.config);
  if (!parsed.success)
    return invalid(
      "The saved dbt configuration is invalid. Open the connection settings and save it again.",
    );
  const config = parsed.data;
  if (!config.hasDbtMetadata) return null;
  accessUrls(config);
  const key = connection.config.dbtCredentialKey;
  if (
    typeof key !== "string" ||
    !connection.credentialRefs.some((ref) => ref.key === key)
  )
    fail(
      "The dbt connection credentials are missing. Open the connection settings to add its Service token.",
      { errorCode: "data_dbt_credentials_missing", statusCode: 409 },
    );
  const credential = await resolveWorkspaceConnectionCredentialForApp({
    appId: "analytics-2",
    provider: "bigquery",
    connectionId: connection.id,
    key,
  });
  if (!credential.available || !credential.value) {
    if (credential.status === "missing_secret")
      fail(
        "The dbt Service token is missing. Open the connection settings to add it.",
        { errorCode: "data_dbt_credentials_missing", statusCode: 409 },
      );
    if (credential.status === "missing_context")
      fail("Sign in again to read the dbt connection.", {
        errorCode: "data_dbt_auth_required",
        statusCode: 401,
      });
    fail(
      "The dbt connection credentials could not be read. Check its workspace grant.",
      {
        errorCode: "data_dbt_credentials_unavailable",
        statusCode: credential.status === "error" ? 503 : 403,
      },
    );
  }
  return readDbtTableMetadataWithToken(config, credential.value, table);
}

/** Server-only: callers must resolve and authorize the token themselves. */
export async function readDbtTableMetadataWithToken(
  config: DbtConfiguration,
  token: string,
  table: TableIdentity,
): Promise<DbtTableMetadata | null> {
  if (!config.hasDbtMetadata) return null;
  const budget = requestBudget();
  const jobs =
    config.dbtVersion === "legacy"
      ? await legacyJobs(config, token, budget)
      : [];
  const load =
    config.dbtVersion === "current"
      ? (kind: "models" | "sources") =>
          currentTable(config, token, table, kind, budget)
      : config.dbtVersion === "legacy"
        ? (kind: "models" | "sources") =>
            legacyTable(config, token, table, kind, jobs, budget)
        : null;
  if (!load) return invalid("Choose a dbt Version in the connection settings.");
  const model = await load("models");
  if (model) return present(model, config, "model");
  const source = await load("sources");
  return source ? present(source, config, "source") : null;
}
