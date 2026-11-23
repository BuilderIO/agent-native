import { fail, type ActionRunContext } from "@agent-native/core/action";
import {
  readWorkspaceCredentialProfile,
  resolveWorkspaceConnectionCredentialForApp,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import {
  listDbtSemanticMetricsInput,
  queryDbtSemanticMetricsInput,
} from "../../shared/dbt-semantic-metrics.js";
import { WORKSPACE_WAREHOUSE_DBT_TOKEN } from "../../shared/workspace-warehouse-dbt.js";
import { createDbtSemanticClient } from "../lib/dbt-semantic-protocol.js";
import { getOrganizationBigQueryCredentialReadiness } from "../lib/org-bigquery-credentials.js";
import {
  readDbtServiceToken,
  readOrganizationDbtConfig,
  requireExactDbtRequestContext,
} from "../lib/org-bigquery-dbt.js";
import {
  APPLICATION_ID,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import {
  readDataConnection,
  connectionIncludedForAgent,
} from "./data-connections.js";
import { dbtAccessUrls } from "./data-dbt-access-url.js";
import {
  readDataResourceMetadata,
  readResourcePolicyRevision,
} from "./data-resource-metadata.js";

const orgConfigSchema = z.object({
  hasDbtMetadata: z.literal(true),
  dbtVersion: z.literal("current"),
  dbtEnvironmentId: z.string().regex(/^[1-9][0-9]*$/),
  dbtCloudHostname: z.string().min(1),
});

const configSchema = orgConfigSchema.extend({
  dbtCredentialKey: z.literal(WORKSPACE_WAREHOUSE_DBT_TOKEN),
});

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted)
    fail("The dbt request was cancelled.", {
      statusCode: 499,
      errorCode: "dbt_semantic_cancelled",
    });
}

function semanticEndpoint(dbtCloudHostname: string): string {
  try {
    return dbtAccessUrls(dbtCloudHostname).semantic;
  } catch {
    return fail("Enter a valid dbt Access URL.", {
      statusCode: 422,
      errorCode: "dbt_semantic_configuration_invalid",
    });
  }
}

async function checkAgentPolicy(
  policyScope: { ownerEmail: string; orgId: string },
  connection: { id: string; config: Record<string, unknown> },
  caller?: string,
): Promise<number | null> {
  if (caller === "frontend") return null;
  const policyRevision = await readResourcePolicyRevision(
    policyScope,
    connection.id,
    { bypassCache: true },
  );
  if (!(await connectionIncludedForAgent(connection, { bypassCache: true }))) {
    fail(
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
      {
        statusCode: 403,
        errorCode: "data_connection_ai_disabled",
      },
    );
  }
  const metadata = await readDataResourceMetadata(
    policyScope,
    connection.id,
    undefined,
    { bypassCache: true },
  );
  if (
    metadata.resources.some(
      (resource) =>
        resource.kind !== "connection" && resource.aiUsage === "excluded",
    )
  ) {
    fail(
      "Agent metrics are unavailable while this connection contains excluded data resources.",
      {
        statusCode: 403,
        errorCode: "dbt_semantic_resource_policy_unavailable",
      },
    );
  }
  if (
    (await readResourcePolicyRevision(policyScope, connection.id, {
      bypassCache: true,
    })) !== policyRevision
  ) {
    fail("The data resource policy changed. Please try again.", {
      statusCode: 409,
      errorCode: "data_resource_policy_changed",
    });
  }
  return policyRevision;
}

async function snapshot(
  connectionId: string,
  caller?: string,
  signal?: AbortSignal,
  expectedScope?: { ownerEmail: string; orgId: string },
) {
  checkCancelled(signal);
  const scope = await requireCurrentWorkspace();
  if (
    expectedScope &&
    (scope.ownerEmail !== expectedScope.ownerEmail ||
      scope.orgId !== expectedScope.orgId)
  ) {
    fail("The active account or workspace changed. Please try again.", {
      statusCode: 409,
      errorCode: "dbt_semantic_scope_changed",
    });
  }
  const policyScope = { ownerEmail: scope.ownerEmail, orgId: scope.orgId };
  if (connectionId === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    requireExactDbtRequestContext({
      orgId: scope.orgId,
      userEmail: scope.ownerEmail,
    });
    const readiness = await getOrganizationBigQueryCredentialReadiness({
      orgId: scope.orgId,
      userEmail: scope.ownerEmail,
    });
    if (readiness !== "configured") {
      fail("The selected dbt connection is unavailable.", {
        statusCode: 403,
        errorCode: "dbt_semantic_connection_unavailable",
      });
    }
    const stored = await readOrganizationDbtConfig(scope.orgId);
    if (stored.status !== "configured")
      fail("Enable dbt 1.6+ on the selected connection first.", {
        statusCode: 409,
        errorCode: "dbt_semantic_configuration_invalid",
      });
    const parsed = orgConfigSchema.safeParse(stored.config);
    if (!parsed.success)
      fail("Enable dbt 1.6+ on the selected connection first.", {
        statusCode: 409,
        errorCode: "dbt_semantic_configuration_invalid",
      });
    const endpoint = semanticEndpoint(parsed.data.dbtCloudHostname);
    const policyRevision = await checkAgentPolicy(
      policyScope,
      {
        id: ORGANIZATION_BIGQUERY_SOURCE_ID,
        config: { credentialScope: "org", includeForAI: true },
      },
      caller,
    );
    checkCancelled(signal);
    return {
      kind: "organization" as const,
      scope: policyScope,
      identity: JSON.stringify([
        scope.ownerEmail,
        scope.orgId,
        connectionId,
        stored.revision,
        policyRevision,
        parsed.data,
        endpoint,
      ]),
      environmentId: parsed.data.dbtEnvironmentId,
      endpoint,
    };
  }
  await readDataConnection(connectionId);
  const profile = await readWorkspaceCredentialProfile({
    appId: APPLICATION_ID,
    provider: "bigquery",
    connectionId,
    requestContext: scope.request,
  });
  const connection = profile?.connection;
  if (
    !profile?.active ||
    !connection ||
    connection.id !== connectionId ||
    connection.provider !== "bigquery" ||
    connection.orgId !== scope.orgId ||
    connection.status !== "connected" ||
    connection.config.draft === true ||
    !connection.credentialRefs.some(
      (ref) => ref.key === WORKSPACE_WAREHOUSE_DBT_TOKEN,
    )
  ) {
    fail("The selected dbt connection is unavailable.", {
      statusCode: 403,
      errorCode: "dbt_semantic_connection_unavailable",
    });
  }
  const parsed = configSchema.safeParse(connection.config);
  if (!parsed.success)
    fail("Enable dbt 1.6+ on the selected connection first.", {
      statusCode: 409,
      errorCode: "dbt_semantic_configuration_invalid",
    });
  const endpoint = semanticEndpoint(parsed.data.dbtCloudHostname);
  const policyRevision = await checkAgentPolicy(
    policyScope,
    connection,
    caller,
  );
  checkCancelled(signal);
  return {
    kind: "native" as const,
    scope: policyScope,
    identity: JSON.stringify([
      scope.ownerEmail,
      scope.orgId,
      connectionId,
      profile.revision,
      policyRevision,
      parsed.data,
      endpoint,
    ]),
    environmentId: parsed.data.dbtEnvironmentId,
    endpoint,
  };
}

const DBT_SEMANTIC_DEADLINE_MS = 20_000;

async function semanticClient(
  connectionId: string,
  context: ActionRunContext | undefined,
  deadline: number,
) {
  const before = await snapshot(connectionId, context?.caller, context?.signal);
  let token: string;
  if (before.kind === "organization") {
    token = await readDbtServiceToken(before.scope.orgId);
  } else {
    const credential = await resolveWorkspaceConnectionCredentialForApp({
      appId: APPLICATION_ID,
      provider: "bigquery",
      connectionId,
      key: WORKSPACE_WAREHOUSE_DBT_TOKEN,
    });
    if (!credential.available || !credential.value) {
      if (credential.status === "missing_context")
        fail("Sign in again to read this dbt connection.", {
          statusCode: 401,
          errorCode: "data_dbt_auth_required",
        });
      if (credential.status === "missing_secret")
        fail("The dbt Service token is missing.", {
          statusCode: 409,
          errorCode: "data_dbt_credentials_missing",
        });
      fail("The selected connection's dbt credentials could not be read.", {
        statusCode: credential.status === "error" ? 503 : 403,
        errorCode: "data_dbt_credentials_unavailable",
      });
    }
    token = credential.value;
  }
  async function recheck() {
    const latest = await snapshot(
      connectionId,
      context?.caller,
      context?.signal,
      before.scope,
    );
    if (latest.identity !== before.identity)
      fail("The dbt connection or access policy changed. Please try again.", {
        statusCode: 409,
        errorCode: "dbt_semantic_configuration_changed",
      });
  }
  await recheck();
  return {
    client: createDbtSemanticClient({
      endpoint: before.endpoint,
      environmentId: before.environmentId,
      token,
      ...(context?.signal ? { signal: context.signal } : {}),
      deadline,
    }),
    recheck,
  };
}

export async function listNativeDbtSemanticMetrics(
  raw: z.input<typeof listDbtSemanticMetricsInput>,
  context?: ActionRunContext,
) {
  const input = listDbtSemanticMetricsInput.parse(raw);
  const { client, recheck } = await semanticClient(
    input.connectionId,
    context,
    Date.now() + DBT_SEMANTIC_DEADLINE_MS,
  );
  const result = await client.listMetrics({
    ...(input.pageNum !== undefined ? { pageNum: input.pageNum } : {}),
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
    ...(input.search !== undefined ? { search: input.search } : {}),
  });
  await recheck();
  return { connectionId: input.connectionId, ...result };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function queryNativeDbtSemanticMetrics(
  raw: z.input<typeof queryDbtSemanticMetricsInput>,
  context?: ActionRunContext,
) {
  const input = queryDbtSemanticMetricsInput.parse(raw);
  const deadline = Date.now() + DBT_SEMANTIC_DEADLINE_MS;
  const { client, recheck } = await semanticClient(
    input.connectionId,
    context,
    deadline,
  );
  const started = await client.startQuery({
    metrics: input.metrics,
    ...(input.groupBy ? { groupBy: input.groupBy } : {}),
    ...(input.where ? { where: input.where } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  });
  let page = await client.readQueryPage({
    queryId: started.queryId,
    pageNum: 1,
  });
  while (
    page.status === "PENDING" ||
    page.status === "QUEUED" ||
    page.status === "RUNNING" ||
    page.status === "COMPILED"
  ) {
    if (Date.now() >= deadline)
      fail("The dbt metric query is still running. Try again shortly.", {
        statusCode: 504,
        errorCode: "dbt_semantic_timeout",
      });
    await sleep(250);
    page = await client.readQueryPage({
      queryId: started.queryId,
      pageNum: 1,
    });
  }
  if (page.status !== "SUCCESSFUL")
    fail("The dbt metric query did not complete.", {
      statusCode: 502,
      errorCode: "dbt_semantic_query_failed",
    });
  await recheck();
  return {
    connectionId: input.connectionId,
    queryId: started.queryId,
    status: "SUCCESSFUL" as const,
    pageNum: page.pageNum,
    totalPages: page.totalPages,
    sql: page.sql,
    fields: page.fields,
    rows: page.rows,
    hasMore: page.totalPages > page.pageNum,
  };
}
